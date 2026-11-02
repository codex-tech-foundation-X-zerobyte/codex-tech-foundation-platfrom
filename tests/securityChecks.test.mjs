import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePosture, evaluateBrowser, scoreFindings } from '../src/lib/securityChecks.ts'

const HEALTHY = {
  generated_at: '2026-09-30T00:00:00Z', table_count: 40, policy_count: 120,
  tables_without_rls: [], tables_rls_without_policies: [], public_buckets: ['public-content'], private_buckets: ['private-project-files', 'chat-media'],
  definer_functions_without_search_path: [],
  accounts: { total: 20, superadmins: 2, workers: 8, clients: 10, suspended_workers: 0, suspended_clients: 0, must_change_password: 0 },
  activity: { failed_logins_24h: 0, failed_logins_7d: 2, warnings_24h: 0, errors_24h: 0, events_7d: 300 },
}
const by = (p) => Object.fromEntries(evaluatePosture(p).map((f) => [f.id, f]))

test('a healthy database scores 100 / A', () => {
  const r = scoreFindings(evaluatePosture(HEALTHY))
  assert.equal(r.score, 100); assert.equal(r.grade, 'A'); assert.equal(r.counts.fail, 0)
})
test('a table without RLS is a failure that names the table and gives the exact SQL', () => {
  const f = by({ ...HEALTHY, tables_without_rls: ['invoices', 'secrets'] })['db-rls']
  assert.equal(f.status, 'fail'); assert.match(f.detail, /invoices, secrets/); assert.match(f.fix, /alter table public\.invoices enable row level security;/)
})
test('RLS-on-but-no-policies is informational (locked), not a failure', () => assert.equal(by({ ...HEALTHY, tables_rls_without_policies: ['rate_limits'] })['db-nopolicy'].status, 'info'))
test('the intended public bucket is fine; any other public bucket warns', () => {
  assert.equal(by(HEALTHY)['db-buckets'].status, 'ok')
  const f = by({ ...HEALTHY, public_buckets: ['public-content', 'backups'] })['db-buckets']
  assert.equal(f.status, 'warn'); assert.match(f.detail, /backups/); assert.doesNotMatch(f.detail, /public-content/)
})
test('unpinned SECURITY DEFINER functions warn', () => assert.equal(by({ ...HEALTHY, definer_functions_without_search_path: ['f1'] })['db-definer'].status, 'warn'))
test('administrator count: 0 fails, 1 warns, 2-5 ok, many warns', () => {
  const st = (n) => by({ ...HEALTHY, accounts: { ...HEALTHY.accounts, superadmins: n } })['acct-admin'].status
  assert.deepEqual([0, 1, 2, 5, 6].map(st), ['fail', 'warn', 'ok', 'ok', 'warn'])
})
test('outstanding temporary passwords warn', () => assert.equal(by({ ...HEALTHY, accounts: { ...HEALTHY.accounts, must_change_password: 3 } })['acct-temp'].status, 'warn'))
test('failed sign-in volume escalates: few ok, 10+ warn, 50+ fail', () => {
  const st = (n) => by({ ...HEALTHY, activity: { ...HEALTHY.activity, failed_logins_24h: n } })['act-logins'].status
  assert.deepEqual([0, 3, 10, 49, 50].map(st), ['ok', 'ok', 'warn', 'warn', 'fail'])
})
test('score: -15 per failure, -5 per warning, unavailable checks never counted, floor at 0', () => {
  const f = (status) => ({ id: status, title: '', status, detail: '' })
  assert.equal(scoreFindings([f('fail'), f('warn'), f('ok'), f('info'), f('unavailable')]).score, 80)
  assert.equal(scoreFindings(Array.from({ length: 10 }, () => f('fail'))).score, 0)
  assert.equal(scoreFindings([f('unavailable'), f('unavailable')]).score, 100)
  assert.deepEqual([95, 85, 70, 55, 10].map((s) => scoreFindings(Array.from({ length: Math.round((100 - s) / 5) }, () => f('warn'))).grade), ['A', 'B', 'C', 'D', 'F'])
})
test('browser checks: https is ok, plain http in production fails, localhost is only informational', () => {
  const b = (o) => Object.fromEntries(evaluateBrowser({ protocol: 'https:', supabaseUrl: 'https://x.supabase.co', secureContext: true, debugOn: false, ...o }).map((f) => [f.id, f]))
  assert.equal(b({})['br-https'].status, 'ok')
  assert.equal(b({ protocol: 'http:', secureContext: false })['br-https'].status, 'fail')
  assert.equal(b({ protocol: 'http:', secureContext: true })['br-https'].status, 'info') // http://localhost
  assert.equal(b({ supabaseUrl: 'http://api.example.com' })['br-api'].status, 'fail')
  assert.equal(b({ supabaseUrl: 'http://127.0.0.1:54321' })['br-api'].status, 'info')
  assert.equal(b({ debugOn: true })['br-debug'].status, 'info'); assert.equal(b({})['br-debug'], undefined)
})
