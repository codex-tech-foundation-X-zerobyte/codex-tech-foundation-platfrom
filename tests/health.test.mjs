import test from 'node:test'
import assert from 'node:assert/strict'
import { missingPermissions, secretChecks, appChecks, installationChecks, deliveryCheck, databaseChecks, vercelChecks, overall, READ_PERMISSIONS, REQUIRED_EVENTS, REQUIRED_TABLES } from '../supabase/functions/_shared/health.ts'
import { mintInstallationToken } from '../supabase/functions/_shared/githubApp.ts'

const full = { metadata: 'read', contents: 'read', issues: 'read', pull_requests: 'read', actions: 'read', deployments: 'read', checks: 'read' }
const byId = (list) => Object.fromEntries(list.map((c) => [c.id, c]))
const NOW = Date.parse('2026-11-01T12:00:00Z')

test('permissions: missing, too low, and higher-than-needed are told apart', () => {
  assert.deepEqual(missingPermissions(full, READ_PERMISSIONS), [])
  assert.deepEqual(missingPermissions({ ...full, issues: 'write', contents: 'admin' }, READ_PERMISSIONS), [])         // higher counts as met
  assert.deepEqual(missingPermissions({ ...full, checks: undefined }, READ_PERMISSIONS), ['checks (read)'])           // the one that was easy to forget
  assert.deepEqual(missingPermissions({ metadata: 'read' }, { issues: 'write' }), ['issues (write)'])
  assert.deepEqual(missingPermissions({ issues: 'read' }, { issues: 'write' }), ['issues (write)'])                    // read is below write
  assert.deepEqual(missingPermissions(null, { pull_requests: 'read' }), ['pull requests (read)'])
  assert.deepEqual(missingPermissions({ issues: 'bogus', contents: 5 }, { issues: 'read' }), ['issues (read)'])        // unknown levels never count as met
})

test('server secrets: reports set or not set, tells the next step, and never contains a value', () => {
  const all = byId(secretChecks({ appId: true, privateKey: true, privateKeyUsable: true, webhookSecret: 'a-long-enough-webhook-secret', vercelToken: true }))
  for (const id of ['secret-app-id', 'secret-key', 'secret-webhook', 'secret-vercel']) assert.equal(all[id].status, 'ok', id)
  const none = byId(secretChecks({ appId: false, privateKey: false, privateKeyUsable: null, webhookSecret: undefined, vercelToken: false }))
  assert.deepEqual([none['secret-app-id'].status, none['secret-key'].status, none['secret-webhook'].status, none['secret-vercel'].status], ['fail', 'fail', 'fail', 'warn'])   // Vercel is optional
  assert.equal(byId(secretChecks({ appId: true, privateKey: true, privateKeyUsable: false, webhookSecret: 'x'.repeat(20), vercelToken: false }))['secret-key'].status, 'fail')
  assert.equal(byId(secretChecks({ appId: true, privateKey: true, privateKeyUsable: true, webhookSecret: 'short', vercelToken: false }))['secret-webhook'].status, 'fail')
  const secret = 'SUPER-SECRET-VALUE-1234567890'
  const text = JSON.stringify(secretChecks({ appId: true, privateKey: true, privateKeyUsable: true, webhookSecret: secret, vercelToken: true }))
  assert.ok(!text.includes(secret) && !text.includes('SECRET-VALUE'))
})

