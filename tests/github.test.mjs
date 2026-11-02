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

import {
  isSafeRepoPath, isSafeRef, isCommitSha, clampPage, encodePath, slimFile, slimTreeEntry, sortTree, slimCommitDetail, MAX_FILE_BYTES, MAX_PATCH_CHARS, MAX_COMMIT_FILES,
} from '../supabase/functions/_shared/github.ts'
const b64 = (s) => Buffer.from(s).toString('base64')

test('repository paths cannot traverse, be absolute, or change the API route', () => {
  for (const ok of ['src', 'src/app/main.tsx', 'README.md', '.github/workflows/ci.yml', 'a b/c d.txt']) assert.ok(isSafeRepoPath(ok), ok)
  for (const bad of ['', '/etc/passwd', '../x', 'a/../b', 'a/./b', 'a//b', 'a/', 'a\\b', 'a?x=1', 'a#b', 'a%2e%2e/b', 'a\u0000b', 'a\nb', 'x'.repeat(301), 5, null]) assert.ok(!isSafeRepoPath(bad), JSON.stringify(bad))
  assert.equal(encodePath('src/a b/c#.ts'), 'src/a%20b/c%23.ts')
})

test('refs and shas are strict; page numbers are clamped', () => {
  for (const ok of ['main', 'feature/login-2', 'v1.2.3', 'a'.repeat(40)]) assert.ok(isSafeRef(ok), ok)
  for (const bad of ['', '..', 'a..b', '/x', 'x/', 'a//b', 'a b', 'a?b', 'a;rm', 'x'.repeat(201), null]) assert.ok(!isSafeRef(bad), String(bad))
  assert.ok(isCommitSha('abcdef1') && isCommitSha('a'.repeat(40)) && !isCommitSha('abcdef') && !isCommitSha('ABCDEF1') && !isCommitSha('g'.repeat(7)) && !isCommitSha('a'.repeat(41)))
  assert.deepEqual([clampPage(0), clampPage(-3), clampPage('x'), clampPage(2.9), clampPage(999)], [1, 1, 1, 2, 50])
})

test('files: text is decoded as UTF-8, binary and oversized files are never returned as content', () => {
  const t = slimFile({ type: 'file', name: 'a.md', path: 'a.md', size: 10, encoding: 'base64', content: b64('héllo\nwörld'), sha: 'abc' })
  assert.equal(t.kind, 'text'); assert.equal(t.text, 'héllo\nwörld')
  assert.equal(slimFile({ type: 'file', name: 'i.png', path: 'i.png', size: 10, encoding: 'base64', content: b64('PNG\u0000\u0001') }).kind, 'binary')
  const big = slimFile({ type: 'file', name: 'b', path: 'b', size: MAX_FILE_BYTES + 1, encoding: 'base64', content: b64('x') })
  assert.equal(big.kind, 'too_large'); assert.equal(big.text, null)
  assert.equal(slimFile({ type: 'submodule', name: 's', path: 's' }).kind, 'unsupported')
  assert.equal(slimFile({ type: 'file', name: 'n', path: 'n', size: 5, encoding: 'none', content: '' }).kind, 'unsupported')
  assert.equal(slimFile({ type: 'file', name: 'x', path: 'x', size: 1, encoding: 'base64', content: b64('x'), html_url: 'javascript:1' }).html_url, null)
  assert.equal(slimFile({ type: 'file', name: 'x', path: 'x', size: 1, encoding: 'base64', content: b64('x'), html_url: 'https://github.com/a/b/blob/main/x' }).html_url, 'https://github.com/a/b/blob/main/x')
  assert.equal(slimCommitDetail({ sha: 'a'.repeat(40), html_url: 'https://evil.example/x', commit: {} }).html_url, null)
})

test('directory listings put folders first and normalise unknown types', () => {
  const list = sortTree([{ name: 'z.ts', type: 'file' }, { name: 'src', type: 'dir' }, { name: 'a.ts', type: 'file' }, { name: 'docs', type: 'dir' }])
  assert.deepEqual(list.map((e) => e.name), ['docs', 'src', 'a.ts', 'z.ts'])
  assert.equal(slimTreeEntry({ name: 'x', path: 'x', type: 'submodule' }).type, 'other')
})

test('commit detail keeps stats, caps the patch and the file count, and marks missing patches as null', () => {
  const files = Array.from({ length: MAX_COMMIT_FILES + 5 }, (_, i) => ({ filename: `f${i}`, status: 'added', additions: 1, deletions: 0, patch: i === 0 ? 'x'.repeat(MAX_PATCH_CHARS + 10) : i === 1 ? undefined : '+a' }))
  const d = slimCommitDetail({ sha: 'a'.repeat(40), commit: { message: 'Fix it\n\nbody', author: { name: 'Sam', date: 'd' } }, stats: { additions: 70, deletions: 1, total: 71 }, parents: [{ sha: 'b'.repeat(40) }], files })
  assert.equal(d.message, 'Fix it'); assert.equal(d.message_full, 'Fix it\n\nbody'); assert.equal(d.short, 'aaaaaaa')
  assert.equal(d.files.length, MAX_COMMIT_FILES); assert.ok(d.files_truncated); assert.equal(d.files_total, MAX_COMMIT_FILES + 5)
  assert.equal(d.files[0].patch.length, MAX_PATCH_CHARS); assert.ok(d.files[0].patch_truncated)
  assert.equal(d.files[1].patch, null); assert.ok(!d.files[1].patch_truncated)
  assert.deepEqual(d.stats, { additions: 70, deletions: 1, total: 71 })
})

