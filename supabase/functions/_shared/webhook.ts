/** Pure helpers for the webhook-inbox function (unit-tested under Node). */
export const MAX_BODY = 64 * 1024
const DROPPED = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-supabase-auth', 'apikey', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'])

export function tokenFromPath(pathname: string): string | null {
  const m = /\/webhook-inbox\/([A-Za-z0-9]{32,80})(?:\/|$)/.exec(pathname)
  return m ? m[1] : null
}
/** The sender's credentials and network identity are not stored, so a captured request can be shared in the team safely. */
export function sanitizeHeaders(headers: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => { if (!DROPPED.has(key.toLowerCase())) out[key.toLowerCase()] = value.slice(0, 1000) })
  return out
}
export function truncateBody(body: string): string {
  return body.length > MAX_BODY ? body.slice(0, MAX_BODY) + `\n… truncated (${body.length - MAX_BODY} more characters)` : body
}
