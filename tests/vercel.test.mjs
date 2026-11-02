import test from 'node:test'
import assert from 'node:assert/strict'
import { vercelListDeployments, slimVercelDeployment, summariseProduction, isProjectRef, isTeamRef, VercelError } from '../supabase/functions/_shared/vercel.ts'

const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const dep = (o = {}) => ({ uid: 'dpl_1', url: 'my-app-abc123.vercel.app', created: 1_800_000_000_000, readyState: 'READY', target: 'production', inspectorUrl: 'https://vercel.com/acme/my-app/xyz', meta: { githubCommitSha: 'ABCDEF1234567890', githubCommitMessage: 'Fix login\n\nlong body', githubCommitRef: 'main', githubCommitAuthorName: 'Amy' }, creator: { username: 'amy' }, ...o })

test('references are strict', () => {
  for (const ok of ['my-app', 'prj_AbC123', 'a.b_c-d']) assert.ok(isProjectRef(ok) && isTeamRef(ok), ok)
  for (const bad of ['', 'a b', 'a/b', '../x', 'a;b', 'a?b=1', 'x'.repeat(101), null, 5]) assert.ok(!isProjectRef(bad) && !isTeamRef(bad), String(bad))
})

test('the request: v6 endpoint, bearer token, project, clamped limit, production filter, team id vs slug', async () => {
  let seen
  const f = async (u, i) => { seen = { u: new URL(u), i }; return res(200, { deployments: [] }) }
  await vercelListDeployments('tok', { project: 'my-app', limit: 20 }, f)
  assert.equal(seen.u.origin + seen.u.pathname, 'https://api.vercel.com/v6/deployments')
  assert.equal(seen.u.searchParams.get('projectId'), 'my-app'); assert.equal(seen.u.searchParams.get('limit'), '20')
  assert.equal(seen.i.headers.Authorization, 'Bearer tok'); assert.equal(seen.u.searchParams.get('target'), null)
  await vercelListDeployments('tok', { project: 'p', target: 'production', limit: 9999 }, f)
  assert.equal(seen.u.searchParams.get('target'), 'production'); assert.equal(seen.u.searchParams.get('limit'), '50')
  await vercelListDeployments('tok', { project: 'p', team: 'team_abc', limit: 0 }, f)
  assert.equal(seen.u.searchParams.get('teamId'), 'team_abc'); assert.equal(seen.u.searchParams.get('slug'), null); assert.equal(seen.u.searchParams.get('limit'), '1')
  await vercelListDeployments('tok', { project: 'p', team: 'my-team', limit: 5 }, f)
  assert.equal(seen.u.searchParams.get('slug'), 'my-team'); assert.equal(seen.u.searchParams.get('teamId'), null)
})

test('a hostile project or team reference never reaches the network', async () => {
  let called = false
  const f = async () => { called = true; return res(200, { deployments: [] }) }
  await assert.rejects(vercelListDeployments('t', { project: 'a&teamId=other', limit: 5 }, f), VercelError)
  await assert.rejects(vercelListDeployments('t', { project: 'ok', team: '../x', limit: 5 }, f), VercelError)
  assert.equal(called, false)
})

test('errors become plain messages that never echo Vercel or the token', async () => {
  const err = async (status) => { try { await vercelListDeployments('SECRET_TOKEN', { project: 'p', limit: 5 }, async () => res(status, { error: { message: 'SECRET VERCEL TEXT' } })) } catch (e) { return e } }
  assert.equal((await err(401)).kind, 'unauthorized'); assert.equal((await err(403)).kind, 'forbidden'); assert.equal((await err(404)).kind, 'not_found')
  assert.equal((await err(429)).kind, 'rate_limited'); assert.equal((await err(500)).kind, 'error')
  for (const s of [401, 403, 404, 429, 500]) { const m = (await err(s)).message; assert.ok(!m.includes('SECRET_TOKEN') && !m.includes('SECRET VERCEL TEXT'), String(s)) }
  await assert.rejects(vercelListDeployments('t', { project: 'p', limit: 5 }, async () => res(200, { nope: true })), (e) => e.status === 502)
  await assert.rejects(vercelListDeployments('t', { project: 'p', limit: 5 }, async () => res(200, null)), (e) => e.status === 502)
})

