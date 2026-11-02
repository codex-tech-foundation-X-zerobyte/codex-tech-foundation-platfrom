/**
 * Signing of callbacks. Header: `x-codex-signature: t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${body}`).
 * The receiver recomputes it over the exact bytes it received and rejects a mismatch or a timestamp more than five minutes old.
 */
const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

export async function signWebhook(secret: string, timestampSeconds: number, body: string): Promise<string> {
  return `t=${timestampSeconds},v1=${await hmacHex(secret, `${timestampSeconds}.${body}`)}`
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** What a receiving backend does. Included so it is tested, and so the documentation's example is real. */
export async function verifyWebhook(secret: string, header: string | null, body: string, nowSeconds: number, toleranceSeconds = 300): Promise<boolean> {
  const m = header?.match(/^t=(\d{1,12}),v1=([0-9a-f]{64})$/)
  if (!m) return false
  const t = Number(m[1])
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false
  return safeEqual(m[2], await hmacHex(secret, `${t}.${body}`))
}