test('app: sign-in failure, missing read permission, optional write permission, missing events', () => {
  const bad = byId(appChecks(null, 'GitHub rejected the App.'))
  assert.equal(bad.app.status, 'fail'); assert.equal(Object.keys(bad).length, 1)                                   // nothing else is claimed when sign-in failed
  const good = byId(appChecks({ name: 'Codex Workspace', permissions: { ...full, issues: 'write', pull_requests: 'write' }, events: REQUIRED_EVENTS }, null))
  assert.deepEqual([good.app.status, good['app-read'].status, good['app-write'].status, good['app-events'].status], ['ok', 'ok', 'ok', 'ok'])
  assert.match(good.app.detail, /Codex Workspace/)
  const noChecks = byId(appChecks({ permissions: { ...full, checks: undefined }, events: REQUIRED_EVENTS }, null))
  assert.equal(noChecks['app-read'].status, 'fail'); assert.match(noChecks['app-read'].detail, /checks \(read\)/)
  const readOnly = byId(appChecks({ permissions: full, events: REQUIRED_EVENTS }, null))
  assert.equal(readOnly['app-write'].status, 'skipped')                                                              // read-only is a valid choice, not an error
  assert.match(readOnly['app-write'].detail, /fine if you do not want writing/)
  const fewEvents = byId(appChecks({ permissions: full, events: ['push'] }, null))
  assert.equal(fewEvents['app-events'].status, 'warn'); assert.match(fewEvents['app-events'].detail, /pull request/)
  assert.equal(byId(appChecks({ permissions: full }, null))['app-events'].status, 'warn')                            // no events listed at all
})

test('installation: not selected, token failure, success, and the organisation-has-not-accepted case', () => {
  assert.equal(installationChecks({ selected: false, minted: null, error: null, reposReadable: null, appPermissions: full })[0].status, 'skipped')
  const failed = installationChecks({ selected: true, minted: null, error: 'The GitHub App is not installed.', reposReadable: null, appPermissions: full })
  assert.equal(failed[0].status, 'fail'); assert.match(failed[0].detail, /not installed/)
  const ok = byId(installationChecks({ selected: true, minted: { permissions: full }, error: null, reposReadable: true, appPermissions: full }))
  assert.deepEqual([ok.installation.status, ok['installation-repos'].status, ok['installation-perms'].status], ['ok', 'ok', 'ok'])
  // The App now asks for Checks but the organisation has not accepted: a WARNING that names the real next step, not a failure of the App.
  const lag = byId(installationChecks({ selected: true, minted: { permissions: { ...full, checks: undefined } }, error: null, reposReadable: true, appPermissions: full }))
  assert.equal(lag['installation-perms'].status, 'warn'); assert.match(lag['installation-perms'].detail, /organisation has not accepted/)
  // If the App itself lacks it, the installation cannot have it: that is the App's problem and says so.
  const appLacks = byId(installationChecks({ selected: true, minted: { permissions: { ...full, checks: undefined } }, error: null, reposReadable: true, appPermissions: { ...full, checks: undefined } }))
  assert.equal(appLacks['installation-perms'].status, 'fail')
  assert.equal(byId(installationChecks({ selected: true, minted: { permissions: full }, error: null, reposReadable: false, appPermissions: full }))['installation-repos'].status, 'fail')
})

test('webhook deliveries: no deliveries, all good, wrong secret, wrong URL, server errors, and mixed results', () => {
  const d = (code, minutesAgo = 5) => ({ status_code: code, delivered_at: new Date(NOW - minutesAgo * 60_000).toISOString(), event: 'push' })
  assert.equal(deliveryCheck(null, 'GitHub refused.', NOW).status, 'skipped')
  assert.equal(deliveryCheck([], null, NOW).status, 'warn')
  const good = deliveryCheck([d(200), d(200, 30)], null, NOW)
  assert.equal(good.status, 'ok'); assert.match(good.detail, /5 minutes ago/)
  const sig = deliveryCheck([d(401), d(401, 10)], null, NOW)
  assert.equal(sig.status, 'fail'); assert.match(sig.detail, /does not match the secret/)
  assert.match(deliveryCheck([d(404)], null, NOW).detail, /URL is wrong|not deployed/)
  assert.match(deliveryCheck([d(503)], null, NOW).detail, /GITHUB_WEBHOOK_SECRET/)
  assert.match(deliveryCheck([d(500)], null, NOW).detail, /function logs/)
  assert.match(deliveryCheck([{ status: 'timed out' }], null, NOW).detail, /could not reach/)
  assert.equal(deliveryCheck([d(0)], null, NOW).status, 'fail')
  const recovered = deliveryCheck([d(200, 1), d(401, 60)], null, NOW)
  assert.equal(recovered.status, 'warn'); assert.match(recovered.detail, /1 of the last 2/)                          // working now, but not hidden
  const regressed = deliveryCheck([d(401, 1), d(200, 60)], null, NOW)
  assert.equal(regressed.status, 'fail')                                                                           // the newest failed: do not call it healthy
  assert.match(deliveryCheck([d(200, 60 * 5)], null, NOW).detail, /5 hours ago/)
  assert.match(deliveryCheck([d(200, 60)], null, NOW).detail, /1 hour ago/)
  assert.match(deliveryCheck([d(200, 1)], null, NOW).detail, /1 minute ago/)
  assert.match(deliveryCheck([d(200, 60 * 24 * 3)], null, NOW).detail, /3 days ago/)
  assert.match(deliveryCheck([d(200, 60 * 24)], null, NOW).detail, /1 day ago/)
  assert.match(deliveryCheck([d(200)], null, NOW).detail, /^The last delivery succeeded/)
  assert.match(deliveryCheck([d(401)], null, NOW).detail, /^The last delivery did not succeed/)
  assert.match(deliveryCheck([{ status_code: 200 }], null, NOW).detail, /unknown time/)
})

