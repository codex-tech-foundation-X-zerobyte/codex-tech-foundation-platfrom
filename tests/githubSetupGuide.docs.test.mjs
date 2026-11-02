// The setup guide exists twice (docs/workspace/GITHUB_SETUP_GUIDE.md and the in-app checklist in src/lib/githubSetupGuide.ts) and both must
// match the code. These tests fail when someone adds a migration, a secret, a permission, an event or a function and forgets the guide, or
// when the two guides disagree: a setup guide that is wrong is worse than none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { MIGRATIONS, FUNCTION_COMMANDS, APP_PERMISSIONS, APP_EVENTS, SERVER_SECRETS, buildSteps } from '../src/lib/githubSetupGuide.ts'
import { REQUIRED_TABLES, READ_PERMISSIONS, WRITE_PERMISSIONS, REQUIRED_EVENTS } from '../supabase/functions/_shared/health.ts'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const guide = read('docs/workspace/GITHUB_SETUP_GUIDE.md')
const norm = (s) => s.toLowerCase().replace(/[_\s]+/g, ' ').trim()

test('the migration files the guides list are exactly the ones the connection check looks for, in order, and they exist', () => {
  const fromHealth = [...new Set(REQUIRED_TABLES.map((t) => t.migration))].sort()
  assert.deepEqual([...MIGRATIONS].sort(), fromHealth)
  assert.deepEqual([...MIGRATIONS], [...MIGRATIONS].sort(), 'listed in the order they must be run')
  const onDisk = readdirSync(new URL('supabase/migrations/', root))
  for (const m of MIGRATIONS) {
    assert.ok(onDisk.includes(m), `${m} exists`)
    assert.ok(guide.includes(m), `${m} is in the written guide`)
  }
  const inGuide = [...guide.matchAll(/`(\d{14}_[a-z_]+\.sql)`/g)].map((m) => m[1])
  for (const f of new Set(inGuide)) assert.ok(MIGRATIONS.includes(f), `the written guide mentions ${f}, which the in-app guide does not`)
})

test('every command deploys a function that exists, the webhook and the sweep carry --no-verify-jwt and integrations does not, and the written guide has each command verbatim', () => {
  for (const c of FUNCTION_COMMANDS) {
    const name = c.split(' ')[3]
    assert.ok(existsSync(new URL(`supabase/functions/${name}/index.ts`, root)), `${name} exists`)
    assert.ok(guide.includes(c), `written guide has: ${c}`)
    assert.equal(c.includes('--no-verify-jwt'), name !== 'integrations', name)
  }
  assert.ok(FUNCTION_COMMANDS.some((c) => c.includes('github-webhook')) && FUNCTION_COMMANDS.some((c) => c.includes('workspace-sweep')))
})

test('the permissions the guides tell you to set are exactly the ones the connection check requires', () => {
  const required = Object.keys(READ_PERMISSIONS).map(norm).sort()
  const inApp = APP_PERMISSIONS.map((p) => norm(p.split(':')[0])).sort()
  assert.deepEqual(inApp, required)
  for (const key of Object.keys(READ_PERMISSIONS)) assert.ok(norm(guide).includes(norm(key)), `written guide names the ${key} permission`)
  const writeNames = Object.keys(WRITE_PERMISSIONS).map(norm)
  for (const w of writeNames) assert.ok(APP_PERMISSIONS.some((p) => norm(p).startsWith(w) && /read & write/i.test(p)), `in-app guide explains the optional write level for ${w}`)
  assert.ok(/Read & write/.test(guide) && /Checks/.test(guide))
})

test('the events the guides tell you to tick are exactly the ones the connection check expects', () => {
  assert.deepEqual(APP_EVENTS.map(norm).sort(), REQUIRED_EVENTS.map(norm).sort())
  for (const e of APP_EVENTS) assert.ok(guide.includes(e), `written guide names the ${e} event`)
})

