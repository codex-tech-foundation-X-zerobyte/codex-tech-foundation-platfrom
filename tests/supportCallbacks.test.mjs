import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseCustomerRequest, answerForDbError, CUSTOMER_LIMITS } from '../supabase/functions/_shared/supportCustomer.ts'
import { validateCallbackUrl, isPublicIp } from '../supabase/functions/_shared/safeUrl.ts'
import { signWebhook, verifyWebhook, hmacHex } from '../supabase/functions/_shared/webhookSign.ts'
import { deliver } from '../supabase/functions/_shared/callbackDelivery.ts'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ---- the customer request ----
test('a customer request needs a known action and a reference', () => {
  assert.equal(parseCustomerRequest(null).ok, false)
  assert.equal(parseCustomerRequest([]).ok, false)
  assert.match(parseCustomerRequest({ action: 'status' }).error, /external_ref/)
  assert.match(parseCustomerRequest({ action: 'status', external_ref: ' ' }).error, /external_ref/)
  assert.match(parseCustomerRequest({ action: 'status', external_ref: 'x'.repeat(201) }).error, /external_ref/)
  assert.match(parseCustomerRequest({ action: 'delete', external_ref: 'a' }).error, /action must be/)
  assert.deepEqual(parseCustomerRequest({ action: 'status', external_ref: ' ORD-1 ' }).request, { action: 'status', external_ref: 'ORD-1' })
})

test('a reply needs real text, within the limit, and no card numbers or secrets', () => {
  assert.match(parseCustomerRequest({ action: 'reply', external_ref: 'a', body: '  ' }).error, /body is required/)
  assert.match(parseCustomerRequest({ action: 'reply', external_ref: 'a', body: 'x'.repeat(CUSTOMER_LIMITS.reply + 1) }).error, /too long/)
  assert.match(parseCustomerRequest({ action: 'reply', external_ref: 'a', body: 'my card is 4242 4242 4242 4242' }).error, /card number/)
  assert.match(parseCustomerRequest({ action: 'reply', external_ref: 'a', body: 'key sk_live_' + 'a'.repeat(24) }).error, /contains/)
  assert.deepEqual(parseCustomerRequest({ action: 'reply', external_ref: 'a', body: ' still broken ' }).request, { action: 'reply', external_ref: 'a', body: 'still broken' })
})

test('a rating is a whole number from 1 to 5, with an optional short note', () => {
  for (const bad of [0, 6, 3.5, '4', null, undefined, NaN]) assert.equal(parseCustomerRequest({ action: 'rating', external_ref: 'a', rating: bad }).ok, false, String(bad))
  assert.deepEqual(parseCustomerRequest({ action: 'rating', external_ref: 'a', rating: 5, note: ' great ' }).request, { action: 'rating', external_ref: 'a', rating: 5, note: 'great' })
  assert.equal(parseCustomerRequest({ action: 'rating', external_ref: 'a', rating: 1 }).request.note, null)
  assert.match(parseCustomerRequest({ action: 'rating', external_ref: 'a', rating: 1, note: 'n'.repeat(1001) }).error, /note is too long/)
})

test('an attachment request needs an attachment id', () => {
  assert.match(parseCustomerRequest({ action: 'attachment', external_ref: 'a', attachment_id: '../../x' }).error, /attachment_id/)
  assert.equal(parseCustomerRequest({ action: 'attachment', external_ref: 'a', attachment_id: '3F2504E0-4F89-41D3-9A0C-0305E82C3301' }).request.attachment_id, '3f2504e0-4f89-41d3-9a0c-0305e82c3301')
})

