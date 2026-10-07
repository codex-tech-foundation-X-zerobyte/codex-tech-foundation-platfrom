import test from 'node:test'
import assert from 'node:assert/strict'
import { checkGithub, checkVercel, checkSecurityHeaders } from '../supabase/functions/_shared/securityProviders.ts'

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const TOKEN = 'ghp_SUPERSECRETTOKEN123456'
const cfg = { token: TOKEN, repository: 'acme/portal' }

/** Fake GitHub: route by path suffix. Anything not listed is a 404. */
const github = (routes) => async (url, init) => {
  assert.equal(init.method ?? 'GET', 'GET', 'adapters must be read-only')
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
  const path = new URL(url).pathname.replace('/repos/acme/portal', '')
  const hit = Object.entries(routes).find(([k]) => (k === '' ? path === '' : path.startsWith(k)))
  return hit ? (typeof hit[1] === 'function' ? hit[1]() : hit[1].clone()) : json({ message: 'Not Found' }, 404) // clone: a body can be read once, and routes are shared between tests
}
const byId = (report) => Object.fromEntries(report.findings.map((f) => [f.id, f]))

const HEALTHY = {
  '': json({ default_branch: 'main', private: true, security_and_analysis: { secret_scanning_push_protection: { status: 'enabled' } } }),
  '/dependabot/alerts': json([]),
  '/secret-scanning/alerts': json([]),
  '/code-scanning/alerts': json([]),
  '/branches/main/protection': json({ required_pull_request_reviews: {}, required_status_checks: {}, allow_force_pushes: { enabled: false } }),
  '/actions/runs': json({ workflow_runs: [{ conclusion: 'success', name: 'CI', html_url: 'https://github.com/acme/portal/actions/runs/1' }] }),
}

test('unconfigured: no network call is made, and the exact setup commands are returned', async () => {
  let called = false
  const r = await checkGithub({}, async () => { called = true; return json({}) })
  assert.equal(r.configured, false); assert.equal(called, false)
  assert.match(r.setup, /supabase secrets set GITHUB_TOKEN=.*GITHUB_REPOSITORY=/)
})

test('a healthy repository reports all-ok', async () => {
  const r = await checkGithub(cfg, github(HEALTHY))
  assert.equal(r.configured, true)
  assert.deepEqual(r.findings.map((f) => f.status), ['ok', 'ok', 'ok', 'ok', 'ok'])
})

test('critical/high dependency vulnerabilities are a failure, with counts and a link', async () => {
  const alerts = [{ security_advisory: { severity: 'critical' } }, { security_advisory: { severity: 'high' } }, { security_advisory: { severity: 'high' } }, { security_advisory: { severity: 'moderate' } }]
  const f = byId(await checkGithub(cfg, github({ ...HEALTHY, '/dependabot/alerts': json(alerts) })))['gh-dependabot']
  assert.equal(f.status, 'fail'); assert.match(f.title, /4 open dependency vulnerabilities/); assert.equal(f.detail, '1 critical, 2 high, 1 medium')
  assert.match(f.link, /security\/dependabot/)
})

test('only low/medium vulnerabilities is a warning, not a failure', async () => {
  const f = byId(await checkGithub(cfg, github({ ...HEALTHY, '/dependabot/alerts': json([{ security_advisory: { severity: 'low' } }]) })))['gh-dependabot']
  assert.equal(f.status, 'warn')
})

test('a leaked secret is a failure and tells you to ROTATE first', async () => {
  const f = byId(await checkGithub(cfg, github({ ...HEALTHY, '/secret-scanning/alerts': json([{ number: 1 }]) })))['gh-secrets']
  assert.equal(f.status, 'fail'); assert.match(f.fix, /Rotate .* FIRST/)
})

test('disabled features become actionable warnings, not errors', async () => {
  const r = byId(await checkGithub(cfg, github({
    ...HEALTHY,
    '/dependabot/alerts': json({ message: 'Dependabot alerts are disabled for this repository.' }, 403),
    '/secret-scanning/alerts': json({ message: 'Secret scanning is disabled on this repository.' }, 404),
    '/code-scanning/alerts': json({ message: 'no analysis found' }, 404),
    '/branches/main/protection': json({ message: 'Branch not protected' }, 404),
  })))
  assert.equal(r['gh-dependabot'].status, 'warn'); assert.match(r['gh-dependabot'].fix, /enable Dependabot alerts/)
  assert.equal(r['gh-secrets'].status, 'warn')
  assert.equal(r['gh-code'].status, 'info')
  assert.equal(r['gh-protection'].status, 'warn'); assert.match(r['gh-protection'].detail, /push straight to production/)
})

test('weak branch protection lists exactly what is missing', async () => {
  const f = byId(await checkGithub(cfg, github({ ...HEALTHY, '/branches/main/protection': json({ allow_force_pushes: { enabled: true } }) })))['gh-protection']
  assert.equal(f.status, 'warn'); assert.equal(f.detail, 'no required reviews, no required status checks, force pushes allowed')
})