test('a deployment is slimmed: state, target, commit, and only safe links', () => {
  const s = slimVercelDeployment(dep())
  assert.deepEqual([s.state, s.target, s.sha, s.message, s.branch, s.author], ['READY', 'production', 'abcdef1', 'Fix login', 'main', 'Amy'])
  assert.equal(s.url, 'https://my-app-abc123.vercel.app'); assert.equal(s.inspector_url, 'https://vercel.com/acme/my-app/xyz'); assert.equal(s.created_at, new Date(1_800_000_000_000).toISOString())
  assert.equal(slimVercelDeployment(dep({ target: null })).target, 'preview'); assert.equal(slimVercelDeployment(dep({ target: 'staging' })).target, 'preview')
  assert.equal(slimVercelDeployment(dep({ readyState: undefined, state: 'building' })).state, 'BUILDING')
  assert.equal(slimVercelDeployment(dep({ readyState: 'SOMETHING_NEW' })).state, 'UNKNOWN')   // an unknown state is shown as unknown, never as success
})

test('hostile or missing fields cannot become links or break the shape', () => {
  for (const url of ['evil.example', 'my-app.vercel.app.evil.example', 'javascript:alert(1)', 'a b.vercel.app', 'https://x.vercel.app', '', null, undefined, '.vercel.app', 'EVIL.com/x']) assert.equal(slimVercelDeployment(dep({ url })).url, null, String(url))
  assert.equal(slimVercelDeployment(dep({ url: 'MY-APP.VERCEL.APP' })).url, 'https://my-app.vercel.app')   // case is normalised, still on vercel.app
  assert.equal(slimVercelDeployment(dep({ inspectorUrl: 'https://evil.example/x' })).inspector_url, null)
  const bare = slimVercelDeployment({ uid: 'dpl_x' })
  assert.deepEqual([bare.state, bare.created_at, bare.url, bare.sha, bare.message, bare.author, bare.branch], ['UNKNOWN', null, null, null, null, null, null])
  assert.equal(slimVercelDeployment(dep({ meta: { githubCommitSha: 'not-a-sha' } })).sha, null)
})

test('production summary: judged on the NEWEST production deployment, failure is never hidden by an older success', () => {
  const mk = (id, state, t, target = 'production') => slimVercelDeployment(dep({ uid: id, readyState: state, created: t, target }))
  const live = summariseProduction([mk('a', 'READY', 1000), mk('b', 'READY', 2000)])
  assert.equal(live.status, 'live'); assert.equal(live.latest.id, 'b'); assert.equal(live.last_ready, null)
  const failed = summariseProduction([mk('a', 'READY', 1000), mk('b', 'ERROR', 2000)])
  assert.equal(failed.status, 'failed'); assert.equal(failed.latest.id, 'b'); assert.equal(failed.last_ready.id, 'a')   // what visitors are probably still seeing
  assert.equal(summariseProduction([mk('a', 'READY', 1000), mk('b', 'BUILDING', 2000)]).status, 'building')
  assert.equal(summariseProduction([mk('a', 'READY', 1000), mk('b', 'QUEUED', 2000)]).status, 'building')
  assert.equal(summariseProduction([mk('a', 'READY', 1000), mk('b', 'CANCELED', 2000)]).status, 'canceled')
  assert.equal(summariseProduction([mk('a', 'WHATEVER', 2000)]).status, 'unknown')
  assert.equal(summariseProduction([]).status, 'none')
  assert.equal(summariseProduction([mk('p', 'READY', 9000, 'preview')]).status, 'none')   // previews never count as production
  assert.equal(summariseProduction([mk('a', 'ERROR', 1000)]).last_ready, null)
})
