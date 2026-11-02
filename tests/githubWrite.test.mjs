import test from 'node:test'
import assert from 'node:assert/strict'
import { runWrite, validateComment, validateIssue, safeName, withSignature, isRequestId, MAX_COMMENT_WRITE, MAX_ISSUE_TITLE, MAX_ISSUE_BODY } from '../supabase/functions/_shared/githubWrite.ts'
import { githubPost, GithubError } from '../supabase/functions/_shared/github.ts'

const RID = '3f1c2b9e-1111-4222-8333-444455556666'
const res = (status, body = {}, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body })

function harness(over = {}) {
  const log = []
  const deps = {
    credentialSource: 'github_app', displayName: 'Amy Smith',
    can: async (repo, cap) => { log.push(['can', repo, cap]); return over.can ?? true },
    begin: async (a) => { log.push(['begin', a.denied ? 'denied' : 'real', a.action, a.target]); return a.denied ? 'denied' : (over.begin ?? 'ok') },
    finish: async (id, outcome, detail, url) => { log.push(['finish', outcome, url]); if (over.finishThrows) throw new Error('db') },
    post: async (path, payload) => { log.push(['post', path, payload]); if (over.postThrows) throw over.postThrows; return 'created' in over ? over.created : { id: 7, number: 12, html_url: 'https://github.com/codex/api/issues/12#c7' } },
  }
  return { log, deps, run: (input) => runWrite(deps, { requestId: RID, repo: 'codex/api', action: 'comment', number: 12, text: 'Looks good', ...input }) }
}
const steps = (log) => log.map((l) => l[0] + (l[1] ? ':' + l[1] : ''))

test('validation: comments and issues are trimmed, bounded and free of control characters', () => {
  assert.deepEqual(validateComment('  hi\r\nthere '), { ok: true, value: 'hi\nthere' })
  for (const bad of ['', '   ', null, 5, 'x'.repeat(MAX_COMMENT_WRITE + 1), 'a\u0000b', 'a\u001bb']) assert.equal(validateComment(bad).ok, false, JSON.stringify(bad)?.slice(0, 20))
  assert.ok(validateComment('tab\tand\nnewline are fine').ok)
  assert.deepEqual(validateIssue('  A   title ', 'body'), { ok: true, value: { title: 'A title', body: 'body' } })
  assert.equal(validateIssue('t', undefined).value.body, '')
  for (const [t, b] of [['', ''], ['  ', 'x'], [null, 'x'], ['x'.repeat(MAX_ISSUE_TITLE + 1), ''], ['t', 'x'.repeat(MAX_ISSUE_BODY + 1)], ['t\u0000', ''], ['t', 'b\u0007']]) assert.equal(validateIssue(t, b).ok, false)
})

