// Wiring checks for GitHub Shadow slice 3 (writes). The edge function cannot run under Node, so these read the source for the guards that
// must never be removed. The behaviour behind them is tested in githubWrite.test.mjs and in the SQL tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const fn = read('supabase/functions/integrations/index.ts')
const block = fn.slice(fn.indexOf("if (action === 'comment' || action === 'create-issue')"), fn.indexOf("if (action === 'repo-detail')"))

test('the write actions sit AFTER the check that the caller can see the repository', () => {
  assert.ok(fn.indexOf("const { data: allowed } = await asCaller.from('integration_repositories')") < fn.indexOf("action === 'comment' || action === 'create-issue'"))
  assert.ok(fn.indexOf('if (!allowed) return forbiddenResponse(cors)') < fn.indexOf("action === 'comment' || action === 'create-issue'"))
})

test('permission is asked of the database under the CALLER\'s own session, never the service role', () => {
  assert.ok(block.includes("asCaller.rpc('github_can'"))
  assert.ok(!block.includes("admin.rpc('github_can'"))
})

test('the actor recorded is the verified caller, never a value from the request body', () => {
  assert.ok(block.includes('p_actor: caller.userId'))
  assert.ok(!/p_actor:\s*body\./.test(block))
})

test('the credential source is passed through, so the shared personal token cannot write', () => {
  assert.ok(block.includes('credentialSource: cred.source'))
})

test('the request id, number, text and title come from the body but nothing else (no author, no role, no permission)', () => {
  assert.ok(block.includes('request_id'))
  for (const forbidden of ['body.role', 'body.actor', 'body.user', 'body.permission', 'body.can']) assert.ok(!block.includes(forbidden), forbidden)
})

test('the sweep closes requests that never got an answer, inside the isolated github step', () => {
  const sweep = read('supabase/functions/workspace-sweep/index.ts')
  const at = sweep.indexOf("part('github'")
  assert.ok(at > 0 && sweep.slice(at, at + 500).includes("rpc('expire_github_actions')"))
})

test('the policy and the audit table are not writable from the browser: only functions change them', () => {
  const sql = read('supabase/migrations/20261007000000_github_write_access.sql')
  assert.ok(sql.includes('revoke all on public.github_repo_policy from anon, authenticated;'))
  assert.ok(sql.includes('revoke all on public.github_actions from anon, authenticated;'))
  assert.ok(!/grant (insert|update|delete)[^;]*on public\.github_(repo_policy|actions)/i.test(sql))
})
