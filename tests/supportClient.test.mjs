import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupportClient, verifyCallback, SupportError } from '../sdk/support-client/index.mjs'
import { signWebhook } from '../supabase/functions/_shared/webhookSign.ts'

const KEY = 'ctfs_' + 'ab'.repeat(24)
const BASE = 'https://abc.supabase.co/functions/v1'
const reply = (status, body, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => { if (body === undefined) throw new Error('not json'); return body } })
function rig(answers, opts = {}) {
  const calls = []; let i = 0
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return a }
  return { calls, c: createSupportClient({ baseUrl: BASE, key: KEY, fetch, wait: async () => {}, ...opts }) }
}

test('it refuses a missing, malformed or wrong-kind key, and a bad address', () => {
  assert.throws(() => createSupportClient({ baseUrl: BASE, key: 'nope' }), /ctfs_/)
  assert.throws(() => createSupportClient({ baseUrl: BASE, key: 'ctfm_' + 'ab'.repeat(24) }), /monitor key does not work/)
  assert.throws(() => createSupportClient({ key: KEY }), /baseUrl/)
  assert.throws(() => createSupportClient({ baseUrl: 'http://abc.supabase.co/functions/v1', key: KEY }), /https/)
  assert.doesNotThrow(() => createSupportClient({ baseUrl: 'http://127.0.0.1:54321/functions/v1', key: KEY }))
  assert.doesNotThrow(() => createSupportClient({ baseUrl: BASE + '/', key: KEY }))
})

test('it refuses to start in a browser, because the key would be public', () => {
  globalThis.window = { document: {} }
  try { assert.throws(() => createSupportClient({ baseUrl: BASE, key: KEY }), /stay on your server/) } finally { delete globalThis.window }
})

test('a ticket is one POST to support-intake, with the key only in the header', async () => {
  const { c, calls } = rig([reply(201, { ticket: 'TCK-000042', duplicate: false })])
  const r = await c.createTicket({ external_ref: ' ORD-77 ', subject: 'Cannot log in', description: 'x', customer_ref: 'u9', customer_name: 'Ada', category: 'account', priority: 'high' })
  assert.deepEqual(r, { ticket: 'TCK-000042', duplicate: false })
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `${BASE}/support-intake`)
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers['x-support-key'], KEY)
  assert.ok(!calls[0].init.body.includes(KEY)); assert.equal(calls[0].body.external_ref, 'ORD-77')
})

test('sending the same report again is reported as a duplicate, not an error', async () => {
  const { c } = rig([reply(200, { ticket: 'TCK-000042', duplicate: true })])
  assert.deepEqual(await c.createTicket({ external_ref: 'ORD-77', subject: 'x y z' }), { ticket: 'TCK-000042', duplicate: true })
})

test('creating a ticket is retried on a server error and a network failure, with the same reference', async () => {
  const { c, calls } = rig([reply(503, { error: 'busy' }), new Error('ECONNRESET'), reply(201, { ticket: 'TCK-1', duplicate: false })])
  const r = await c.createTicket({ external_ref: 'ORD-1', subject: 'abc' })
  assert.equal(r.ticket, 'TCK-1'); assert.equal(calls.length, 3)
  assert.deepEqual(new Set(calls.map((x) => x.body.external_ref)), new Set(['ORD-1']))
})

test('it gives up after the retries, and says so without revealing the key', async () => {
  const { c, calls } = rig([reply(500, undefined)])
  await assert.rejects(c.createTicket({ external_ref: 'ORD-1', subject: 'abc' }), (e) => e instanceof SupportError && e.status === 500 && !e.message.includes(KEY))
  assert.equal(calls.length, 3)
  const net = rig([new Error('connect to 10.1.2.3 failed')])
  await assert.rejects(net.c.createTicket({ external_ref: 'a', subject: 'abc' }), (e) => e.status === 0 && e.message === 'Could not reach the support service.' && !/10\.1\.2\.3/.test(e.message))
})

test('a refusal is never retried: 4xx answers surface at once with the service\'s own words', async () => {
  const { c, calls } = rig([reply(422, { error: 'The report seems to contain what looks like a card number.' })])
  await assert.rejects(c.createTicket({ external_ref: 'a', subject: 'abc' }), (e) => e.status === 422 && /card number/.test(e.message))
  assert.equal(calls.length, 1)
})

test('a rate limit carries how long to wait', async () => {
  const { c } = rig([reply(429, { error: 'Too many requests. Slow down.' }, { 'retry-after': '60' })])
  await assert.rejects(c.getTicket('ORD-1'), (e) => e.status === 429 && e.retryAfterSeconds === 60)
})