test('every secret the GitHub and Vercel code reads is in the guides, and nothing in the guides is a secret the code does not read', () => {
  const dir = new URL('supabase/functions/', root)
  const used = new Set()
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = new URL(e.name + (e.isDirectory() ? '/' : ''), d); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) for (const m of readFileSync(p, 'utf8').matchAll(/Deno\.env\.get\('((?:GITHUB|VERCEL)_[A-Z_]+|WORKSPACE_SWEEP_SECRET)'\)/g)) used.add(m[1]) } }
  walk(dir)
  assert.ok(used.size >= 4, [...used].join(','))
  for (const name of used) assert.ok(guide.includes(`\`${name}\``) || guide.includes(name), `${name} is in the written guide`)
  const inApp = new Set([...SERVER_SECRETS, ...buildSteps('x').flatMap((s) => s.copy.map((c) => c.value))])
  for (const name of used) assert.ok(inApp.has(name), `${name} is in the in-app guide`)
  for (const name of SERVER_SECRETS) assert.ok(used.has(name), `${name} is read by the code`)
})

test('the written guide covers every in-app step, in the same order, and the optional ones are labelled optional in both', () => {
  const steps = buildSteps('x')
  const titles = [
    ['migrations', /## 1\. Run the three database files/], ['deploy', /## 2\. Deploy the three functions/], ['webhook-secret', /## 3\. Make a webhook secret/], ['create-app', /## 4\. Create the GitHub App/],
    ['secrets', /## 5\. Give the three secrets to Supabase/], ['install', /## 6\. Install the App/], ['select', /## 8\. Choose the installation/], ['webhook-test', /## 9\. Prove the webhook/],
    ['link-repos', /## 8\. Choose the installation, then link repositories/], ['schedule', /## 10\. Schedule the background job/], ['writes', /## 11\. Optional: let people comment/], ['vercel', /## 12\. Optional: show deployments from Vercel/],
  ]
  for (const [id, re] of titles) assert.ok(steps.some((s) => s.id === id) && re.test(guide), `step ${id} is in both`)
  const written = titles.map(([id, re]) => [id, guide.search(re)]).filter(([, at]) => at >= 0)
  // 'select' and 'link-repos' share one written section, so compare the order of the DISTINCT written sections to the app's order.
  const appOrder = steps.map((s) => s.id).filter((id) => id !== 'select')
  const writtenOrder = written.filter(([id]) => id !== 'select').sort((a, b) => a[1] - b[1]).map(([id]) => id)
  assert.deepEqual(writtenOrder, appOrder, 'the written guide and the app list the steps in the same order')
  for (const s of steps.filter((x) => !x.required)) assert.ok(/optional/i.test(s.title), `${s.id} is labelled optional in the app`)
  assert.ok(/Optional: let people comment/.test(guide) && /Optional: show deployments/.test(guide))
})

test('the written guide gives the real fix for every webhook failure the connection check can name', () => {
  for (const code of ['401', '404', '503']) assert.ok(new RegExp(`status ${code}`).test(guide), `status ${code}`)
  for (const phrase of ['not a usable private key', 'shorter than 16 characters', 'organisation has not accepted', 'Redeliver', 'Checks']) assert.ok(guide.includes(phrase), phrase)
})

test('the guides contain no actual secret, token or key, and never tell anyone to paste one into a chat or the repository', () => {
  for (const text of [guide, readFileSync(new URL('src/lib/githubSetupGuide.ts', root), 'utf8')]) {
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/.test(text), 'no key material')
    assert.ok(!/ghp_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(text), 'no GitHub token')
    assert.ok(!/\b[0-9a-f]{64}\b/.test(text), 'no 64-character hex secret')
  }
  assert.ok(/Never paste the private key/.test(guide))
})

test('the webhook address in the guides ends with the function the code actually serves', () => {
  assert.ok(guide.includes('/functions/v1/github-webhook'))
  assert.ok(existsSync(new URL('supabase/functions/github-webhook/index.ts', root)))
})
