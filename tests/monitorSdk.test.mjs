import test from 'node:test'
import assert from 'node:assert/strict'
import { createMonitor, fingerprintOf, SDK_NAME, SDK_VERSION } from '../sdk/super-monitor/index.mjs'

const KEY = 'ctfm_' + 'ab'.repeat(24)
const reply = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } })
function rig(statuses = [202], opts = {}) {
  const calls = []
  let i = 0
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const s = statuses[Math.min(i++, statuses.length - 1)]; if (s instanceof Error) throw s; return typeof s === 'number' ? reply(s) : s }
  const m = createMonitor({ endpoint: 'https://x.test/ingest', key: KEY, release: '1.0.0', fetch, flushIntervalMs: 1e9, ...opts })
  return { m, calls }
}

test('it refuses to start without an endpoint and a well-formed ctfm_ key', () => {
  assert.throws(() => createMonitor({ endpoint: 'https://x', key: 'nope' }), /ctfm_/)
  assert.throws(() => createMonitor({ key: KEY }), /endpoint/)
  assert.throws(() => createMonitor({ endpoint: 'https://x', key: 'ctfs_' + 'ab'.repeat(24) }), /ctfm_/)   // a support key is not accepted
})

test('it sends a batch with the key in a header, and the key nowhere in the body', async () => {
  const { m, calls } = rig()
  m.captureError(new Error('boom'), { route: '/checkout' }); m.latency('/api', 120.4, 200); m.message('hello', 'warning')
  const r = await m.flush()
  assert.equal(r.sent, 3); assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers['x-monitor-key'], KEY)
  assert.ok(!calls[0].init.body.includes(KEY))
  const [e, l, msg] = calls[0].body.events
  assert.equal(e.kind, 'error'); assert.equal(e.level, 'error'); assert.equal(e.route, '/checkout'); assert.match(e.message, /^Error: boom/)
  assert.equal(l.latency_ms, 120); assert.equal(l.status_code, 200)
  assert.equal(msg.level, 'warning')
  for (const x of calls[0].body.events) { assert.equal(x.sdk_name, SDK_NAME); assert.equal(x.sdk_version, SDK_VERSION); assert.equal(x.release, '1.0.0'); assert.equal(x.environment, 'production'); assert.ok(x.event_id) }
  assert.equal(new Set(calls[0].body.events.map((x) => x.event_id)).size, 3)
})

test('a failed send keeps the events and retries them with the SAME ids, so nothing is counted twice', async () => {
  const { m, calls } = rig([503, 202])
  m.captureError(new Error('x'))
  const first = await m.flush()
  assert.equal(first.sent, 0); assert.equal(m.pending(), 1)
  const ids = calls[0].body.events.map((e) => e.event_id)
  await new Promise((r) => setTimeout(r, 2100))   // the first back-off is 2 s
  const second = await m.flush()
  assert.equal(second.sent, 1); assert.equal(m.pending(), 0)
  assert.deepEqual(calls[1].body.events.map((e) => e.event_id), ids)
})

test('a network failure is also kept and retried, and does not throw into the app', async () => {
  const { m } = rig([new Error('offline'), 202])
  m.heartbeat()
  const r = await m.flush()
  assert.deepEqual(r, { sent: 0, retry: true }); assert.equal(m.pending(), 1)
})

test('during a back-off it does not hammer the server', async () => {
  const { m, calls } = rig([429])
  m.heartbeat(); await m.flush(); await m.flush(); await m.flush()
  assert.equal(calls.length, 1)
})

test('it honours Retry-After on a 429', async () => {
  const { m, calls } = rig([reply(429, { 'retry-after': '120' }), 202])
  m.heartbeat(); await m.flush()
  const r = await m.flush()   // still backing off for ~120 s
  assert.equal(r.sent, 0); assert.equal(calls.length, 1)
})

