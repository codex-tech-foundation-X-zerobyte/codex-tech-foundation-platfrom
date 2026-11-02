import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/20261004000000_super_monitor.sql')
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')   // SQL without full-line comments

test('Super Monitor is internal only: no tenant, customer-billing or external-product concept exists in its schema', () => {
  assert.ok(!/\b(tenant|tenant_id|organization_id|org_id|customer_id|subscription|stripe|paystack|invoice|plan_id|api_plan)\b/i.test(code), 'an external-product concept leaked into the internal monitor')
  assert.ok(!/codex[ _-]?monitor/i.test(code), 'the external Codex Monitor product must stay separate')
  for (const f of ['supabase/functions/monitor-ingest/index.ts', 'supabase/functions/workspace-sweep/index.ts', 'supabase/functions/_shared/monitorIngest.ts', 'src/lib/monitorRules.ts', 'src/lib/services/monitor.ts']) {
    assert.ok(!/\b(tenant|paystack|stripe)\b/i.test(read(f)), `${f} mentions an external concept`)
  }
})

test('every function the migration creates has an explicit access decision (granted or revoked), so none is open by accident', () => {
  const created = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
  assert.ok(created.length >= 35, `expected the migration to create its functions, found ${created.length}`)
  // the access blocks at the end name each function as 'name(args)' inside quoted strings
  const marker = sql.indexOf('-- ── who may call what')
  assert.ok(marker > 0, 'the access section is missing')
  const access = sql.slice(marker)
  const decided = new Set([...access.matchAll(/'(\w+)\(/g)].map((m) => m[1]))
  const undecided = created.filter((f) => !decided.has(f) && f !== 'monitor_redact' && !f.startsWith('monitor_ack') && !f.startsWith('monitor_sev') && f !== 'monitor_latency_bin' && f !== 'monitor_hist_p95')
  assert.deepEqual(undecided, [], `functions with no explicit grant/revoke: ${undecided.join(', ')}`)
})

test('pure helpers with no table access are the only functions left at the default', () => {
  for (const f of ['monitor_redact', 'monitor_ack_minutes', 'monitor_sev_rank', 'monitor_latency_bin', 'monitor_hist_p95']) {
    const body = code.slice(code.indexOf(`function public.${f}(`), code.indexOf('$$;', code.indexOf(`function public.${f}(`)))
    assert.ok(!/\b(from|insert|update|delete)\s+public\./i.test(body.replace(/(--.*)/g, '')), `${f} reads or writes a table`)
  }
})

test('ingestion and the sweep are the only functions the service role gets; nothing is granted to anon', () => {
  assert.ok(!/grant[^;]*\bto\b[^;]*\banon\b/i.test(code), 'something is granted to anon')
  assert.match(code, /'monitor_ingest\(text, jsonb\)', 'monitor_sweep\(\)'\] loop[\s\S]*grant execute on function public\.%s to service_role/)
  assert.match(code, /revoke all on function public\.monitor_ingest\(text, jsonb\) from authenticated/)
})

test('all eight tables have row level security, a write guard, and no policy that allows a write', () => {
  const tables = [...code.matchAll(/create table if not exists public\.(monitor_\w+)/g)].map((m) => m[1])
  assert.equal(tables.length, 8)
  for (const t of tables) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`), `${t} has no RLS`)
    assert.match(code, new RegExp(`'${t}'`), `${t} is not in the write-guard list`)
  }
  assert.ok(!/create policy[^;]*\bfor (insert|update|delete|all)\b/i.test(code), 'a policy grants writes')
  assert.ok(!/grant (insert|update|delete|all)[^;]*monitor_/i.test(code), 'a write privilege is granted on a monitor table')
})

test('key material is never selectable and raw events have no policy at all', () => {
  assert.match(code, /grant select \(id, project_id, label, key_prefix, scopes, active, expires_at, created_by, created_at, revoked_at, revoked_by, last_used_at\) on public\.monitor_keys to authenticated;/)
  assert.ok(!/policy[^;]*on public\.monitor_(events|notified)\b/i.test(code), 'raw events or the dedupe table got a policy')
  assert.ok(!/grant select[^;]*\bpublic\.monitor_(events|notified)\b[^;]*to authenticated/i.test(code.replace(/revoke[^;]*;/gi, '')), 'raw events were made readable')
})

test('the client never receives or sends a raw key hash except when creating a key, and never reads it back', () => {
  const svc = read('src/lib/services/monitor.ts')
  assert.ok(!/key_hash/.test(svc.replace(/p_key_hash/g, '')), 'a service function selects key_hash')
  assert.match(svc, /select\('id, project_id, label, key_prefix, scopes, active, expires_at, created_at, revoked_at, last_used_at'\)/)
  const pages = readdirSync(new URL('../src/pages/monitor/', import.meta.url)).filter((f) => f.endsWith('.tsx')).map((f) => read(`src/pages/monitor/${f}`)).join('\n')
  assert.ok(!/localStorage|sessionStorage/.test(pages), 'a key could be persisted in the browser')
})

test('the escalation ladder is the one documented: owner and DevOps admins, then Cybersecurity, then the Main Admin', () => {
  const fn = code.slice(code.indexOf('function public.monitor_responders'), code.indexOf('function public.monitor_notify'))
  assert.match(fn, /wd\.department_id = public\.department_id_by_slug\('devops'\)/)
  assert.match(fn, /p_level >= 1 and wd\.department_id = public\.department_id_by_slug\('cybersecurity'\)/)
  assert.match(fn, /role = 'superadmin' and p_level >= 2/)
})

test('incident history is append-only: no delete path exists in any function', () => {
  assert.ok(!/delete from public\.monitor_(incidents|incident_notes)/i.test(code))
  assert.match(code, /Monitoring history cannot be deleted/)
  assert.match(code, /Incident notes cannot be edited/)
})
