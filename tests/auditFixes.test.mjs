import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { clientIp, declaredTooLarge, readTextLimited } from '../supabase/functions/_shared/http.ts'
import { isAllowedPushEndpoint } from '../supabase/functions/_shared/webpush.ts'
import { notificationPush, PRIVATE_PUSH_BODY } from '../supabase/functions/_shared/pushPayload.ts'

const h = (o) => new Headers(o)

test('the rate limiter keys on an address the caller cannot choose', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })), '1.1.1.1', 'with nothing better it still falls back to the forwarded header')
  assert.equal(clientIp(h({ 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': 'spoofed, 9.9.9.9' })), '5.5.5.5', 'the edge network header beats anything the caller wrote')
  assert.equal(clientIp(h({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': 'spoofed' })), '6.6.6.6')
  assert.equal(clientIp(h({})), 'unknown')
  assert.ok(clientIp(h({ 'cf-connecting-ip': 'x'.repeat(500) })).length <= 64, 'a huge header cannot bloat the rate-limit key')
})

test('oversized bodies are refused before and while reading', async () => {
  assert.equal(declaredTooLarge(h({ 'content-length': '70000' }), 65536), true)
  assert.equal(declaredTooLarge(h({ 'content-length': '10' }), 65536), false)
  assert.equal(declaredTooLarge(h({}), 65536), false)
  assert.equal(await readTextLimited(new Request('https://x', { method: 'POST', body: 'hello' }), 100), 'hello')
  assert.equal(await readTextLimited(new Request('https://x', { method: 'POST', body: 'x'.repeat(5000) }), 100), null, 'a body that lies about (or omits) its length is still cut off')
  assert.equal(await readTextLimited(new Request('https://x', { method: 'POST', body: 'é'.repeat(60) }), 100), null, 'the limit is in bytes, not characters')
})

test('only the real push services are contacted (not any Google API host)', () => {
  assert.ok(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  for (const bad of ['https://storage.googleapis.com/some-bucket/x', 'https://content-firebaseappcheck.googleapis.com/x', 'https://evilfcm.googleapis.com/x', 'https://googleapis.com/x'])
    assert.ok(!isAllowedPushEndpoint(bad), bad)
})

test('lock-screen pushes for money and customer notifications carry no details', () => {
  for (const kind of ['fund_request', 'support']) {
    const m = notificationPush({ id: 'n1', title: 'Payment recorded', body: 'FR-2026-0042: Paystack top-up for Acme Ltd', kind }, 'worker')
    assert.equal(m.body, PRIVATE_PUSH_BODY)
    assert.ok(!JSON.stringify(m).includes('Acme') && !JSON.stringify(m).includes('Paystack'))
    assert.equal(m.title, 'Payment recorded', 'the headline stays so the person knows what needs them')
    assert.equal(m.url, '/worker/notifications')
  }
  assert.equal(notificationPush({ title: 'Task assigned', body: 'Fix login', kind: 'assignment' }, 'worker').body, 'Fix login', 'ordinary notifications are unchanged')
  assert.equal(notificationPush({ title: 'x', body: 'y' }, 'worker').body, 'y')
})

function worker() {
  const handlers = {}, shown = []
  const self = {
    location: { hostname: 'app.example.com', origin: 'https://app.example.com' },
    addEventListener: (t, fn) => { handlers[t] = fn }, skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }) } },
  }
  const caches = { match: async () => undefined, open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true }
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch: async () => new Response('x'), Response, URL, console })
  return { handlers, shown }
}
test('a push cannot send a tapped notification to another website', async () => {
  const w = worker()
  const urls = {}
  for (const url of ['/admin/notifications', '//evil.example/login', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)']) {
    w.shown.length = 0
    let p; w.handlers.push({ data: { json: () => ({ title: 't', body: 'b', url, kind: 'test' }) }, waitUntil: (x) => { p = x } }); await p
    urls[url] = w.shown[0].options.data.url
  }
  assert.equal(urls['/admin/notifications'], '/admin/notifications')
  for (const bad of ['//evil.example/login', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)']) assert.equal(urls[bad], '/', bad)
})

test('.env files are never committed', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.trim())
  assert.ok(ignore.includes('.env'), '.env is ignored')
  assert.ok(ignore.some((l) => l === '.env.*' || l === '.env.local'), 'environment variants are ignored')
  assert.ok(ignore.includes('!.env.example'), 'the example file stays tracked')
})
