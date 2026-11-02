import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { parseBatch, parseEvent, MONITOR_KEY_SHAPE, MONITOR_LIMITS, sha256Hex } from '../supabase/functions/_shared/monitorIngest.ts'
import { PRIVATE_PUSH_KINDS, notificationPush, PRIVATE_PUSH_BODY } from '../supabase/functions/_shared/pushPayload.ts'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ev = (o = {}) => ({ event_id: 'e1', kind: 'error', message: 'boom', ...o })

test('a monitor key is ctfm_ plus 48 lowercase hex characters, and a support key is not one', () => {
  assert.ok(MONITOR_KEY_SHAPE.test('ctfm_' + 'a1'.repeat(24)))
  assert.ok(!MONITOR_KEY_SHAPE.test('ctfs_' + 'a1'.repeat(24)))   // the Customer Service key must not open the monitor
  assert.ok(!MONITOR_KEY_SHAPE.test('ctfm_' + 'A1'.repeat(24)))
  assert.ok(!MONITOR_KEY_SHAPE.test('ctfm_' + 'a1'.repeat(23)))
  assert.ok(!MONITOR_KEY_SHAPE.test('ctfm_' + 'a1'.repeat(24) + 'x'))
  assert.ok(!MONITOR_KEY_SHAPE.test(''))
})

test('a valid event passes through, with kind and level normalised', () => {
  const r = parseEvent(ev({ kind: 'ERROR', level: 'FATAL', release: '1.2.0', sdk_name: 'x', sdk_version: '0.1.0', route: '/a', status_code: 500, latency_ms: 12.6, environment: 'staging' }))
  assert.ok(r.ok)
  assert.deepEqual(r.event, { event_id: 'e1', kind: 'error', level: 'fatal', message: 'boom', release: '1.2.0', sdk_name: 'x', sdk_version: '0.1.0', route: '/a', status_code: 500, latency_ms: 13, environment: 'staging' })
})

test('an event needs a known kind and an event_id (without one a retry would be counted twice)', () => {
  assert.match(parseEvent(ev({ kind: 'bogus' })).reason, /unknown kind/)
  assert.match(parseEvent({ kind: 'error' }).reason, /event_id/)
  assert.match(parseEvent(ev({ event_id: '   ' })).reason, /event_id/)
  assert.match(parseEvent('text').reason, /not an object/)
  assert.match(parseEvent(null).reason, /not an object/)
  assert.match(parseEvent([1]).reason, /not an object/)
})

test('unknown fields are dropped, so nothing unexpected is ever forwarded or stored', () => {
  const r = parseEvent(ev({ password: 'hunter2', authorization: 'Bearer abc', user: { email: 'a@b.c' }, __proto__x: 1 }))
  assert.ok(r.ok)
  assert.deepEqual(Object.keys(r.event).sort(), ['event_id', 'kind', 'message'])
})

test('numbers are coerced when sensible and dropped when not; they never fail the event', () => {
  assert.equal(parseEvent(ev({ latency_ms: '250' })).event.latency_ms, 250)
  assert.equal(parseEvent(ev({ latency_ms: -5 })).event.latency_ms, undefined)
  assert.equal(parseEvent(ev({ latency_ms: 700000 })).event.latency_ms, undefined)
  assert.equal(parseEvent(ev({ latency_ms: 'fast' })).event.latency_ms, undefined)
  assert.equal(parseEvent(ev({ latency_ms: Infinity })).event.latency_ms, undefined)
  assert.equal(parseEvent(ev({ status_code: 99 })).event.status_code, undefined)
  assert.equal(parseEvent(ev({ status_code: 600 })).event.status_code, undefined)
  assert.equal(parseEvent(ev({ status_code: '404' })).event.status_code, 404)
})

test('dates: a good one is normalised to ISO, a bad one is dropped', () => {
  assert.equal(parseEvent(ev({ occurred_at: '2026-10-28T10:00:00+01:00' })).event.occurred_at, '2026-10-28T09:00:00.000Z')
  assert.equal(parseEvent(ev({ occurred_at: 'yesterday-ish' })).event.occurred_at, undefined)
  assert.equal(parseEvent(ev({ occurred_at: 12345 })).event.occurred_at, undefined)
})

test('long text is clamped to the same limits the database enforces', () => {
  const r = parseEvent(ev({ message: 'm'.repeat(2000), stack: 's'.repeat(9000), route: 'r'.repeat(900), release: 'x'.repeat(500), event_id: 'i'.repeat(400) }))
  assert.equal(r.event.message.length, MONITOR_LIMITS.message)
  assert.equal(r.event.stack.length, MONITOR_LIMITS.stack)
  assert.equal(r.event.route.length, MONITOR_LIMITS.route)
  assert.equal(r.event.release.length, MONITOR_LIMITS.short)
  assert.equal(r.event.event_id.length, MONITOR_LIMITS.id)
})

