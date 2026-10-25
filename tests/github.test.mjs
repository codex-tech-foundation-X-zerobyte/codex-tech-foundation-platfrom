import test from 'node:test'
import assert from 'node:assert/strict'
import {
  githubGet, GithubError, isRepoFullName, slimRepo, slimCommit, slimIssues, slimPull, reviewSummary, slimRun,
} from '../supabase/functions/_shared/github.ts'
import { tokenFromPath, sanitizeHeaders, truncateBody, MAX_BODY } from '../supabase/functions/_shared/webhook.ts'

const res = (status, body = {}, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body })

test('githubGet sends the token and API version, and only to api.github.com', async () => {
  let seen
  await githubGet('ghp_abc', '/user', async (url, init) => { seen = { url, init }; return res(200, { login: 'x' }) })
  assert.equal(seen.url, 'https://api.github.com/user')
  assert.equal(seen.init.headers.Authorization, 'Bearer ghp_abc')
  assert.equal(seen.init.headers['X-GitHub-Api-Version'], '2022-11-28')
  assert.ok(seen.init.headers['User-Agent'])
  await assert.rejects(githubGet('t', 'https://evil.example/x', async () => res(200)), GithubError)
})

test('githubGet maps failures to clear kinds without leaking the token', async () => {
  const kind = async (status, headers) => { try { await githubGet('SECRET_TOKEN_VALUE', '/x', async () => res(status, {}, headers)) } catch (e) { return e } }
  assert.equal((await kind(401)).kind, 'unauthorized')
  assert.equal((await kind(403, {})).kind, 'forbidden')
  assert.equal((await kind(403, { 'x-ratelimit-remaining': '0' })).kind, 'rate_limited')
  assert.equal((await kind(404)).kind, 'not_found')
  assert.equal((await kind(500)).kind, 'error')
  for (const s of [401, 403, 404, 500]) assert.ok(!(await kind(s)).message.includes('SECRET_TOKEN_VALUE'))
})

test('isRepoFullName accepts owner/repo and rejects anything that could change the API path', () => {
  assert.ok(isRepoFullName('codex-tech/web.app_2'))
  for (const bad of ['', 'nope', 'a/b/c', '../x', 'a/..', 'a/b?x=1', 'a/b#c', 'a b/c', 'a/b\n', 42, null, 'x'.repeat(200) + '/y']) assert.ok(!isRepoFullName(bad), String(bad))
})

test('mappers keep only what the UI needs and tolerate missing fields', () => {
  assert.deepEqual(slimRepo({ full_name: 'a/b', open_issues_count: 3, html_url: 'u', pushed_at: 't' }), { full_name: 'a/b', description: '', private: false, default_branch: 'main', open_issues: 3, pushed_at: 't', html_url: 'u', language: null })
  assert.equal(slimCommit({ sha: 'abcdef123456', commit: { message: 'Fix bug\n\nlong body', author: { name: 'Sam', date: 'd' } }, html_url: 'u' }).message, 'Fix bug')
  assert.equal(slimCommit({ sha: 'abcdef123456', commit: { message: 'm' } }).author, 'unknown')
  assert.equal(slimRun({ id: 1, name: 'CI', status: 'completed', conclusion: 'success' }).conclusion, 'success')
})

test('issues exclude pull requests, which GitHub mixes into the same list', () => {
  const out = slimIssues([{ number: 1, title: 'Bug', labels: [{ name: 'bug' }] }, { number: 2, title: 'PR', pull_request: {} }])
  assert.deepEqual(out.map((i) => i.number), [1])
  assert.deepEqual(out[0].labels, ['bug'])
})

test('reviewSummary counts each reviewer once, by their latest decision', () => {
  const r = reviewSummary([
    { user: { login: 'a' }, state: 'APPROVED', submitted_at: '1' },
    { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2' },
    { user: { login: 'b' }, state: 'APPROVED', submitted_at: '1' },
    { user: { login: 'c' }, state: 'COMMENTED', submitted_at: '1' },
  ])
  assert.deepEqual(r, { approved: 1, changes_requested: 1 })
  assert.equal(slimPull({ number: 5, title: 't', state: 'closed', merged_at: 'x' }, []).state, 'merged')
})

test('webhook token comes from the path only, and only well-formed tokens', () => {
  const t = 'a'.repeat(64)
  assert.equal(tokenFromPath(`/functions/v1/webhook-inbox/${t}`), t)
  assert.equal(tokenFromPath(`/functions/v1/webhook-inbox/${t}/stripe/events`), t)
  for (const bad of ['/functions/v1/webhook-inbox/', '/functions/v1/webhook-inbox/short', `/functions/v1/webhook-inbox/${'a'.repeat(31)}`, `/functions/v1/other/${t}`, `/functions/v1/webhook-inbox/${t}$x`]) assert.equal(tokenFromPath(bad), null, bad)
})

test('captured headers drop credentials and network identity', () => {
  const h = new Headers({ Authorization: 'Bearer s3cr3t', Cookie: 'sid=1', 'X-Forwarded-For': '1.2.3.4', 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=abc' })
  const out = sanitizeHeaders(h)
  assert.deepEqual(Object.keys(out).sort(), ['content-type', 'stripe-signature'])
})

test('a huge body is truncated and says so', () => {
  assert.equal(truncateBody('ok'), 'ok')
  const big = 'x'.repeat(MAX_BODY + 500)
  const out = truncateBody(big)
  assert.ok(out.length < big.length)
  assert.match(out, /truncated \(500 more characters\)/)
})