import {
  isItemNumber, isListState, slimComment, summariseChecks, slimPullDetail, slimIssueListItem, slimIssueDetail, MAX_BODY_CHARS, MAX_COMMENT_CHARS, MAX_COMMENTS,
} from '../supabase/functions/_shared/github.ts'

test('item numbers and list states are strict', () => {
  for (const ok of [1, 42, 10_000_000]) assert.ok(isItemNumber(ok), String(ok))
  for (const bad of [0, -1, 1.5, '7', null, 10_000_001, NaN, Infinity]) assert.ok(!isItemNumber(bad), String(bad))
  assert.ok(isListState('open') && isListState('closed') && isListState('all') && !isListState('merged') && !isListState('') && !isListState(undefined))
})

test('comments are capped, flagged when cut, and only github.com links survive', () => {
  const c = slimComment({ id: 1, user: { login: 'amy' }, body: 'x'.repeat(MAX_COMMENT_CHARS + 5), html_url: 'https://evil.example/x', created_at: 'd' })
  assert.equal(c.body.length, MAX_COMMENT_CHARS); assert.ok(c.body_truncated); assert.equal(c.html_url, null)
  assert.equal(slimComment({ id: 2, user: null, body: null }).author, 'unknown')
  assert.equal(slimComment({ id: 3, body: 'hi', html_url: 'https://github.com/a/b/pull/1#c' }).html_url, 'https://github.com/a/b/pull/1#c')
})

test('check summary: none is never passing, failures beat pending, unknown is distinct', () => {
  assert.equal(summariseChecks([]).overall, 'none')
  assert.equal(summariseChecks(null).overall, 'unknown')
  assert.equal(summariseChecks([{ name: 'a', status: 'completed', conclusion: 'success' }]).overall, 'passing')
  assert.equal(summariseChecks([{ name: 'a', status: 'completed', conclusion: 'success' }, { name: 'b', status: 'in_progress', conclusion: null }]).overall, 'pending')
  const f = summariseChecks([{ name: 'a', status: 'completed', conclusion: 'failure' }, { name: 'b', status: 'queued' }])
  assert.equal(f.overall, 'failing'); assert.equal(f.failed, 1); assert.equal(f.pending, 1)
  assert.equal(summariseChecks([{ name: 'a', status: 'completed', conclusion: 'skipped' }, { name: 'b', status: 'completed', conclusion: 'neutral' }]).overall, 'passing')
  assert.equal(summariseChecks([{ name: 'a', status: 'completed', conclusion: 'cancelled' }]).overall, 'failing')
})

test('pull request detail: honest mergeability, capped body/files/comments, pending reviews hidden, merged state', () => {
  const files = Array.from({ length: MAX_COMMIT_FILES + 3 }, (_, i) => ({ filename: `f${i}`, status: 'added', additions: 1, deletions: 0, patch: '+x' }))
  const comments = Array.from({ length: MAX_COMMENTS + 4 }, (_, i) => ({ id: i, user: { login: 'u' }, body: `c${i}` }))
  const d = slimPullDetail({ number: 9, title: 'T', state: 'closed', merged_at: 'x', user: { login: 'amy' }, body: 'b'.repeat(MAX_BODY_CHARS + 1), mergeable: null, mergeable_state: 'unknown', labels: [{ name: 'bug' }], requested_reviewers: [{ login: 'bo' }], additions: 5, deletions: 2, changed_files: 66 },
    files, [{ id: 1, state: 'PENDING', user: { login: 'x' } }, { id: 2, state: 'APPROVED', user: { login: 'bo' }, body: 'lgtm' }], comments, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  assert.equal(d.state, 'merged'); assert.ok(d.merged); assert.equal(d.mergeable, null)       // not computed yet: say so, never guess true
  assert.equal(d.body.length, MAX_BODY_CHARS); assert.ok(d.body_truncated)
  assert.equal(d.files.length, MAX_COMMIT_FILES); assert.ok(d.files_truncated)
  assert.equal(d.reviews.length, 1); assert.equal(d.reviews[0].state, 'approved')
  assert.equal(d.comments.length, MAX_COMMENTS); assert.equal(d.comments.at(-1).body, `c${MAX_COMMENTS + 3}`)   // newest kept
  assert.deepEqual(d.reviewers_requested, ['bo']); assert.deepEqual(d.labels, ['bug']); assert.equal(d.checks.overall, 'passing')
  assert.equal(slimPullDetail({ number: 1, title: 't', state: 'open', mergeable: true }, [], [], [], null).checks.overall, 'unknown')
})

test('issue list and detail: state, labels, assignees, capped comments, safe links', () => {
  const i = slimIssueListItem({ number: 3, title: 'Bug', state: 'open', user: { login: 'amy' }, comments: 2, labels: [{ name: 'bug' }], assignees: [{ login: 'bo' }], html_url: 'javascript:1' })
  assert.deepEqual([i.number, i.comments, i.labels, i.assignees, i.html_url], [3, 2, ['bug'], ['bo'], null])
  const d = slimIssueDetail({ number: 3, title: 'Bug', state: 'closed', state_reason: 'completed', body: null, milestone: { title: 'v1' } }, Array.from({ length: MAX_COMMENTS + 1 }, (_, n) => ({ id: n, body: 'x' })))
  assert.equal(d.body, ''); assert.equal(d.milestone, 'v1'); assert.equal(d.state_reason, 'completed')
  assert.equal(d.comments_list.length, MAX_COMMENTS); assert.ok(d.comments_truncated)
})
