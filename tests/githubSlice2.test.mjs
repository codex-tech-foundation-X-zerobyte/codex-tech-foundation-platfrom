// Wiring checks for GitHub Shadow slice 2. The edge functions cannot run under Node, so these read the source for the guards that
// must not be removed. The behaviour of the helpers they call is tested in github.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the sweep prunes the GitHub delivery log and feed, keeping 90 days, and a failure there cannot stop the other sweeps', () => {
  const src = read('supabase/functions/workspace-sweep/index.ts')
  const at = src.indexOf("part('github'")
  assert.ok(at > 0, 'the prune runs inside the isolated part() wrapper')
  assert.ok(src.slice(at, at + 250).includes("rpc('prune_github_data', { p_days: 90 })"))
  assert.ok(at < src.indexOf("part('callbacks'"))
})

test('pull request and issue actions validate the number and the filter before calling GitHub', () => {
  const src = read('supabase/functions/integrations/index.ts')
  for (const a of ['pull-detail', 'issue-detail']) {
    const at = src.indexOf(`action === '${a}'`)
    assert.ok(at > 0, a)
    assert.match(src.slice(at, at + 200), /isItemNumber\(body\.number\)/, `${a} must validate the number first`)
  }
  assert.match(src.slice(src.indexOf("action === 'issues'"), src.indexOf("action === 'issues'") + 250), /isListState\(state\)/)
  assert.match(src.slice(src.indexOf("action === 'pulls'"), src.indexOf("action === 'pulls'") + 250), /isListState\(pstate\)/)
})

test('a missing Checks permission shows "unknown", never "passing", and the check call is best effort', () => {
  const src = read('supabase/functions/integrations/index.ts')
  assert.ok(src.includes('} catch { runs = null }'))
  assert.ok(src.includes("let runs: Record<string, unknown>[] | null = null"))
})

test('issue detail refuses a pull request number instead of showing it as an issue', () => {
  assert.match(read('supabase/functions/integrations/index.ts'), /if \(issue\.pull_request\) return json\(\{ error:/)
})
