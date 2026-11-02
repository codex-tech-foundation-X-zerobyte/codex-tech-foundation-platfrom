/** Small request helpers for the public edge functions. Pure (no Deno imports) so Node tests can load them. */

/**
 * The caller's address, for rate limiting. The proxy in front of the functions APPENDS to X-Forwarded-For, so its first entry is
 * whatever the caller chose to send: trusting it lets one machine dodge a limit by changing a header. cf-connecting-ip is set by
 * the edge network itself and cannot be supplied by the caller, so it wins when present; x-real-ip comes next.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const trusted = headers.get('cf-connecting-ip') ?? headers.get('x-real-ip')
  if (trusted && trusted.trim()) return trusted.trim().slice(0, 64)
  return headers.get('x-forwarded-for')?.split(',')[0].trim().slice(0, 64) || 'unknown'
}

/** True when the request already admits it is bigger than `max` bytes. Cheap: it runs before anything is read. */
export function declaredTooLarge(headers: { get(name: string): string | null }, max: number): boolean {
  const n = Number(headers.get('content-length'))
  return Number.isFinite(n) && n > max
}

/**
 * Reads a body but stops once `max` bytes have arrived (a caller can lie about, or leave out, Content-Length).
 * Returns null when the body is too large.
 */
export async function readTextLimited(request: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}
