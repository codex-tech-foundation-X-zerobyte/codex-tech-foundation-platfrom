import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TRANSITIONS, ACK_MINUTES, STATUS_LABEL, HEALTH_ORDER, healthRank, nextSteps, isLive, ackLabel, p95Label, heartbeatLabel, barHeights, fillHours, newMonitorKey, ingestSnippet, BASIS_LABEL, SEVERITIES, slugFromName } from '../src/lib/monitorRules.ts'
import { MONITOR_KEY_SHAPE } from '../supabase/functions/_shared/monitorIngest.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261004000000_super_monitor.sql', import.meta.url), 'utf8')
const NOW = Date.parse('2026-10-28T12:00:00Z')
const inMin = (m) => new Date(NOW + m * 60_000).toISOString()

test('the lifecycle the screen offers is exactly the one the database enforces', () => {
  const block = sql.slice(sql.indexOf('v_ok := case i.status'), sql.indexOf('if not coalesce(v_ok, false)'))
  const fromSql = {}
  for (const m of block.matchAll(/when '(\w+)' then p_status (?:in \(([^)]*)\)|= '(\w+)')/g)) fromSql[m[1]] = (m[2] ? [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [m[3]])
  assert.deepEqual(Object.keys(fromSql).sort(), Object.keys(TRANSITIONS).sort())
  for (const [from, to] of Object.entries(fromSql)) assert.deepEqual([...TRANSITIONS[from]].sort(), [...to].sort(), `transitions from ${from}`)
})

test('every status has a label, and a resolved incident can only be reopened', () => {
  for (const s of Object.keys(TRANSITIONS)) assert.ok(STATUS_LABEL[s], s)
  assert.deepEqual(nextSteps('resolved'), ['reopened'])
  assert.ok(isLive('open') && isLive('reopened') && !isLive('resolved'))
  assert.deepEqual(nextSteps('nonsense'), [])
})

test('the acknowledgement deadlines equal the database ones', () => {
  const fn = sql.slice(sql.indexOf('function public.monitor_ack_minutes'), sql.indexOf('function public.monitor_sev_rank'))
  const m = fn.match(/case p_severity when 'critical' then (\d+) when 'high' then (\d+) when 'medium' then (\d+) else (\d+) end/)
  assert.deepEqual([ACK_MINUTES.critical, ACK_MINUTES.high, ACK_MINUTES.medium, ACK_MINUTES.low], m.slice(1).map(Number))
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low'])
})

test('a generated key matches what the ingest function accepts, is random, and has a short prefix', () => {
  const a = newMonitorKey(), b = newMonitorKey()
  assert.ok(MONITOR_KEY_SHAPE.test(a.key)); assert.notEqual(a.key, b.key)
  assert.equal(a.prefix, a.key.slice(0, 9)); assert.ok(a.key.startsWith(a.prefix) && a.prefix.startsWith('ctfm_'))
})

test('projects sort worst first', () => {
  assert.deepEqual(HEALTH_ORDER, ['down', 'degraded', 'unknown', 'healthy', 'paused'])
  const sorted = ['healthy', 'down', 'paused', 'degraded', 'unknown'].sort((a, b) => healthRank(a) - healthRank(b))
  assert.deepEqual(sorted, ['down', 'degraded', 'unknown', 'healthy', 'paused'])
})

test('the acknowledgement clock counts down, then up, and only for incidents nobody has taken', () => {
  const i = (o) => ({ status: 'open', ack_due_at: inMin(4), escalation_level: 0, ...o })
  assert.deepEqual(ackLabel(i({}), NOW), { text: 'Acknowledge within 4m', tone: 'neutral' })
  assert.equal(ackLabel(i({ ack_due_at: inMin(1) }), NOW).tone, 'warning')
  assert.deepEqual(ackLabel(i({ ack_due_at: inMin(-12) }), NOW), { text: 'Unacknowledged for 12m', tone: 'danger' })
  assert.match(ackLabel(i({ ack_due_at: inMin(-90), escalation_level: 2 }), NOW).text, /Unacknowledged for 1h 30m · escalated to level 2/)
  assert.equal(ackLabel(i({ status: 'acknowledged' }), NOW), null)
  assert.equal(ackLabel(i({ status: 'resolved' }), NOW), null)
  assert.equal(ackLabel(i({ ack_due_at: null }), NOW), null)
  assert.ok(ackLabel(i({ status: 'reopened' }), NOW))
})

test('latency bands read plainly', () => {
  assert.equal(p95Label(null), '—'); assert.equal(p95Label(undefined), '—')
  assert.equal(p95Label(250), '≤ 250 ms'); assert.equal(p95Label(1000), '≤ 1 s'); assert.equal(p95Label(2500), '≤ 2.5 s'); assert.equal(p95Label(10000), 'slower than 5 s')
})

test('heartbeat freshness: fresh, slow, late, never', () => {
  assert.equal(heartbeatLabel(null, 300, NOW).text, 'No heartbeat yet')
  assert.deepEqual(heartbeatLabel(inMin(-2), 300, NOW), { text: '2m ago', tone: 'success' })
  assert.equal(heartbeatLabel(inMin(-9), 300, NOW).tone, 'warning')
  assert.equal(heartbeatLabel(inMin(-16), 300, NOW).tone, 'danger')   // more than three intervals: the project counts as down
})

test('bar heights scale to the largest value, keep tiny non-zero values visible, and never divide by zero', () => {
  assert.deepEqual(barHeights([0, 5, 10]), [0, 50, 100])
  assert.deepEqual(barHeights([0, 0, 0]), [0, 0, 0])
  assert.deepEqual(barHeights([1, 1000]), [6, 100])
  assert.deepEqual(barHeights([]), [])
})

test('hours with no events are filled in as zeros, oldest first, so a quiet hour is a visible gap', () => {
  const rows = [{ bucket: '2026-10-28T11:00:00.000Z', events: 7, errors: 1 }]
  const out = fillHours(rows, 4, { events: 0, errors: 0 }, NOW)
  assert.deepEqual(out.map((r) => r.bucket.slice(11, 13)), ['09', '10', '11', '12'])
  assert.deepEqual(out.map((r) => r.events), [0, 0, 7, 0])
})

test('the dashboard figure kinds are all explained', () => {
  for (const k of ['actual', 'reconciled', 'pending', 'estimated']) assert.ok(BASIS_LABEL[k].label && BASIS_LABEL[k].hint, k)
})

test('the SDK snippet names the real ingest endpoint and never contains a key', () => {
  const s = ingestSnippet('https://abc.supabase.co/functions/v1/monitor-ingest')
  assert.match(s, /functions\/v1\/monitor-ingest/); assert.match(s, /process\.env\.MONITOR_KEY/); assert.ok(!/ctfm_[0-9a-f]{48}/.test(s))
})

test('a project name becomes a slug the database accepts', () => {
  const ok = /^[a-z0-9][a-z0-9-]{1,39}$/
  assert.equal(slugFromName('Portfolio site (v2)!'), 'portfolio-site-v2')
  assert.equal(slugFromName('  --Hello   World--  '), 'hello-world')
  assert.equal(slugFromName('Ünïcode Café'), 'unicode-cafe')   // accents are removed, not turned into gaps
  assert.equal(slugFromName('!!!'), '')
  const long = slugFromName('a'.repeat(39) + ' b' + ' c'.repeat(10))
  assert.ok(long.length <= 40 && !long.endsWith('-') && ok.test(long))
  assert.ok(ok.test(slugFromName('Marketing site')))
  assert.ok(slugFromName('x').length < 2)   // too short: the form keeps the button disabled until the name is long enough
})