test('a failing CI run is flagged', async () => {
  const f = byId(await checkGithub(cfg, github({ ...HEALTHY, '/actions/runs': json({ workflow_runs: [{ conclusion: 'failure', name: 'CI' }] }) })))['gh-ci']
  assert.equal(f.status, 'warn')
})

test('a token missing a scope degrades just that check to "unavailable" with the scope to add', async () => {
  const r = byId(await checkGithub(cfg, github({ ...HEALTHY, '/code-scanning/alerts': json({ message: 'Resource not accessible by personal access token' }, 403) })))
  assert.equal(r['gh-code'].status, 'unavailable'); assert.match(r['gh-code'].fix, /Code scanning alerts: read/)
  assert.equal(r['gh-dependabot'].status, 'ok') // the other checks still ran
})

test('a rejected token is reported plainly, and the token value is never echoed anywhere', async () => {
  const r = await checkGithub(cfg, async () => json({ message: 'Bad credentials' }, 401))
  assert.equal(r.findings[0].status, 'fail'); assert.match(r.findings[0].title, /rejected the token/)
  assert.ok(!JSON.stringify(r).includes(TOKEN))
})

test('network failure and timeouts never throw', async () => {
  const down = await checkGithub(cfg, async () => { throw new TypeError('fetch failed') })
  assert.equal(down.findings[0].status, 'unavailable')
  assert.ok(!JSON.stringify(down).includes(TOKEN))
})

test('a malformed repository setting is caught before any request', async () => {
  let called = false
  const r = await checkGithub({ token: TOKEN, repository: 'not a repo' }, async () => { called = true; return json({}) })
  assert.equal(called, false); assert.equal(r.findings[0].status, 'fail')
})

// ── Vercel ──
test('vercel: unconfigured returns setup steps', async () => {
  assert.match((await checkVercel({})).setup, /VERCEL_TOKEN=/)
})
test('vercel: a READY production deployment is ok; ERROR is a failure; repeated failures warn', async () => {
  const dep = (state) => async () => json({ deployments: [{ state, created: Date.UTC(2026, 8, 30, 12, 0) }] })
  assert.equal((await checkVercel({ token: 't', projectId: 'p' }, dep('READY'))).findings[0].status, 'ok')
  const failed = await checkVercel({ token: 't', projectId: 'p' }, dep('ERROR'))
  assert.equal(failed.findings[0].status, 'fail'); assert.match(failed.findings[0].detail, /2026-09-30 12:00 UTC/)
  const flaky = await checkVercel({ token: 't', projectId: 'p' }, async () => json({ deployments: Array.from({ length: 5 }, () => ({ state: 'ERROR', created: 1 })) }))
  assert.ok(flaky.findings.some((f) => f.id === 'vc-flaky'))
})
test('vercel: a bad token fails clearly and sends the team id when given', async () => {
  const bad = await checkVercel({ token: 't', projectId: 'p' }, async () => json({}, 403))
  assert.match(bad.findings[0].title, /rejected the token/)
  let seen = ''
  await checkVercel({ token: 't', projectId: 'p', teamId: 'team_1' }, async (u) => { seen = u; return json({ deployments: [] }) })
  assert.match(seen, /teamId=team_1/); assert.match(seen, /projectId=p/)
})

// ── Headers ──
const headersFetch = (h) => async () => new Response(null, { status: 200, headers: h })
const STRONG = { 'strict-transport-security': 'max-age=63072000; includeSubDomains', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(self)' }
test('headers: a well-configured site is all ok', async () => {
  const r = await checkSecurityHeaders('https://example.com', headersFetch(STRONG))
  assert.ok(r.findings.every((f) => f.status === 'ok'), JSON.stringify(r.findings.filter((f) => f.status !== 'ok')))
})
test('headers: a bare site gets specific, fixable warnings', async () => {
  const r = byId(await checkSecurityHeaders('https://example.com', headersFetch({})))
  for (const id of ['hdr-hsts', 'hdr-csp', 'hdr-nosniff', 'hdr-frame']) { assert.equal(r[id].status, 'warn', id); assert.match(r[id].fix, /vercel\.json/, id) }
})
test('headers: report-only CSP is called out as not enforced', async () => {
  const { 'content-security-policy': _enforced, ...withoutCsp } = STRONG
  void _enforced
  const r = byId(await checkSecurityHeaders('https://example.com', headersFetch({ ...withoutCsp, 'content-security-policy-report-only': "default-src 'self'" })))
  assert.equal(r['hdr-csp'].status, 'info'); assert.match(r['hdr-csp'].fix, /rename/i)
})
test('headers: a short HSTS lifetime warns', async () => {
  assert.equal(byId(await checkSecurityHeaders('https://example.com', headersFetch({ ...STRONG, 'strict-transport-security': 'max-age=300' })))['hdr-hsts'].status, 'warn')
})
test('headers: http:// is a failure; no URL returns setup steps', async () => {
  assert.equal((await checkSecurityHeaders('http://example.com', headersFetch({}))).findings[0].status, 'fail')
  assert.match((await checkSecurityHeaders(undefined)).setup, /SITE_URL=/)
})
