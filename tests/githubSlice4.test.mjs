// Wiring checks for GitHub Shadow slice 4 (deployments, read-only). The edge function cannot run under Node, so these read the source for
// the guards that must never be removed. Behaviour of the Vercel helpers is tested in vercel.test.mjs; the table rules in the SQL tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const fn = read('supabase/functions/integrations/index.ts')
const start = fn.indexOf("if (action === 'vercel-status')")
const block = fn.slice(start, fn.indexOf('const cred = await getCredential()'))

test('the deployments block runs BEFORE the GitHub credential is needed, so Vercel status does not depend on GitHub being connected', () => {
  assert.ok(start > 0 && block.includes("action === 'deployments'"))
  assert.ok(start < fn.indexOf('const cred = await getCredential()'))
})

test('the caller must be able to see the repository, checked with their OWN session, before any Vercel call', () => {
  const visible = block.indexOf("asCaller.from('integration_repositories')")
  assert.ok(visible > 0 && block.indexOf('if (!visible) return forbiddenResponse(cors)') > visible)
  assert.ok(block.indexOf('if (!visible) return forbiddenResponse(cors)') < block.indexOf('vercelListDeployments('))
  assert.ok(!block.includes("admin.from('integration_repositories')") && !block.includes("admin.from('deployment_targets')"), 'targets are read under the caller, never the service role')
  assert.ok(block.includes("asCaller.from('deployment_targets')"))
})

test('the Vercel project comes from the stored mapping, never from the request', () => {
  assert.ok(block.includes('target.project_ref'))
  for (const forbidden of ['body.project', 'body.team', 'body.projectId', 'body.token']) assert.ok(!block.includes(forbidden), forbidden)
})

test('the Vercel token is read from the environment, only used server side, and never placed in a response', () => {
  assert.ok(block.includes("Deno.env.get('VERCEL_TOKEN')"))
  const responses = block.match(/return json\([^\n]*\)/g) ?? []
  assert.ok(responses.length >= 5)
  for (const r of responses) assert.ok(!/vercelToken/.test(r), r)
  assert.ok(!read('src/lib/services/integrations.ts').includes('VERCEL_TOKEN'), 'the browser code never handles the token')
})

test('vercel-status is for the Main Admin only', () => {
  const at = block.indexOf("if (action === 'vercel-status')")
  assert.ok(block.slice(at, at + 160).includes('if (!isMainAdmin) return forbiddenResponse(cors)'))
})

test('the Vercel module can only READ: no write method and no deploy, redeploy, rollback or cancel endpoint exists in it', () => {
  // Judge the CODE, not the comments (the header comment says what the module cannot do).
  const src = read('supabase/functions/_shared/vercel.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of ["'POST'", "'PUT'", "'PATCH'", "'DELETE'", 'method:', '/v13/deployments', 'redeploy', 'rollback', '/cancel', 'promote', '/aliases', '/rollback', 'PATCH', 'DELETE']) assert.ok(!src.includes(forbidden), forbidden)
  assert.ok(src.includes('/v6/deployments'))
})

test('the mapping table is changed only through Main Admin functions, and is not browser-writable', () => {
  const sql = read('supabase/migrations/20261008000000_deployment_targets.sql')
  assert.ok(sql.includes('revoke all on public.deployment_targets from anon, authenticated;'))
  assert.ok(!/grant (insert|update|delete)[^;]*on public\.deployment_targets/i.test(sql))
  assert.equal((sql.match(/is distinct from 'superadmin'/g) ?? []).length, 2)
})