test('a batch can be a single event, a bare list, or { events }', () => {
  assert.equal(parseBatch(ev()).events.length, 1)
  assert.equal(parseBatch([ev(), ev({ event_id: 'e2' })]).events.length, 2)
  assert.equal(parseBatch({ events: [ev()] }).events.length, 1)
  assert.deepEqual(parseBatch([]), { ok: true, events: [], rejected: 0, reasons: [] })
  assert.match(parseBatch({ nothing: true }).error, /Send an event/)
  assert.match(parseBatch('x').error, /Send an event/)
  assert.match(parseBatch(null).error, /Send an event/)
})

test('a batch is capped at 50 events, and 50 exactly is fine', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ev({ event_id: 'e' + i }))
  assert.equal(parseBatch(many(50)).events.length, 50)
  assert.match(parseBatch(many(51)).error, /At most 50/)
})

test('in a mixed batch the bad events are counted and explained, and the good ones still go through', () => {
  const r = parseBatch([ev(), { kind: 'nope', event_id: 'x' }, { kind: 'error' }, 'text', ev({ event_id: 'e2' })])
  assert.ok(r.ok)
  assert.equal(r.events.length, 2)
  assert.equal(r.rejected, 3)
  assert.deepEqual(r.reasons.map((s) => s.split(':')[0]), ['event 1', 'event 2', 'event 3'])
})

test('the explanation lists at most five reasons, and an all-bad batch is refused with them', () => {
  const r = parseBatch(Array.from({ length: 12 }, () => ({ kind: 'nope', event_id: 'x' })))
  assert.equal(r.ok, false)
  assert.equal(r.reasons.length, 5)
  assert.match(r.error, /No valid events/)
})

test('sha256Hex matches the digest the database compares against', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

// ---- drift guards: the wire limits here and the database's own must agree ----
test('the TypeScript limits equal the SQL ones (batch 50, message 500, stack 4000, route 200)', () => {
  const sql = read('supabase/migrations/20261004000000_super_monitor.sql')
  assert.match(sql, new RegExp(`v_incoming > ${MONITOR_LIMITS.batch} then raise`))
  assert.match(sql, new RegExp(`At most ${MONITOR_LIMITS.batch} events`))
  assert.match(sql, new RegExp(`char_length\\(message\\) <= ${MONITOR_LIMITS.message}`))
  assert.match(sql, new RegExp(`char_length\\(stack\\) <= ${MONITOR_LIMITS.stack}`))
  assert.match(sql, new RegExp(`route is null or char_length\\(route\\) <= ${MONITOR_LIMITS.route}`))
  assert.match(sql, new RegExp(`left\\(btrim\\(coalesce\\(e ->> 'event_id', ''\\)\\), ${MONITOR_LIMITS.id}\\)`))
})

test('the TypeScript kinds and levels equal the SQL check constraints', () => {
  const sql = read('supabase/migrations/20261004000000_super_monitor.sql')
  assert.match(sql, /kind\s+text not null check \(kind in \('error', 'message', 'latency', 'heartbeat'\)\)/)
  assert.match(sql, /level\s+text not null check \(level in \('fatal', 'error', 'warning', 'info'\)\)/)
})

// ---- the edge functions ----
test('monitor-ingest authenticates by key, throttles by IP first, speaks CORS, and never logs the key', () => {
  const f = read('supabase/functions/monitor-ingest/index.ts')
  assert.match(f, /x-monitor-key/)
  assert.ok(f.indexOf('enforceRateLimit') < f.indexOf('readTextLimited'), 'throttle before reading the body')
  assert.ok(f.indexOf('MONITOR_KEY_SHAPE.test(key)') < f.indexOf('adminClient()'), 'a malformed key never reaches the database')
  assert.match(f, /request\.method === 'OPTIONS'/)
  assert.match(f, /28000[\s\S]*401/); assert.match(f, /54000[\s\S]*429/)
  assert.match(f, /Retry-After/)
  assert.ok(!/console\.(log|error|warn)\([^)]*\bkey\b/.test(f), 'the key must never be logged')
  assert.ok(!/p_key_hash:\s*key\b/.test(f), 'only the hash goes to the database')
})

test('workspace-sweep refuses to run without a long shared secret, and compares it in constant time before doing anything', () => {
  const f = read('supabase/functions/workspace-sweep/index.ts')
  assert.match(f, /secret\.length < 24/)
  assert.match(f, /WORKSPACE_SWEEP_SECRET/)
  assert.match(f, /503/); assert.match(f, /401/)
  assert.match(f, /safeEqual/)
  assert.ok(f.indexOf('safeEqual(request') < f.indexOf("rpc('monitor_sweep')"), 'authenticate before sweeping')
  assert.match(f, /rpc\('monitor_sweep'\)/)
  assert.ok(!existsSync(new URL('../supabase/functions/monitor-sweep', import.meta.url)), 'the old monitor-sweep function must be gone: workspace-sweep replaces it')
})

test('a push for a monitor notification never shows incident text on a lock screen', () => {
  assert.ok(PRIVATE_PUSH_KINDS.has('monitor'))
  const p = notificationPush({ id: '1', title: 'Critical incident INC-000001', body: 'Portfolio site: Errors: DB timeout', kind: 'monitor' }, 'worker')
  assert.ok(!JSON.stringify(p).includes('Portfolio'))
  assert.ok(JSON.stringify(p).includes(PRIVATE_PUSH_BODY))
})
