import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticFetch, describeTarget, buildReport } from '../src/lib/diagnostics.ts'
import { AppError, toError } from '../src/lib/appError.ts'

const POSTGREST_400 = { code: '42703', details: 'Failing row contains (a1b2, Ada Lovelace, ada@example.com)', hint: null, message: 'record "old" has no field "id"' }

async function run(fetchImpl, url, init) {
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args)
  try {
    const f = createDiagnosticFetch(fetchImpl)
    const res = await f(url, init)
    await new Promise((r) => setTimeout(r, 20)) // the report is produced from a cloned body, asynchronously
    return { res, logged }
  } finally {
    console.error = original
  }
}

test('a failed PostgREST request is reported with status, code and message', async () => {
  const { res, logged } = await run(
    async () => new Response(JSON.stringify(POSTGREST_400), { status: 400, headers: { 'content-type': 'application/json' } }),
    'https://abc.supabase.co/rest/v1/worker_profiles?user_id=eq.19230577-6467-49a8-acec-19166cdb27ff',
    { method: 'PATCH', headers: { Authorization: 'Bearer SECRET.JWT.TOKEN', apikey: 'ANON-KEY' }, body: JSON.stringify({ status: 'suspended', password: 'hunter2' }) },
  )
  assert.equal(logged.length, 1)
  const [label, payload] = logged[0]
  assert.match(label, /PATCH rest worker_profiles → 400 \(42703\)/)
  assert.equal(payload.status, 400)
  assert.equal(payload.code, '42703')
  assert.equal(payload.message, 'record "old" has no field "id"')
  // the caller must still be able to read the body we peeked at
  assert.equal((await res.json()).code, '42703')
})

test('nothing sensitive reaches the console: no token, key, request body, query values, or failing-row details', async () => {
  const { logged } = await run(
    async () => new Response(JSON.stringify(POSTGREST_400), { status: 400 }),
    'https://abc.supabase.co/rest/v1/worker_profiles?user_id=eq.19230577-6467-49a8-acec-19166cdb27ff&email=eq.ada@example.com',
    { method: 'PATCH', headers: { Authorization: 'Bearer SECRET.JWT.TOKEN', apikey: 'ANON-KEY' }, body: JSON.stringify({ password: 'hunter2' }) },
  )
  const text = JSON.stringify(logged)
  for (const secret of ['SECRET.JWT.TOKEN', 'ANON-KEY', 'hunter2', '19230577', 'ada@example.com', 'Ada Lovelace', 'Failing row']) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`)
  }
})

test('successful requests are silent', async () => {
  const { logged } = await run(async () => new Response('[]', { status: 200 }), 'https://abc.supabase.co/rest/v1/projects', { method: 'GET' })
  assert.equal(logged.length, 0)
})

test('a wrong password (400 from /auth/v1/token) is not logged as a fault', async () => {
  const { logged } = await run(async () => new Response(JSON.stringify({ error_description: 'Invalid login credentials' }), { status: 400 }), 'https://abc.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' })
  assert.equal(logged.length, 0)
})

test('403 RLS denial reports the code and the table', async () => {
  const { logged } = await run(
    async () => new Response(JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "project_updates"' }), { status: 403 }),
    'https://abc.supabase.co/rest/v1/project_updates', { method: 'POST' })
  assert.match(logged[0][0], /POST rest project_updates → 403 \(42501\)/)
})

test('network failures are reported and still thrown to the caller', async () => {
  const logged = []
  const original = console.error
  console.error = (...a) => logged.push(a)
  try {
    await assert.rejects(() => createDiagnosticFetch(async () => { throw new TypeError('Failed to fetch') })('https://abc.supabase.co/rest/v1/x', {}), /Failed to fetch/)
  } finally { console.error = original }
  assert.match(logged[0][0], /network error/)
})

test('non-JSON error bodies do not break reporting', () => {
  const { report } = buildReport('GET', 'https://abc.supabase.co/functions/v1/health', 502, null)
  assert.equal(report.status, 502)
  assert.equal(report.target, 'functions health')
})

test('describeTarget drops the query string', () => {
  assert.equal(describeTarget('https://x.co/rest/v1/tasks?assignee_id=eq.123').target, 'rest tasks')
})

// ---- AppError: what the UI shows vs what a developer needs ----
test('AppError shows people a plain message and keeps the technical detail', () => {
  const e = toError({ message: 'record "old" has no field "id"', code: '42703', hint: null, details: null }, 400)
  assert.ok(e instanceof AppError)
  assert.match(e.message, /internal error 42703/)           // no DB internals in front of users
  assert.equal(e.technical, 'record "old" has no field "id"') // but available for diagnostics
  assert.equal(e.status, 400)
})

test('permission errors are recognisable and worded clearly', () => {
  const rls = toError({ message: 'new row violates row-level security policy for table "project_updates"', code: '42501' }, 403)
  assert.equal(rls.message, "You don't have permission to do that.")
  assert.equal(rls.isPermissionDenied, true)
  assert.equal(toError({ message: 'JWT expired', code: 'PGRST301' }, 401).message, 'Your session has expired. Please sign in again.')
})

test('unrecognised errors keep the server message; null stays null', () => {
  assert.equal(toError({ message: 'something specific' }).message, 'something specific')
  assert.equal(toError(null), null)
})
