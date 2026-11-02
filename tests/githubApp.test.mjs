import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify, createPrivateKey } from 'node:crypto'
import {
  b64url, pemToPkcs8, signAppJwt, mintInstallationToken, createTokenCache, resolveCredential, isAppId, isInstallationId,
} from '../supabase/functions/_shared/githubApp.ts'
import { GithubError } from '../supabase/functions/_shared/github.ts'

const { privateKey: pkcs1, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const { privateKey: pkcs8 } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const decode = (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body })

test('base64url has no padding or unsafe characters', () => {
  assert.equal(b64url('??>>'), 'Pz8-Pg')
  assert.ok(!/[+/=]/.test(b64url(new Uint8Array([251, 255, 254, 253]))))
})

test('the App JWT is RS256, back-dated 60s, lives under 10 minutes, and verifies with the public key (PKCS#1 key as GitHub issues it)', async () => {
  const now = 1_800_000_000
  const jwt = await signAppJwt('123456', pkcs1, now)
  const [h, b, sig] = jwt.split('.')
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT' })
  const claims = decode(b)
  assert.equal(claims.iss, '123456'); assert.equal(claims.iat, now - 60); assert.ok(claims.exp - now < 600 && claims.exp > now)
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${b}`)
  assert.ok(v.verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')))
})

test('a PKCS#8 key and a key pasted with literal \\n sequences also work', async () => {
  const jwt = await signAppJwt('42', pkcs8.trim().replace(/\n/g, '\\n'), 1_800_000_000)
  assert.equal(jwt.split('.').length, 3)
  // the hand-built PKCS#8 envelope must be byte-identical to what OpenSSL produces for the same key
  assert.deepEqual(Buffer.from(pemToPkcs8(pkcs1)), createPrivateKey(pkcs1).export({ type: 'pkcs8', format: 'der' }))
})

test('bad keys and bad ids are refused without echoing the key', async () => {
  await assert.rejects(signAppJwt('1', 'not a key', 1), (e) => e instanceof GithubError && !e.message.includes('not a key'))
  await assert.rejects(signAppJwt('abc', pkcs1, 1), GithubError)
  assert.ok(isAppId('123') && !isAppId('12a') && !isAppId(''))
  assert.ok(isInstallationId(99) && isInstallationId('99') && !isInstallationId('9/../x') && !isInstallationId(null))
})

test('minting posts to the installation endpoint with the App JWT, and can narrow to named repositories', async () => {
  let seen
  const out = await mintInstallationToken('JWT.X.Y', 777, { repositories: ['web'], fetchImpl: async (u, i) => { seen = { u, i }; return res(201, { token: 'ghs_abcdefghijklmnop', expires_at: '2030-01-01T00:00:00Z' }) } })
  assert.equal(seen.u, 'https://api.github.com/app/installations/777/access_tokens')
  assert.equal(seen.i.method, 'POST'); assert.equal(seen.i.headers.Authorization, 'Bearer JWT.X.Y')
  assert.deepEqual(JSON.parse(seen.i.body), { repositories: ['web'] })
  assert.equal(out.token, 'ghs_abcdefghijklmnop'); assert.equal(out.expiresAt, Date.parse('2030-01-01T00:00:00Z'))
})

test('minting failures map to clear kinds and never leak the JWT', async () => {
  const kind = async (status, body) => { try { await mintInstallationToken('SECRET_JWT', 1, { fetchImpl: async () => res(status, body) }) } catch (e) { return e } }
  assert.equal((await kind(401)).kind, 'unauthorized')
  assert.equal((await kind(403)).kind, 'forbidden')
  assert.equal((await kind(404)).kind, 'not_found')
  assert.equal((await kind(500)).kind, 'error')
  assert.equal((await kind(201, { token: 'x' })).status, 502)             // malformed success body
  assert.equal((await kind(201, { token: 'ghs_abcdefghij', expires_at: 'nope' })).status, 502)
  for (const s of [401, 403, 404, 500]) assert.ok(!(await kind(s)).message.includes('SECRET_JWT'))
  await assert.rejects(mintInstallationToken('j', '1/../2'), GithubError)
})

test('the cache serves a token until it is within the safety margin of expiry', () => {
  const c = createTokenCache(120_000)
  c.set('k', { token: 't1', expiresAt: 1_000_000 })
  assert.equal(c.get('k', 800_000), 't1')
  assert.equal(c.get('k', 880_001), null)   // inside the 2-minute margin
  assert.equal(c.get('other', 0), null)
  c.clear('k'); assert.equal(c.get('k', 0), null)
})

test('resolveCredential prefers the App, caches the minted token, and falls back to the legacy token', async () => {
  let mints = 0
  const fetchImpl = async () => { mints++; return res(201, { token: `ghs_token_${mints}_xxxx`, expires_at: new Date(Date.now() + 3_600_000).toISOString() }) }
  const cache = createTokenCache(); const now = Date.now()
  const base = { appId: '1', privateKey: pkcs1, installationId: 5, legacyToken: 'ghp_legacy_token_value', cache, now, fetchImpl }
  const a = await resolveCredential(base); assert.equal(a.source, 'github_app')
  const b = await resolveCredential(base); assert.equal(b.token, a.token); assert.equal(mints, 1)
  const legacy = await resolveCredential({ ...base, installationId: null, cache: createTokenCache() })
  assert.deepEqual(legacy, { token: 'ghp_legacy_token_value', source: 'personal_token' })
  assert.equal(await resolveCredential({ ...base, installationId: null, legacyToken: null, appId: undefined, cache: createTokenCache() }), null)
  assert.equal(mints, 1)
})

test('if the App is configured but minting fails, the error surfaces instead of silently using the shared token', async () => {
  await assert.rejects(resolveCredential({ appId: '1', privateKey: pkcs1, installationId: 5, legacyToken: 'ghp_legacy_token_value', cache: createTokenCache(), now: Date.now(), fetchImpl: async () => res(404) }), (e) => e.kind === 'not_found')
})