test('database errors become honest answers, and unexpected ones reveal nothing', () => {
  assert.deepEqual(answerForDbError({ code: 'P0002', message: 'Ticket not found.' }), { status: 404, message: 'Ticket not found.' })
  assert.equal(answerForDbError({ code: '23514', message: 'This ticket is closed. Open a new one.' }).status, 409)
  assert.equal(answerForDbError({ code: '23514', message: 'This ticket is closed. Open a new one.' }).message, 'This ticket is closed. Open a new one.')
  assert.equal(answerForDbError({ code: '22023', message: 'Rating must be 1 to 5.' }).status, 400)
  const secret = answerForDbError({ code: 'XX000', message: 'relation "support_callbacks" secret column leak' })
  assert.equal(secret.status, 500); assert.ok(!/support_callbacks|secret/.test(secret.message))
  assert.equal(answerForDbError({}).status, 500)
})

// ---- where a callback may go ----
test('the TypeScript address check agrees with the database on every case in the SQL test table', () => {
  const sql = read('supabase/tests/support_completion.test.sql')
  const block = sql.slice(sql.indexOf('select tst.expect_true((select bool_and(support_callback_url_ok(u) = ok)'), sql.indexOf('the address check accepts normal'))
  const cases = [...block.matchAll(/\('([^']*)', (true|false)\)/g)].map((m) => [m[1], m[2] === 'true'])
  assert.ok(cases.length >= 20, `expected the shared table, found ${cases.length}`)
  for (const [url, ok] of cases) assert.equal(validateCallbackUrl(url).ok, ok, `${url} should be ${ok ? 'allowed' : 'refused'}`)
  assert.equal(validateCallbackUrl('https://' + 'a'.repeat(300) + '.dev/').ok, false)
})

test('an address is refused for the right reason', () => {
  assert.match(validateCallbackUrl('http://shop.dev/x').reason, /https/)
  assert.match(validateCallbackUrl('https://127.0.0.1/x').reason, /domain name/)
  assert.match(validateCallbackUrl('https://db.internal/x').reason, /Internal/)
  assert.match(validateCallbackUrl('https://u:p@shop.dev/x').reason, /Credentials/)
  assert.match(validateCallbackUrl('https://shop.dev:9000/x').reason, /port/)
  assert.match(validateCallbackUrl('https://shop.dev/x#a').reason, /fragment/)
  assert.match(validateCallbackUrl('https://shop.dev/a b').reason, /spaces/)
  assert.equal(validateCallbackUrl('HTTPS://Shop.Dev/Hook').host, 'shop.dev')
})

test('only addresses on the public internet count as public', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) assert.equal(isPublicIp(ip), true, ip)
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '2001:db8::1', '2002:c0a8:0101::1', '2001:0:4136:e378::1',
    '300.1.1.1', '1.2.3', 'not an ip', '', '1.2.3.4.5', '::ffff:999.1.1.1']) assert.equal(isPublicIp(ip), false, ip)
  assert.equal(isPublicIp('::ffff:8.8.8.8'), true)   // an IPv4 address written in IPv6 form is judged as the IPv4 address it is
})

// ---- signing ----
test('the signature is HMAC-SHA256 over "timestamp.body", matching an independent implementation', async () => {
  const expected = createHmac('sha256', 's3cret').update('1700000000.{"a":1}').digest('hex')
  assert.equal(await hmacHex('s3cret', '1700000000.{"a":1}'), expected)
  assert.equal(await signWebhook('s3cret', 1700000000, '{"a":1}'), `t=1700000000,v1=${expected}`)
})

test('a receiver accepts the real signature, and refuses tampering, a wrong secret, a stale timestamp and a bad header', async () => {
  const body = '{"event":"ticket.reply"}'
  const sig = await signWebhook('k'.repeat(64), 1700000000, body)
  assert.equal(await verifyWebhook('k'.repeat(64), sig, body, 1700000100), true)
  assert.equal(await verifyWebhook('k'.repeat(64), sig, body + ' ', 1700000100), false)
  assert.equal(await verifyWebhook('j'.repeat(64), sig, body, 1700000100), false)
  assert.equal(await verifyWebhook('k'.repeat(64), sig, body, 1700000000 + 301), false)
  assert.equal(await verifyWebhook('k'.repeat(64), sig, body, 1700000000 - 301), false)
  for (const h of [null, '', 'v1=abc', 't=1,v1=zz', sig.replace('t=', 't=x')]) assert.equal(await verifyWebhook('k'.repeat(64), h, body, 1700000100), false, String(h))
})

