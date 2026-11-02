// Wiring checks for GitHub Shadow slice 5 (connection check). The edge function cannot run under Node, so these read the source for the
// guards that must never be removed. The findings logic is tested in health.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const fn = read('supabase/functions/integrations/index.ts')
const start = fn.indexOf("if (action === 'health')")
const block = fn.slice(start, fn.indexOf("// ---- Deployments (read-only, Vercel)."))

test('the connection check is for the Main Admin only, and that is the first thing it checks', () => {
  assert.ok(start > 0)
  assert.ok(block.slice(0, 120).includes('if (!isMainAdmin) return forbiddenResponse(cors)'))
})

test('it runs before the GitHub credential is needed, so it can diagnose a connection that is not working yet', () => {
  assert.ok(start < fn.indexOf('const cred = await getCredential()'))
})

test('it only READS: no write call to GitHub or Vercel, no database write', () => {
  for (const forbidden of ['githubPost', 'runWrite', '.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) assert.ok(!block.includes(forbidden), forbidden)
})

test('secret VALUES are never placed in a response: only presence flags and findings are returned', () => {
  const responses = block.match(/return json\([^\n]*\)/g) ?? []
  assert.ok(responses.length >= 1)
  for (const r of responses) for (const secret of ['appKey', 'vercelToken', 'jwt', 'minted.token', 'GITHUB_WEBHOOK_SECRET']) assert.ok(!r.includes(secret), `${secret} in ${r}`)
  // The values may be passed to the pure functions only as presence booleans or the webhook secret for a length check inside secretChecks.
  assert.ok(block.includes('appId: !!appId') && block.includes('privateKey: !!appKey') && block.includes('vercelToken: !!vercelToken'))
})

test('the secretChecks function never copies a secret into its text', () => {
  const src = read('supabase/functions/_shared/health.ts')
  const fnSrc = src.slice(src.indexOf('export function secretChecks'), src.indexOf('/** The App itself'))
  assert.ok(!/\$\{\s*(w|env\.webhookSecret)\s*\}/.test(fnSrc), 'the webhook secret is only measured, never printed')
  assert.ok(!fnSrc.includes('env.privateKey}') && !fnSrc.includes('env.vercelToken}'))
})

test('the connection check never runs on its own in the browser: only when the button is pressed', () => {
  const ui = read('src/pages/admin/AdminIntegrations.tsx')
  const panel = ui.slice(ui.indexOf('function ConnectionCheckPanel'), ui.indexOf('const LEVELS'))
  assert.ok(!panel.includes('useEffect') && !panel.includes('useAsyncData'))
  assert.ok(panel.includes('onClick={() => void run()}'))
})

test('the report is plain data: the panel renders findings as text, never as HTML', () => {
  const ui = read('src/pages/admin/AdminIntegrations.tsx')
  assert.ok(!ui.includes('dangerouslySetInnerHTML'))
})
