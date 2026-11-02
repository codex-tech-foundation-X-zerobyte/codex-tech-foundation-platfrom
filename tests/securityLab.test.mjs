import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeSecurityHeaders, parseHeaders, analyzeLog, lookupDns, normaliseDomain, emailAuthFindings, scoreChecklist, CONFIG_CHECKLIST, normaliseMessage,
} from '../src/lib/securityLab.ts'

const GOOD = `HTTP/2 200
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; frame-ancestors 'none'
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=()
cross-origin-opener-policy: same-origin
set-cookie: sid=abc; Secure; HttpOnly; SameSite=Lax
`
const byId = (r, id) => r.findings.find((f) => f.id === id)

test('parseHeaders reads curl output, folds continuation lines, lowercases names and keeps repeats', () => {
  const p = parseHeaders('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nX-Long: one\r\n  two\r\n')
  assert.equal(p.status, 'HTTP/1.1 200 OK')
  assert.deepEqual(p.headers['set-cookie'], ['a=1', 'b=2'])
  assert.equal(p.headers['x-long'][0], 'one two')
  assert.equal(p.headers['content-type'][0], 'text/html')
})

test('a well-configured response passes every scored check', () => {
  const r = analyzeSecurityHeaders(GOOD)
  assert.equal(r.score, 100)
  assert.ok(r.findings.every((f) => f.severity === 'pass' || f.severity === 'info'))
})

test('missing headers fail and are named, and an empty paste scores 0 with nothing invented', () => {
  const r = analyzeSecurityHeaders('HTTP/1.1 200 OK\ncontent-type: text/html\n')
  for (const id of ['hsts', 'csp', 'nosniff', 'framing']) assert.equal(byId(r, id).severity, 'fail', id)
  assert.equal(r.score, 0)
  assert.equal(analyzeSecurityHeaders('').headerCount, 0)
})

test('weak settings are flagged with the reason', () => {
  const r = analyzeSecurityHeaders(`strict-transport-security: max-age=300
content-security-policy: default-src *; script-src 'self' 'unsafe-inline' 'unsafe-eval'
x-powered-by: Express
server: nginx/1.18.0
referrer-policy: unsafe-url
set-cookie: sid=1
access-control-allow-origin: *
access-control-allow-credentials: true`)
  assert.equal(byId(r, 'hsts').severity, 'warn')
  assert.match(byId(r, 'csp').detail, /unsafe-inline/)
  assert.match(byId(r, 'csp').detail, /unsafe-eval/)
  assert.equal(byId(r, 'powered').severity, 'warn')
  assert.equal(byId(r, 'server').severity, 'warn')
  assert.equal(byId(r, 'referrer').severity, 'warn')
  assert.match(byId(r, 'cookie:sid').detail, /Secure, HttpOnly, SameSite/)
  assert.equal(byId(r, 'cors').severity, 'fail')
})

test('CSP frame-ancestors counts as clickjacking protection', () => {
  assert.equal(byId(analyzeSecurityHeaders("content-security-policy: default-src 'self'; frame-ancestors 'self'"), 'framing').severity, 'pass')
})

test('analyzeLog reads combined access logs: statuses, top IPs, top failing paths', () => {
  const lines = []
  for (let i = 0; i < 12; i++) lines.push('203.0.113.9 - - [05/Oct/2026:10:00:0' + (i % 10) + ' +0000] "POST /login HTTP/1.1" 401 120')
  lines.push('198.51.100.2 - - [05/Oct/2026:10:01:00 +0000] "GET /index.html HTTP/1.1" 200 5120')
  lines.push('198.51.100.2 - - [05/Oct/2026:10:01:01 +0000] "GET /missing?x=1 HTTP/1.1" 404 10')
  const r = analyzeLog(lines.join('\n'))
  assert.equal(r.lines, 14)
  assert.equal(r.statuses['401'], 12)
  assert.deepEqual(r.topIps[0], ['203.0.113.9', 12])
  assert.deepEqual(r.topErrors[0], ['401 POST /login', 12])
  assert.ok(r.flags.some((f) => f.includes('203.0.113.9') && f.includes('credential guessing')))
})

test('analyzeLog reads levelled application logs and groups the same error with different numbers', () => {
  const r = analyzeLog(`2026-10-05T10:00:00Z INFO started
2026-10-05T10:00:01Z ERROR db timeout after 30s for user 17
2026-10-05T10:00:02Z ERROR db timeout after 45s for user 92
2026-10-05T10:00:03Z WARN slow query
bad line with no level`)
  assert.equal(r.levels.ERROR, 2)
  assert.equal(r.levels.WARN, 1)
  assert.equal(r.topErrors[0][1], 2)
  assert.equal(r.first, '2026-10-05T10:00:00Z')
  assert.equal(r.last, '2026-10-05T10:00:03Z')
  assert.equal(r.recognised, 4)
})

