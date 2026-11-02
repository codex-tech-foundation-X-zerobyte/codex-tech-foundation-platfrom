import test from 'node:test'
import assert from 'node:assert/strict'
import { secretKeyProblem, findExposedSecrets } from '../src/lib/keyGuard.ts'

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', role })).toString('base64url')}.sig`

test('the public anon key is allowed', () => {
  assert.equal(secretKeyProblem(jwt('anon')), null)
  assert.equal(secretKeyProblem('sb_publishable_abc123'), null)
  assert.equal(secretKeyProblem(undefined), null)
})
test('a service_role JWT is rejected, however it is encoded', () => {
  assert.match(secretKeyProblem(jwt('service_role')), /service_role/)
  assert.match(secretKeyProblem('  ' + jwt('service_role') + '  '), /service_role/)
})
test('a new-style secret key is rejected', () => assert.match(secretKeyProblem('sb_secret_xyz'), /secret key/))
test('garbage that is not a JWT is not mistaken for one', () => {
  assert.equal(secretKeyProblem('not.a.jwt'), null)
  assert.equal(secretKeyProblem('eyJ.%%%.x'), null)
})
test('findExposedSecrets flags a service key in ANY VITE_ variable, and secret-looking names', () => {
  const problems = findExposedSecrets({
    VITE_SUPABASE_URL: 'https://x.supabase.co',
    VITE_SUPABASE_ANON_KEY: jwt('service_role'),
    VITE_SUPABASE_SERVICE_ROLE_KEY: 'whatever',
    SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), // not VITE_-prefixed => never reaches the browser => fine
  })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /VITE_SUPABASE_ANON_KEY.*service_role/)
  assert.match(problems[1], /VITE_SUPABASE_SERVICE_ROLE_KEY/)
})
test('a normal, correct configuration (including the TURN relay settings) passes', () => {
  assert.deepEqual(findExposedSecrets({
    VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon'),
    VITE_TURN_URL: 'turn:relay.example.com:3478', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'c',
  }), [])
})
