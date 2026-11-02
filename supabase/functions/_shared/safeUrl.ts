/**
 * Where a callback may be sent. The address is chosen by an administrator, but it still must not be turned against our own network:
 * https only, a real domain name, port 443 or 8443, no credentials, and (checked again at send time, after DNS) every address it
 * resolves to must be a public one. Mirrors public.support_callback_url_ok in the database.
 */
const INTERNAL_SUFFIX = /\.(local|localhost|internal|lan|home|corp|intranet|private|test|invalid|example)$/
const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/

export type UrlCheck = { ok: true; url: URL; host: string } | { ok: false; reason: string }

export function validateCallbackUrl(raw: string): UrlCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return { ok: false, reason: 'The address is missing or too long.' }
  if (/\s/.test(raw.trim())) return { ok: false, reason: 'The address must not contain spaces.' }
  let url: URL
  try { url = new URL(raw.trim()) } catch { return { ok: false, reason: 'The address is not a valid URL.' } }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https addresses are allowed.' }
  if (url.username || url.password) return { ok: false, reason: 'Credentials in the address are not allowed.' }
  if (url.hash) return { ok: false, reason: 'A # fragment is not allowed.' }
  if (url.port && url.port !== '443' && url.port !== '8443') return { ok: false, reason: 'Only port 443 or 8443 is allowed.' }
  const host = url.hostname.toLowerCase()
  if (!HOST.test(host)) return { ok: false, reason: 'The address must use a domain name, not an IP address or a single-word host.' }
  if (INTERNAL_SUFFIX.test(host)) return { ok: false, reason: 'Internal host names are not allowed.' }
  return { ok: true, url, host }
}

function v4(parts: number[]): boolean {
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false                    // this network, private, loopback, multicast and reserved
  if (a === 100 && b >= 64 && b <= 127) return false                                 // carrier-grade NAT
  if (a === 169 && b === 254) return false                                           // link-local, including the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return false                                  // private
  if (a === 192 && b === 168) return false                                           // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false                     // protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return false                              // benchmarking
  if (a === 198 && b === 51 && c === 100) return false                               // documentation
  if (a === 203 && b === 0 && c === 113) return false                                // documentation
  return true
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if it is not valid. */
function groups6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)               // ::ffff:1.2.3.4
  if (tail) { const n = tail.slice(1).map(Number); if (n.some((x) => x > 255)) return null; s = s.slice(0, tail.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16) }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && head.length !== 8) return null
  const fill = 8 - head.length - rest.length
  if (fill < (halves.length === 2 ? 1 : 0)) return null
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}

/** True only for an address on the public internet. Anything unparseable counts as not public. */
export function isPublicIp(ip: string): boolean {
  const m4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m4) { const p = m4.slice(1).map(Number); return p.every((x) => x <= 255) && v4(p) }
  const g = groups6(ip)
  if (!g) return false
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return v4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])   // IPv4-mapped
  if ((g[0] & 0xe000) !== 0x2000) return false                                       // only global unicast 2000::/3
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false                               // documentation
  if (g[0] === 0x2001 && g[1] === 0) return false                                    // Teredo
  if (g[0] === 0x2002) return false                                                  // 6to4 (embeds an IPv4 address)
  return true
}
