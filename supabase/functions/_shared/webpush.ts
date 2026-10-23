/**
 * Web Push without a dependency: RFC 8291 (message encryption, aes128gcm) + RFC 8292 (VAPID), on the standard WebCrypto API
 * that Deno (Supabase Edge Functions) and Node both provide. No Deno or Node imports, so tests/webpush.test.mjs runs this exact
 * file — including against the RFC 8291 Appendix A test vector.
 *
 * Why not the `web-push` npm package: it leans on Node internals (http2/https agents, asn1.js) that Supabase's Deno runtime
 * only partly emulates, and a failure there is silent from the outside. This is ~120 lines we can test.
 */

const enc = new TextEncoder()

export const b64uToBytes = (s: string): Uint8Array => {
  const clean = s.trim().replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const bytesToB64u = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource))
}

/** HKDF-SHA256 (RFC 5869) for outputs of at most one hash block, which is all Web Push needs (16, 12 and 32 bytes). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

export interface PushKeys { p256dh: string; auth: string }
export interface PushSubscriptionLike { endpoint: string; keys: PushKeys }
export interface VapidConfig { publicKey: string; privateKey: string; subject: string }

/** Test seam: fixed salt and sender key so the RFC's published vector can be reproduced. Never used in production. */
export interface EncryptTestInputs { salt?: Uint8Array; ephemeral?: { privateKey: CryptoKey; publicKeyRaw: Uint8Array } }

const MAX_PLAINTEXT = 3800 // one 4096-byte record minus the 17 bytes of tag and delimiter, with headroom

/** RFC 8291 aes128gcm: returns the complete request body (header block + one encrypted record). */
export async function encryptPayload(keys: PushKeys, plaintext: Uint8Array, test?: EncryptTestInputs): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('Push payload is too large.')
  const uaPublic = b64uToBytes(keys.p256dh)
  const authSecret = b64uToBytes(keys.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('The device key is not a valid P-256 public key.')
  if (authSecret.length !== 16) throw new Error('The device auth secret is not 16 bytes.')

  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  let eph = test?.ephemeral
  if (!eph) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    eph = { privateKey: pair.privateKey, publicKeyRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) }
  }
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const ikm = await hkdf(authSecret, sharedSecret, concat(enc.encode('WebPush: info\0'), uaPublic, eph.publicKeyRaw), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  // A single record: the message followed by the 0x02 "last record" delimiter.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, concat(plaintext, new Uint8Array([2])) as BufferSource))

  // Header block: salt(16) | record size 4096 (4 bytes, big-endian) | key id length (1) | key id = sender public key (65)
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([65]), eph.publicKeyRaw, sealed)
}

/** Returns a plain-English problem with the VAPID configuration, or null if it is usable. */
export function validateVapid(v: VapidConfig): string | null {
  const decode = (value: string) => { try { return b64uToBytes(value) } catch { return null } }
  const pub = decode(v.publicKey)
  if (pub === null) return 'VAPID_PUBLIC_KEY has characters that are not base64url — check for stray quotes, spaces or line breaks where it was pasted.'
  if (pub.length !== 65 || pub[0] !== 4) return 'VAPID_PUBLIC_KEY is not a valid key (expected the 87-character public key from `npx web-push generate-vapid-keys`).'
  const priv = decode(v.privateKey)
  if (priv === null) return 'VAPID_PRIVATE_KEY has characters that are not base64url — check for stray quotes, spaces or line breaks where it was pasted.'
  if (priv.length !== 32) return 'VAPID_PRIVATE_KEY is not a valid key (expected the 43-character private key from the same command).'
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(v.subject)) return 'VAPID_SUBJECT must look like mailto:you@your-domain.com (or an https:// address).'
  return null
}

/** RFC 8292: an ES256 JWT proving this server may push for the application server key the device subscribed with. */
export async function vapidAuthHeader(endpoint: string, vapid: VapidConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64uToBytes(vapid.publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapid.privateKey.trim(), x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: vapid.subject })))
  const signingInput = `${header}.${claims}`
  // WebCrypto returns ECDSA signatures as raw r||s (IEEE P1363), which is exactly what JWT ES256 wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)))
  return `vapid t=${signingInput}.${bytesToB64u(signature)}, k=${vapid.publicKey.trim()}`
}

/**
 * Push endpoints come from browsers via a table users can write to, so a hostile user could register an address that points
 * at something internal and have this server POST to it. Only the real push services are ever contacted.
 */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname))
  } catch { return false }
}

export interface SendResult { ok: boolean; status: number; error?: string }

export async function sendWebPush(
  sub: PushSubscriptionLike,
  payload: string,
  vapid: VapidConfig,
  opts: { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; timeoutMs?: number },
): Promise<SendResult> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, status: 0, error: 'This device uses a push service that is not supported.' }
  let body: Uint8Array
  let authorization: string
  try {
    body = await encryptPayload(sub.keys, enc.encode(payload))
    authorization = await vapidAuthHeader(sub.endpoint, vapid)
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Could not prepare the message.' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(opts.ttl), Urgency: opts.urgency, Authorization: authorization },
      body: body as BodyInit,
      signal: controller.signal,
    })
    const ok = res.status >= 200 && res.status < 300
    return ok ? { ok, status: res.status } : { ok, status: res.status, error: (await res.text().catch(() => '')).slice(0, 200) }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).name === 'AbortError' ? 'The push service did not answer in time.' : (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