// ---- delivery ----
const pay = { event: 'ticket.reply', sequence: 7, ticket_ref: 'TCK-1', external_ref: 'ORD-1', message: { body: 'Hello', at: '2026-10-29T10:00:00Z' } }
const row = (o = {}) => ({ event_id: 'e-1', url: 'https://api.shopfront.dev/hook', secret: 'k'.repeat(64), event: 'ticket.reply', payload: pay, attempts: 0, ...o })
function net({ status = 204, addrs = ['93.184.216.34'], throws = null, resolveThrows = false } = {}) {
  const calls = { fetch: [], resolve: [], cancelled: 0 }
  return { calls, deps: {
    nowMs: () => 1700000000_000,
    resolve: async (h) => { calls.resolve.push(h); if (resolveThrows) throw new Error('nxdomain'); return addrs },
    fetch: async (url, init) => { calls.fetch.push({ url, init }); if (throws) throw throws; return { status, body: { cancel: async () => { calls.cancelled++ } } } },
  } }
}

test('a good delivery is one signed POST that does not follow redirects, with a timeout, and the answer is never read', async () => {
  const { calls, deps } = net()
  const r = await deliver(row(), deps)
  assert.deepEqual(r, { ok: true, http: 204, error: null })
  assert.equal(calls.fetch.length, 1)
  const { url, init } = calls.fetch[0]
  assert.equal(url, 'https://api.shopfront.dev/hook'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal)
  assert.equal(init.body, JSON.stringify(pay))
  assert.equal(init.headers['x-codex-event'], 'ticket.reply'); assert.equal(init.headers['x-codex-event-id'], 'e-1'); assert.equal(init.headers['x-codex-delivery-attempt'], '1')
  assert.equal(await verifyWebhook('k'.repeat(64), init.headers['x-codex-signature'], init.body, 1700000000), true)
  assert.ok(!JSON.stringify(init.headers).includes('k'.repeat(64)), 'the secret is never sent')
  assert.equal(calls.cancelled, 1)
})

test('the attempt number rises with each retry', async () => {
  const { calls, deps } = net()
  await deliver(row({ attempts: 3 }), deps)
  assert.equal(calls.fetch[0].init.headers['x-codex-delivery-attempt'], '4')
})

test('a failing receiver is reported with its status, a redirect is not followed', async () => {
  assert.deepEqual(await deliver(row(), net({ status: 503 }).deps), { ok: false, http: 503, error: 'The receiver answered HTTP 503.' })
  const r = await deliver(row(), net({ status: 302 }).deps)
  assert.equal(r.ok, false); assert.equal(r.http, 302); assert.match(r.error, /redirect/)
  assert.equal((await deliver(row(), net({ status: 199 }).deps)).ok, false)
  assert.equal((await deliver(row(), net({ status: 200 }).deps)).ok, true)
})

test('a name that resolves to ANY private address is never contacted', async () => {
  for (const addrs of [['10.0.0.5'], ['127.0.0.1'], ['169.254.169.254'], ['93.184.216.34', '10.0.0.5'], ['2606:4700::1', '::1'], ['::ffff:192.168.0.1']]) {
    const { calls, deps } = net({ addrs })
    const r = await deliver(row(), deps)
    assert.equal(r.ok, false, addrs.join()); assert.match(r.error, /non-public/); assert.equal(calls.fetch.length, 0, 'no request may be made: ' + addrs.join())
  }
})

