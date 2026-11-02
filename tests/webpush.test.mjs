import test from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, verify } from 'node:crypto'
import { b64uToBytes, bytesToB64u, encryptPayload, validateVapid, vapidAuthHeader, isAllowedPushEndpoint, sendWebPush } from '../supabase/functions/_shared/webpush.ts'

// ── RFC 8291 Appendix A: the published example, reproduced byte for byte ──────────────────────────────────────────────
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

test('reproduces the RFC 8291 Appendix A example exactly', async () => {
  const pub = b64uToBytes(RFC.asPublic)
  const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: RFC.asPrivate, x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const body = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(RFC.plaintext), { salt: b64uToBytes(RFC.salt), ephemeral: { privateKey, publicKeyRaw: pub } })
  assert.equal(bytesToB64u(body), RFC.body)
})

// ── An independent receiver (written from the RFC, sharing no code with the sender) ──────────────────────────────────
function decryptAsBrowserWould(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16)
  const idLen = body[20]
  const asPublic = body.subarray(21, 21 + idLen)
  const record = body.subarray(21 + idLen)
  const uaPublic = uaEcdh.getPublicKey()
  const shared = uaEcdh.computeSecret(asPublic)
  const ikm = hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32)
  const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  const d = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce))
  d.setAuthTag(record.subarray(record.length - 16))
  const padded = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()])
  assert.equal(padded[padded.length - 1], 2, 'last-record delimiter')
  return padded.subarray(0, padded.length - 1).toString('utf8')
}

test('a fresh message decrypts on the receiving side, for short, long and non-ASCII text', async () => {
  for (const text of ['hi', 'x'.repeat(3000), '{"title":"Ada: héllo 👋","body":"日本語"}']) {
    const ua = createECDH('prime256v1'); ua.generateKeys()
    const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
    const body = await encryptPayload({ p256dh: bytesToB64u(ua.getPublicKey()), auth: bytesToB64u(auth) }, new TextEncoder().encode(text))
    assert.equal(decryptAsBrowserWould(Buffer.from(body), ua, auth), text)
  }
})

test('every message uses a fresh salt and sender key (no nonce reuse)', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const keys = { p256dh: bytesToB64u(ua.getPublicKey()), auth: bytesToB64u(crypto.getRandomValues(new Uint8Array(16))) }
  const a = await encryptPayload(keys, new TextEncoder().encode('same')); const b = await encryptPayload(keys, new TextEncoder().encode('same'))
  assert.notDeepEqual([...a.slice(0, 16)], [...b.slice(0, 16)])
  assert.notDeepEqual([...a.slice(21, 86)], [...b.slice(21, 86)])
})

test('bad device keys and oversized payloads are refused, not sent', async () => {
  await assert.rejects(encryptPayload({ p256dh: 'AAAA', auth: RFC.auth }, new Uint8Array(3))) 
  await assert.rejects(encryptPayload({ p256dh: RFC.uaPublic, auth: 'AAAA' }, new Uint8Array(3)))
  await assert.rejects(encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new Uint8Array(4000)), /too large/)
})

// ── VAPID ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function vapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])
  return { publicKey: bytesToB64u(raw), privateKey: jwk.d, nodePublic: publicKey }
}

test('the VAPID header carries a JWT that verifies with the public key and names the right audience', async () => {
  const k = vapidKeys()
  const header = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc', { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:ops@example.com' }, 1_000_000)
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  assert.ok(m, header)
  assert.equal(m[4], k.publicKey)
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' })
  assert.deepEqual(JSON.parse(Buffer.from(m[2], 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'mailto:ops@example.com' })
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: k.nodePublic, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'signature')
})

test('VAPID configuration problems are explained in plain words', () => {
  const k = vapidKeys()
  const good = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:a@b.co' }
  assert.equal(validateVapid(good), null)
  assert.match(validateVapid({ ...good, publicKey: 'short' }), /VAPID_PUBLIC_KEY/)
  assert.match(validateVapid({ ...good, privateKey: k.publicKey }), /VAPID_PRIVATE_KEY/)
  assert.match(validateVapid({ ...good, privateKey: '"quoted"' }), /base64url|VAPID_PRIVATE_KEY/)
  assert.match(validateVapid({ ...good, subject: 'ops@example.com' }), /VAPID_SUBJECT/)
})

// ── Which servers we are willing to contact ──────────────────────────────────────────────────────────────────────────
test('only real push services are ever contacted', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://db5p.notify.windows.com/w/?token=x']) assert.ok(isAllowedPushEndpoint(ok), ok)
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) assert.ok(!isAllowedPushEndpoint(bad), bad)
})

test('sendWebPush posts an encrypted body with the right headers, and never contacts a disallowed host', async () => {
  const k = vapidKeys(); const vapid = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:a@b.co' }
  const ua = createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.getRandomValues(new Uint8Array(16))
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: bytesToB64u(ua.getPublicKey()), auth: bytesToB64u(auth) } }
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }) }
  try {
    const res = await sendWebPush(sub, '{"title":"Hi"}', vapid, { ttl: 60, urgency: 'high' })
    assert.deepEqual(res, { ok: true, status: 201 })
    assert.equal(calls[0].url, sub.endpoint)
    assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm')
    assert.equal(calls[0].init.headers.TTL, '60'); assert.equal(calls[0].init.headers.Urgency, 'high')
    assert.match(calls[0].init.headers.Authorization, /^vapid t=/)
    assert.equal(decryptAsBrowserWould(Buffer.from(calls[0].init.body), ua, Buffer.from(auth)), '{"title":"Hi"}')

    calls.length = 0
    const blocked = await sendWebPush({ ...sub, endpoint: 'https://169.254.169.254/x' }, 'x', vapid, { ttl: 1, urgency: 'normal' })
    assert.equal(blocked.ok, false); assert.equal(calls.length, 0)

    globalThis.fetch = async () => new Response('gone', { status: 410 })
    assert.deepEqual(await sendWebPush(sub, 'x', vapid, { ttl: 1, urgency: 'normal' }), { ok: false, status: 410, error: 'gone' })
  } finally { globalThis.fetch = realFetch }
})