test('analyzeLog reads JSON lines', () => {
  const r = analyzeLog('{"level":"error","msg":"boom 7","status":500,"ip":"10.0.0.1","time":"2026-10-05T10:00:00Z"}\n{"level":"info","msg":"ok","status":200}')
  assert.equal(r.levels.ERROR, 1)
  assert.equal(r.statuses['500'], 1)
  assert.deepEqual(r.topIps[0], ['10.0.0.1', 1])
})

test('an empty log gives an empty report, not an error', () => {
  const r = analyzeLog('  \n')
  assert.equal(r.lines, 0)
  assert.deepEqual(r.flags, [])
})

test('normaliseMessage groups numbers, hex and uuids', () => {
  assert.equal(normaliseMessage('failed 12 at 0xdeadbeef for 123e4567-e89b-12d3-a456-426614174000'), 'failed <n> at <hex> for <id>')
})

test('normaliseDomain accepts domains and URLs, rejects junk', () => {
  assert.equal(normaliseDomain(' https://Example.com/path?x '), 'example.com')
  assert.equal(normaliseDomain('sub.example.co.uk.'), 'sub.example.co.uk')
  for (const bad of ['', 'localhost', 'a b.com', '-bad.com', 'http://', '1.2.3.4']) assert.equal(normaliseDomain(bad), null, bad)
})

const fakeFetch = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body })

test('lookupDns maps answers and strips quotes and trailing dots', async () => {
  const r = await lookupDns('Example.com', 'TXT', fakeFetch({ Status: 0, Answer: [{ name: 'example.com.', type: 16, TTL: 300, data: '"v=spf1 -all"' }] }))
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.records[0], { name: 'example.com', type: 'TXT', ttl: 300, data: 'v=spf1 -all' })
})

test('lookupDns tells apart no records, no such domain, resolver errors and network failure', async () => {
  assert.equal((await lookupDns('example.com', 'A', fakeFetch({ Status: 0 }))).status, 'no-records')
  assert.equal((await lookupDns('nope.example', 'A', fakeFetch({ Status: 3 }))).status, 'not-found')
  assert.equal((await lookupDns('example.com', 'A', fakeFetch({ Status: 2 }))).status, 'error')
  assert.equal((await lookupDns('example.com', 'A', fakeFetch({}, false, 503))).status, 'error')
  assert.equal((await lookupDns('example.com', 'A', async () => { throw new Error('offline') })).status, 'error')
  assert.match((await lookupDns('not a domain', 'A', fakeFetch({}))).message, /domain/)
})

test('lookupDns only ever sends the domain name to the resolver', async () => {
  let seen = ''
  await lookupDns('https://example.com/secret/path?token=1', 'A', async (u) => { seen = u; return { ok: true, status: 200, json: async () => ({ Status: 0 }) } })
  assert.equal(seen, 'https://dns.google/resolve?name=example.com&type=A')
})

test('emailAuthFindings grades SPF and DMARC', () => {
  const rec = (data) => ({ name: 'x', type: 'TXT', ttl: 1, data })
  const none = emailAuthFindings([], [])
  assert.deepEqual(none.map((f) => f.severity), ['fail', 'fail'])
  const good = emailAuthFindings([rec('v=spf1 include:_spf.google.com -all')], [rec('v=DMARC1; p=reject; rua=mailto:d@x.com')])
  assert.deepEqual(good.map((f) => f.severity), ['pass', 'pass'])
  assert.equal(emailAuthFindings([rec('v=spf1 +all')], [rec('v=DMARC1; p=none')])[0].severity, 'fail')
  assert.equal(emailAuthFindings([rec('v=spf1 ~all')], [rec('v=DMARC1; p=none')])[1].severity, 'warn')
})

test('scoreChecklist ignores not-applicable items and never invents a score', () => {
  assert.equal(scoreChecklist({}).score, null)
  const all = Object.fromEntries(CONFIG_CHECKLIST.map((c) => [c.id, 'pass']))
  assert.equal(scoreChecklist(all).score, 100)
  const mixed = { ...all, 'auth-mfa': 'fail', 'auth-passwords': 'na' }
  const r = scoreChecklist(mixed)
  assert.equal(r.failed, 1)
  assert.equal(r.passed, CONFIG_CHECKLIST.length - 2)
  assert.equal(r.score, Math.round(((CONFIG_CHECKLIST.length - 2) / (CONFIG_CHECKLIST.length - 1)) * 100))
  assert.equal(scoreChecklist({ 'auth-mfa': 'pass' }).unanswered, CONFIG_CHECKLIST.length - 1)
})