test('a 401 means the key was revoked: it stops for good, drops the queue and tells the app', async () => {
  let told = 0
  const { m, calls } = rig([401], { onAuthFailure: () => told++ })
  m.heartbeat(); m.heartbeat()
  const r = await m.flush()
  assert.equal(r.revoked, true); assert.equal(told, 1); assert.equal(m.pending(), 0)
  m.captureError(new Error('later')); await m.flush()
  assert.equal(calls.length, 1); assert.equal(m.pending(), 0)
})

test('a 400 (bad data) is not retried forever: the batch is dropped', async () => {
  const { m } = rig([400])
  m.captureError(new Error('x'))
  const r = await m.flush()
  assert.equal(r.sent, 1); assert.equal(r.ok, false); assert.equal(m.pending(), 0)
})

test('the queue is bounded: past the limit the oldest events go first', () => {
  let dropped = 0
  const { m } = rig([202], { maxQueue: 5, maxBatch: 50, onDrop: (n) => (dropped += n) })
  for (let i = 0; i < 9; i++) m.message('m' + i)
  assert.equal(m.pending(), 5); assert.equal(dropped, 4)
})

test('a batch never exceeds the server limit of 50, whatever maxBatch says', async () => {
  const { m, calls } = rig([202], { maxBatch: 500, maxQueue: 500 })
  for (let i = 0; i < 49; i++) m.message('m' + i)
  assert.equal(calls.length, 0)
  m.message('last')   // the 50th triggers a send
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls.length, 1); assert.equal(calls[0].body.events.length, 50)
})

test('the same error gets the same fingerprint even when numbers in the message change; a different error does not', () => {
  assert.equal(fingerprintOf('Error', 'timeout after 30 ms', 'at f (a.js:1:2)'), fingerprintOf('Error', 'timeout after 45 ms', 'at f (a.js:9:9)'))
  assert.notEqual(fingerprintOf('Error', 'timeout after 30 ms', 'at f'), fingerprintOf('Error', 'disk full', 'at f'))
  assert.notEqual(fingerprintOf('TypeError', 'x', 'at f'), fingerprintOf('RangeError', 'x', 'at f'))
  assert.match(fingerprintOf('E', 'm'), /^[0-9a-f]{16}$/)
})

test('captureError accepts strings and odd throws, and marks fatal ones', async () => {
  const { m, calls } = rig()
  m.captureError('plain string'); m.captureError({ weird: true }); m.captureError(new Error('dead'), { fatal: true })
  await m.flush()
  const ev = calls[0].body.events
  assert.match(ev[0].message, /plain string/); assert.match(ev[1].message, /Non-error thrown/); assert.equal(ev[2].level, 'fatal')
})

test('start() sends a heartbeat at once and installs global handlers; stop() removes them', async () => {
  const { m, calls } = rig()
  const handlers = {}
  const target = { addEventListener: (n, f) => (handlers[n] = f), removeEventListener: (n, f) => { if (handlers[n] === f) delete handlers[n] } }
  m.start({ target })
  assert.ok(handlers.error && handlers.unhandledrejection)
  handlers.error({ error: new Error('uncaught') }); handlers.unhandledrejection({ reason: new Error('rejected') })
  await m.flush()
  const kinds = calls[0].body.events.map((e) => e.kind + ':' + (e.message ?? ''))
  assert.ok(kinds[0].startsWith('heartbeat')); assert.ok(kinds.some((k) => k.includes('uncaught'))); assert.ok(kinds.some((k) => k.includes('rejected')))
  m.stop()
  assert.deepEqual(handlers, {})
  m.heartbeat(); assert.equal(m.pending(), 0)
})

test('start({ heartbeat: false }) installs the error handlers but never sends a heartbeat (for browser apps)', async () => {
  const { m, calls } = rig()
  const handlers = {}
  const target = { addEventListener: (n, f) => (handlers[n] = f), removeEventListener: () => {} }
  m.start({ target, heartbeat: false })
  assert.ok(handlers.error)
  assert.equal(m.pending(), 0, 'no heartbeat at start')
  handlers.error({ error: new Error('uncaught in the browser') })
  await m.flush()
  assert.deepEqual(calls[0].body.events.map((e) => e.kind), ['error'])
  m.stop()
})