test('the customer actions go to support-ticket, and reply and rating are never retried (a retry would send them twice)', async () => {
  const { c, calls } = rig([reply(200, { ticket: { ref: 'T', status: 'open' }, messages: [] }), reply(200, { ok: true }), reply(200, { ok: true }), reply(200, { url: 'https://s/x', name: 'a.pdf', mime_type: 'application/pdf', expires_in: 60 })])
  assert.equal((await c.getTicket('ORD-1')).ticket.status, 'open')
  await c.reply('ORD-1', 'still broken'); await c.rate('ORD-1', 5, 'Quick!'); const f = await c.attachmentLink('ORD-1', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')
  assert.equal(f.expires_in, 60)
  assert.deepEqual(calls.map((x) => x.url), Array(4).fill(`${BASE}/support-ticket`))
  assert.deepEqual(calls.map((x) => x.body.action), ['status', 'reply', 'rating', 'attachment'])
  assert.equal(calls[2].body.rating, 5); assert.equal(calls[2].body.note, 'Quick!')
  const bad = rig([reply(500, { error: 'x' }), reply(200, { ok: true })])
  await assert.rejects(bad.c.reply('ORD-1', 'hello'), (e) => e.status === 500)
  assert.equal(bad.calls.length, 1, 'a failed reply is not re-sent automatically')
})

test('an empty reference is refused before anything is sent', async () => {
  const { c, calls } = rig([reply(200, {})])
  await assert.rejects(c.getTicket('  '), /external_ref is required/); await assert.rejects(c.createTicket({ subject: 'x' }), /external_ref is required/)
  assert.equal(calls.length, 0)
})

test('verifyCallback accepts what the workspace really signs, and rejects tampering, a wrong secret, a stale time and a parsed body', async () => {
  const secret = 'k'.repeat(64), body = '{"event":"ticket.reply","sequence":4}'
  const header = await signWebhook(secret, 1700000000, body)
  const now = { nowSeconds: 1700000100 }
  assert.equal(await verifyCallback(secret, header, body, now), true)
  assert.equal(await verifyCallback(secret, header, body + ' ', now), false)
  assert.equal(await verifyCallback(secret, header, JSON.stringify(JSON.parse(body), null, 2), now), false, 're-serialised JSON is not the received text')
  assert.equal(await verifyCallback('j'.repeat(64), header, body, now), false)
  assert.equal(await verifyCallback(secret, header, body, { nowSeconds: 1700000000 + 301 }), false)
  assert.equal(await verifyCallback(secret, header, JSON.parse(body), now), false, 'a parsed object is not the raw body')
  for (const h of [null, '', 'v1=abc', 't=1,v1=zz']) assert.equal(await verifyCallback(secret, h, body, now), false)
})

// ---- what "no npm install" means, enforced ----
import { readFileSync, existsSync } from 'node:fs'
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('both SDK files have no imports at all: copy the file in and it runs (no npm install, no bundler setup)', () => {
  for (const f of ['sdk/super-monitor/index.mjs', 'sdk/support-client/index.mjs']) {
    const code = read(f)
    assert.ok(!/^\s*import\s/m.test(code), `${f} imports something`)
    assert.ok(!/\brequire\(/.test(code), `${f} uses require`)
    assert.ok(!/process\.env|process\.|Buffer\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f} depends on Node-only globals, so it would not run in Deno, Bun or a worker`)
  }
})

test('the type declarations name every export of the code they describe', () => {
  for (const dir of ['super-monitor', 'support-client']) {
    const js = read(`sdk/${dir}/index.mjs`), d = read(`sdk/${dir}/index.d.mts`)
    assert.ok(existsSync(new URL(`../sdk/${dir}/index.d.mts`, import.meta.url)))
    const names = [...js.matchAll(/^export (?:async function|function|class|const) (\w+)/gm)].map((m) => m[1])
    assert.ok(names.length >= 2, dir)
    for (const n of names) assert.match(d, new RegExp(`export (?:declare )?(?:function|class|const) ${n}\\b`), `${dir}: ${n} is exported but not declared`)
  }
})

test('the support client\'s callback verifier and the workspace\'s signer agree on the header format', () => {
  assert.match(read('supabase/functions/_shared/webhookSign.ts'), /`t=\$\{timestampSeconds\},v1=\$\{/)
  assert.match(read('sdk/support-client/index.mjs'), /\^t=\(\\d\{1,12\}\),v1=\(\[0-9a-f\]\{64\}\)\$/)
})