test('an unusable address, or a name that does not resolve, stops before any request', async () => {
  for (const url of ['http://api.shopfront.dev/x', 'https://127.0.0.1/x', 'https://db.internal/x', 'https://shop.dev:8080/x']) {
    const { calls, deps } = net()
    const r = await deliver(row({ url }), deps)
    assert.equal(r.ok, false); assert.match(r.error, /^Blocked:/); assert.equal(calls.resolve.length, 0); assert.equal(calls.fetch.length, 0)
  }
  const a = net({ resolveThrows: true }); assert.match((await deliver(row(), a.deps)).error, /could not be looked up/); assert.equal(a.calls.fetch.length, 0)
  const b = net({ addrs: [] }); assert.match((await deliver(row(), b.deps)).error, /no address/); assert.equal(b.calls.fetch.length, 0)
})

test('timeouts and connection failures are named without leaking internals', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout at 10.1.2.3'), { name: 'TimeoutError' })
  const t = await deliver(row(), net({ throws: timeout }).deps)
  assert.deepEqual(t, { ok: false, http: null, error: 'The receiver did not answer in time.' })
  const c = await deliver(row(), net({ throws: new Error('connect ECONNREFUSED 10.1.2.3:443') }).deps)
  assert.deepEqual(c, { ok: false, http: null, error: 'Could not connect to the receiver.' })
})

// ---- the edge functions ----
test('support-ticket authenticates by key, throttles by IP and by key before reading the body, and never answers with a raw error', () => {
  const f = read('supabase/functions/support-ticket/index.ts')
  assert.match(f, /x-support-key/)
  assert.ok(f.indexOf('KEY_SHAPE.test(key)') < f.indexOf('adminClient()'), 'a malformed key never reaches the database')
  assert.ok(f.indexOf('await enforceRateLimit(') > 0 && f.indexOf('await enforceRateLimit(') < f.indexOf('await readTextLimited('), 'throttle before reading the body')
  assert.match(f, /enforceRateLimitByKey/)
  assert.match(f, /Cache-Control': 'no-store'/)
  assert.match(f, /createSignedUrl\(.*\.path, 60\)/)
  assert.ok(!/error\.message/.test(f.replace(/answerForDbError\(error\)/g, '')), 'a raw database message is never returned')
  assert.ok(!/console\.(log|error)\([^)]*\bkey\b/.test(f), 'the key is never logged')
  assert.ok(!/p_key_hash:\s*key\b/.test(f), 'only the hash goes to the database')
  assert.ok(!/Access-Control-Allow-Origin/.test(f), 'server to server only: no browser access')
})

test('callback delivery can never follow a redirect or wait forever, and the secret never leaves the worker', () => {
  const f = read('supabase/functions/_shared/callbackDelivery.ts')
  assert.match(f, /redirect: 'manual'/); assert.ok(!/redirect: 'follow'/.test(f)); assert.match(f, /AbortSignal\.timeout/)
  assert.ok(f.indexOf('isPublicIp') < f.indexOf('deps.fetch('), 'addresses are checked before connecting')
  const sweep = read('supabase/functions/workspace-sweep/index.ts')
  assert.ok(!/console\.(log|error)\([^)]*secret/i.test(sweep.replace('WORKSPACE_SWEEP_SECRET', '')))
  assert.match(sweep, /const part = async/)   // each part isolated: one failing never stops the others
  assert.match(sweep, /support_callbacks_claim/); assert.match(sweep, /support_callback_report/); assert.match(sweep, /support_sweep/)
})

test('the limits agree with the database', () => {
  const sql = read('supabase/migrations/20261005000000_support_completion.sql')
  assert.match(sql, new RegExp(`left\\(btrim\\(p_body\\), ${CUSTOMER_LIMITS.reply}\\)`))
  assert.match(sql, new RegExp(`left\\(btrim\\(coalesce\\(p_note, ''\\)\\), ${CUSTOMER_LIMITS.note}\\)`))
  assert.match(sql, /char_length\(url\) <= 300|char_length\(p_url\) <= 300/)
})
