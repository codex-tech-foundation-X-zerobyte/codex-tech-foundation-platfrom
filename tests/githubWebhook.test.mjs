import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyGithubSignature, isDeliveryId, mapGithubEvent, isAlertWorthy, MAX_WEBHOOK_BYTES } from '../supabase/functions/_shared/githubWebhook.ts'

const SECRET = 'a-webhook-secret-of-decent-length'
const sign = (body, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

test('a correct signature over the exact raw body is accepted', async () => {
  const body = '{"zen":"Keep it logically awesome."}'
  assert.equal(await verifyGithubSignature(SECRET, sign(body), body), true)
})

test('tampering, wrong secret, missing or malformed headers are all rejected', async () => {
  const body = '{"a":1}'
  assert.equal(await verifyGithubSignature(SECRET, sign(body), body + ' '), false)           // body changed by one byte
  assert.equal(await verifyGithubSignature(SECRET, sign(body, 'another-secret-entirely-xx'), body), false)
  for (const h of [null, '', 'sha256=', 'sha1=' + 'a'.repeat(40), 'sha256=' + 'g'.repeat(64), sign(body).toUpperCase(), sign(body) + '0'])
    assert.equal(await verifyGithubSignature(SECRET, h, body), false, String(h))
})

test('an empty or tiny secret never verifies, even against its own signature', async () => {
  const body = '{}'
  assert.equal(await verifyGithubSignature('', sign(body, ''), body), false)
  assert.equal(await verifyGithubSignature('short', sign(body, 'short'), body), false)
})

test('delivery ids and the body cap are shaped for the dedupe table', () => {
  assert.ok(isDeliveryId('72d3162e-cc78-11e3-81ab-4c9367dc0958'))
  for (const bad of ['', 'x; drop table', null, 'a'.repeat(65), '../..']) assert.ok(!isDeliveryId(bad), String(bad))
  assert.ok(MAX_WEBHOOK_BYTES <= 1_000_000)
})

const repo = { full_name: 'codex/web' }
test('push becomes a feed row naming branch and commit count; deleted branches are ignored', () => {
  const m = mapGithubEvent('push', { repository: repo, ref: 'refs/heads/main', commits: [{}, {}], pusher: { name: 'sam' }, compare: 'https://github.com/codex/web/compare/a...b', head_commit: { timestamp: '2026-10-30T10:00:00Z' } })
  assert.equal(m.type, 'activity'); assert.equal(m.row.title, '2 commits pushed to main'); assert.equal(m.row.occurred_at, '2026-10-30T10:00:00.000Z')
  assert.equal(mapGithubEvent('push', { repository: repo, ref: 'refs/heads/x', deleted: true }).type, 'ignored')
  assert.match(mapGithubEvent('push', { repository: repo, ref: 'refs/heads/x', commits: [{}] }).row.title, /^1 commit pushed/)
})

test('pull request states are merged vs closed vs opened; noisy actions are ignored', () => {
  const pr = (action, merged) => mapGithubEvent('pull_request', { repository: repo, action, sender: { login: 'amy' }, pull_request: { number: 7, title: 'Add login', merged, html_url: 'https://github.com/codex/web/pull/7' } })
  assert.equal(pr('closed', true).row.state, 'merged'); assert.equal(pr('closed', false).row.state, 'closed'); assert.equal(pr('opened').row.state, 'opened')
  assert.equal(pr('labeled').type, 'ignored'); assert.equal(pr('synchronize').type, 'ignored')
})

test('reviews, issues, workflow runs and deployments map; unfinished ones are ignored', () => {
  assert.equal(mapGithubEvent('pull_request_review', { repository: repo, action: 'submitted', pull_request: { number: 7, title: 't' }, review: { state: 'APPROVED', user: { login: 'bo' } } }).row.state, 'approved')
  assert.equal(mapGithubEvent('pull_request_review', { repository: repo, action: 'edited', review: {} }).type, 'ignored')
  assert.equal(mapGithubEvent('issues', { repository: repo, action: 'opened', issue: { number: 3, title: 'Bug' } }).row.kind, 'issue')
  assert.equal(mapGithubEvent('issues', { repository: repo, action: 'labeled', issue: { number: 3 } }).type, 'ignored')
  assert.equal(mapGithubEvent('workflow_run', { repository: repo, action: 'requested', workflow_run: {} }).type, 'ignored')
  const failed = mapGithubEvent('workflow_run', { repository: repo, action: 'completed', workflow_run: { name: 'CI', head_branch: 'main', conclusion: 'failure' } })
  assert.equal(failed.row.state, 'failure'); assert.ok(isAlertWorthy(failed.row))
  assert.ok(!isAlertWorthy(mapGithubEvent('workflow_run', { repository: repo, action: 'completed', workflow_run: { name: 'CI', conclusion: 'success' } }).row))
  assert.equal(mapGithubEvent('deployment_status', { repository: repo, deployment: { environment: 'production' }, deployment_status: { state: 'pending' } }).type, 'ignored')
  assert.ok(isAlertWorthy(mapGithubEvent('deployment_status', { repository: repo, deployment: { environment: 'production' }, deployment_status: { state: 'error' } }).row))
})

test('installation events carry only the fields we store; ping, unknown events and bad repo names are ignored', () => {
  const m = mapGithubEvent('installation', { action: 'created', installation: { id: 99, repository_selection: 'selected', account: { login: 'codex', type: 'Organization' } } })
  assert.deepEqual(m.change, { installation_id: 99, account_login: 'codex', account_type: 'Organization', repository_selection: 'selected', action: 'created' })
  assert.equal(mapGithubEvent('ping', {}).type, 'ignored')
  assert.equal(mapGithubEvent('star', { repository: repo }).type, 'ignored')
  assert.equal(mapGithubEvent('push', { repository: { full_name: '../etc/passwd' }, commits: [] }).type, 'ignored')
  assert.equal(mapGithubEvent('installation', { action: 'created' }).type, 'ignored')
})

test('links in the feed are https github.com only, so a crafted payload cannot plant another destination', () => {
  const m = mapGithubEvent('issues', { repository: repo, action: 'opened', issue: { number: 1, title: 't', html_url: 'javascript:alert(1)' } })
  assert.equal(m.row.url, null)
  const ok = mapGithubEvent('issues', { repository: repo, action: 'opened', issue: { number: 1, title: 't', html_url: 'https://github.com/codex/web/issues/1' } })
  assert.equal(ok.row.url, 'https://github.com/codex/web/issues/1')
})

import { processDelivery } from '../supabase/functions/_shared/githubWebhook.ts'

function harness(seen = new Set()) {
  const calls = { records: [], installs: [] }
  const deps = {
    secret: SECRET,
    record: async (a) => { calls.records.push(a); if (seen.has(a.delivery)) return 'duplicate'; seen.add(a.delivery); return a.outcome },
    upsertInstallation: async (c) => { calls.installs.push(c) },
  }
  const headers = (h) => ({ get: (n) => h[n.toLowerCase()] ?? null })
  const send = (body, event = 'push', delivery = 'd1d1d1d1-aaaa', over = {}) => processDelivery(deps, headers({ 'x-hub-signature-256': sign(body), 'x-github-delivery': delivery, 'x-github-event': event, ...over }), body)
  return { calls, deps, send, headers }
}
const pushBody = JSON.stringify({ repository: { full_name: 'codex/api' }, ref: 'refs/heads/main', commits: [{}], pusher: { name: 'amy' } })

test('receiver: a valid signed push is recorded once and the replay is a harmless duplicate', async () => {
  const h = harness()
  assert.deepEqual((await h.send(pushBody)).body, { ok: true, result: 'recorded' })
  assert.deepEqual((await h.send(pushBody)).body, { ok: true, result: 'duplicate' })
  assert.equal(h.calls.records[0].row.kind, 'push')
})

test('receiver: an unsigned, mis-signed or tampered request is refused and leaves NO trace', async () => {
  const h = harness()
  assert.equal((await h.send(pushBody, 'push', 'd1d1d1d1-aaaa', { 'x-hub-signature-256': null })).status, 401)
  assert.equal((await h.send(pushBody, 'push', 'd1d1d1d1-aaaa', { 'x-hub-signature-256': sign(pushBody, 'wrong-secret-wrong-secret') })).status, 401)
  assert.equal((await processDelivery(h.deps, h.headers({ 'x-hub-signature-256': sign(pushBody), 'x-github-delivery': 'd1d1d1d1-aaaa', 'x-github-event': 'push' }), pushBody + ' ')).status, 401)
  assert.equal(h.calls.records.length, 0); assert.equal(h.calls.installs.length, 0)
})

test('receiver: no configured secret means 503, never "accept anything"', async () => {
  const h = harness(); h.deps.secret = undefined
  assert.equal((await h.send(pushBody)).status, 503); assert.equal(h.calls.records.length, 0)
})

test('receiver: signed but malformed requests are 400 and unrecorded', async () => {
  const h = harness()
  assert.equal((await h.send(pushBody, 'push', 'bad id; drop')).status, 400)
  assert.equal((await h.send(pushBody, 'Push!!', 'd1d1d1d1-aaaa')).status, 400)
  assert.equal((await h.send('not json')).status, 400)
  assert.equal((await h.send('[1,2]')).status, 400)
  assert.equal((await h.send('x'.repeat(1_000_001))).status, 413)
  assert.equal(h.calls.records.length, 0)
})

test('receiver: ping and unsupported events are logged as ignored, installation events update installations once', async () => {
  const h = harness()
  assert.equal((await h.send('{"zen":"x"}', 'ping', 'aaaaaaaa-0001')).body.result, 'ignored')
  assert.equal((await h.send(JSON.stringify({ repository: { full_name: 'codex/api' } }), 'star', 'aaaaaaaa-0002')).body.result, 'ignored')
  const inst = JSON.stringify({ action: 'suspend', installation: { id: 9, repository_selection: 'all', account: { login: 'codex', type: 'Organization' } } })
  assert.equal((await h.send(inst, 'installation', 'aaaaaaaa-0003')).body.result, 'recorded')
  assert.equal((await h.send(inst, 'installation', 'aaaaaaaa-0003')).body.result, 'duplicate')
  assert.equal(h.calls.installs.length, 1)                         // the replay did not re-apply the change
  assert.equal(h.calls.installs[0].action, 'suspend')
})

test('receiver: a database failure propagates (so the function answers 500 and GitHub retries) rather than claiming success', async () => {
  const h = harness(); h.deps.record = async () => { throw new Error('db down') }
  await assert.rejects(h.send(pushBody))
})