test('database: names exactly which migration files to run, once each', () => {
  const allOk = Object.fromEntries(REQUIRED_TABLES.map((t) => [t.table, true]))
  assert.equal(databaseChecks(allOk)[0].status, 'ok')
  const noSlice3 = databaseChecks({ ...allOk, github_repo_policy: false, github_actions: false })[0]
  assert.equal(noSlice3.status, 'fail'); assert.match(noSlice3.detail, /github_repo_policy, github_actions/)
  assert.equal((noSlice3.detail.match(/20261007000000_github_write_access\.sql/g) ?? []).length, 1)
  assert.ok(!noSlice3.detail.includes('20261006000000') && !noSlice3.detail.includes('20261008000000'))              // does not tell you to re-run what is fine
  assert.match(databaseChecks({})[0].detail, /20261006000000_github_app_and_activity\.sql, 20261007000000_github_write_access\.sql, 20261008000000_deployment_targets\.sql/)
})

test('vercel: optional when unused, a failure when mapped without a token, per project otherwise', () => {
  assert.equal(vercelChecks({ tokenSet: false, targets: [] })[0].status, 'skipped')
  assert.equal(vercelChecks({ tokenSet: true, targets: [] })[0].status, 'skipped')
  assert.equal(vercelChecks({ tokenSet: false, targets: [{ repo: 'a/b', ok: true, message: '' }] })[0].status, 'fail')
  const r = vercelChecks({ tokenSet: true, targets: [{ repo: 'a/b', ok: true, message: '' }, { repo: 'a/c', ok: false, message: 'Vercel could not find that project.' }] })
  assert.deepEqual(r.map((c) => c.status), ['ok', 'fail']); assert.match(r[1].detail, /could not find/)
})

test('overall: any failure wins, then warnings; skipped never counts as healthy or broken', () => {
  const c = (status) => ({ id: status, group: 'server', label: status, status, detail: '' })
  assert.deepEqual(overall([c('ok'), c('skipped')]), { status: 'ok', failed: 0, warned: 0 })
  assert.deepEqual(overall([c('ok'), c('warn'), c('skipped')]), { status: 'warn', failed: 0, warned: 1 })
  assert.deepEqual(overall([c('warn'), c('fail'), c('fail')]), { status: 'fail', failed: 2, warned: 1 })
})

test('minting an installation token also reports the permissions GitHub granted, and drops anything odd', async () => {
  const res = (body) => ({ ok: true, status: 201, headers: { get: () => null }, json: async () => body })
  const t = await mintInstallationToken('jwt', 5, { fetchImpl: async () => res({ token: 'ghs_abcdefghijkl', expires_at: '2030-01-01T00:00:00Z', permissions: { issues: 'write', contents: 'read', 'bad key!': 'read', pull_requests: 5 } }) })
  assert.deepEqual(t.permissions, { issues: 'write', contents: 'read' })
  const none = await mintInstallationToken('jwt', 5, { fetchImpl: async () => res({ token: 'ghs_abcdefghijkl', expires_at: '2030-01-01T00:00:00Z', permissions: [1, 2] }) })
  assert.deepEqual(none.permissions, {})
})