test('the signature names the person, and a hostile display name cannot inject markup or mentions', () => {
  assert.equal(safeName('Amy Smith'), 'Amy Smith'); assert.equal(safeName("O'Brien-Lee"), "O'Brien-Lee")
  assert.equal(safeName('Zoë Ünal'), 'Zoë Ünal')
  const hostile = safeName('[click](https://evil.example) @everyone <b>x</b>')
  assert.ok(!/[\[\]()<>@:\/`*_#]/.test(hostile), hostile)   // no brackets, mentions, markup or URL scheme survive; plain letters and dots are kept ("J. Smith")
  assert.equal(safeName('   '), 'a Workspace member'); assert.equal(safeName(null), 'a Workspace member'); assert.equal(safeName('x'.repeat(200)).length, 60)
  assert.equal(withSignature('Hi', 'Amy'), 'Hi\n\n---\n*Posted from Codex Workspace by Amy.*')
  assert.ok(isRequestId(RID) && !isRequestId('nope') && !isRequestId(null) && !isRequestId(RID + 'x'))
})

test('a normal comment: checked, recorded, posted, confirmed, in that order', async () => {
  const h = harness(); const r = await h.run()
  assert.deepEqual(steps(h.log), ['can:codex/api', 'begin:real', 'post:/repos/codex/api/issues/12/comments', 'finish:success'])
  assert.equal(r.status, 200); assert.equal(r.body.url, 'https://github.com/codex/api/issues/12#c7')
  assert.match(h.log[2][2].body, /^Looks good\n\n---\n\*Posted from Codex Workspace by Amy Smith\.\*$/)
})

test('creating an issue posts to the issues endpoint with the issue capability', async () => {
  const h = harness(); const r = await h.run({ action: 'create_issue', title: 'Bug', text: 'It breaks', number: undefined })
  assert.deepEqual(h.log[0], ['can', 'codex/api', 'issue'])
  assert.equal(h.log[2][1], '/repos/codex/api/issues'); assert.equal(h.log[2][2].title, 'Bug')
  assert.equal(r.body.number, 12)
})

test('a refused caller is recorded as denied and GitHub is NEVER called', async () => {
  const h = harness({ can: false }); const r = await h.run()
  assert.equal(r.status, 403); assert.equal(r.body.code, 'not_allowed')
  assert.deepEqual(steps(h.log), ['can:codex/api', 'begin:denied'])
})

test('the shared personal token can never write, and nothing is recorded or asked', async () => {
  const h = harness(); h.deps.credentialSource = 'personal_token'
  const r = await h.run(); assert.equal(r.status, 409); assert.equal(r.body.code, 'app_required'); assert.equal(h.log.length, 0)
})

test('malformed input is refused before anything else happens', async () => {
  const h = harness()
  for (const bad of [{ requestId: 'x' }, { repo: '../etc' }, { number: 0 }, { number: '5' }, { text: '' }, { action: 'create_issue', title: '' }]) {
    const r = await h.run(bad); assert.equal(r.status, 400, JSON.stringify(bad))
  }
  assert.equal(h.log.length, 0)
})

test('a repeated request id (double click, retry) is refused and GitHub is not called again', async () => {
  const h = harness({ begin: 'duplicate' }); const r = await h.run()
  assert.equal(r.status, 409); assert.equal(r.body.code, 'duplicate'); assert.ok(!steps(h.log).some((s) => s.startsWith('post')))
})

test('the rate limit stops the write before GitHub', async () => {
  const h = harness({ begin: 'rate_limited' }); const r = await h.run()
  assert.equal(r.status, 429); assert.ok(!steps(h.log).some((s) => s.startsWith('post')))
})

test('a GitHub failure is recorded as failed, shown plainly, and never reported as success', async () => {
  for (const [e, status] of [[new GithubError('forbidden', 403, 'App cannot write.'), 403], [new GithubError('error', 422, 'Refused.'), 422], [new GithubError('not_found', 404, 'Not found.'), 404], [new GithubError('rate_limited', 429, 'Slow down.'), 429], [new GithubError('error', 500, 'Boom.'), 502], [new Error('network down'), 502]]) {
    const h = harness({ postThrows: e }); const r = await h.run()
    assert.equal(r.status, status); assert.ok(!r.body.ok); assert.ok(r.body.error.length > 0)
    assert.deepEqual(h.log.at(-1).slice(0, 2), ['finish', 'failed'])
    if (!(e instanceof GithubError)) assert.ok(!r.body.error.includes('network down'))   // raw error text never reaches the person
  }
})

test('success is claimed ONLY when GitHub returned an id and a github.com link', async () => {
  for (const created of [{}, { id: 'x', html_url: 'https://github.com/a/b/issues/1' }, { id: 1 }, { id: 1, html_url: 'https://evil.example/x' }, null]) {
    const h = harness({ created }); const r = await h.run()
    assert.equal(r.status, 502, JSON.stringify(created)); assert.ok(!r.body.ok); assert.deepEqual(h.log.at(-1).slice(0, 2), ['finish', 'failed'])
  }
})

test('if GitHub accepted the write but saving the record fails, the person still hears it was posted', async () => {
  const h = harness({ finishThrows: true }); const r = await h.run()
  assert.equal(r.status, 200); assert.ok(r.body.ok); assert.match(r.body.warning, /could not be saved/)
})

test('githubPost sends JSON with the App token and maps errors to plain messages without echoing GitHub', async () => {
  let seen
  const out = await githubPost('ghs_tok', '/repos/a/b/issues', { title: 't' }, async (u, i) => { seen = { u, i }; return res(201, { id: 3 }) })
  assert.equal(out.id, 3); assert.equal(seen.i.method, 'POST'); assert.equal(seen.i.headers.Authorization, 'Bearer ghs_tok'); assert.equal(seen.i.body, '{"title":"t"}')
  const err = async (status, h = {}) => { try { await githubPost('t', '/x', {}, async () => res(status, { message: 'SECRET GITHUB TEXT' }, h)) } catch (e) { return e } }
  assert.equal((await err(401)).kind, 'unauthorized'); assert.equal((await err(403)).kind, 'forbidden'); assert.match((await err(403)).message, /write access/)
  assert.equal((await err(403, { 'x-ratelimit-remaining': '0' })).kind, 'rate_limited'); assert.equal((await err(404)).kind, 'not_found')
  assert.match((await err(410)).message, /turned off/); assert.match((await err(422)).message, /Nothing was posted/); assert.equal((await err(500)).status, 500)
  for (const s of [401, 403, 404, 410, 422, 500]) assert.ok(!(await err(s)).message.includes('SECRET GITHUB TEXT'))
  await assert.rejects(githubPost('t', 'no-slash', {}), GithubError)
})
