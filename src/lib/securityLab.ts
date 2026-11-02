/*
  Security Lab: defensive analysis utilities. Everything here works on text the person pastes, or on public DNS data for a
  domain they type; nothing probes a target. No network access except `lookupDns`, which asks a public DNS-over-HTTPS resolver.
*/

export type Severity = 'pass' | 'info' | 'warn' | 'fail'
export interface Finding { id: string; severity: Severity; title: string; detail: string }

/* ---- HTTP security headers ---------------------------------------------------------------------------------------------- */

export interface ParsedHeaders { status: string | null; headers: Record<string, string[]> }

/** Accepts `curl -I` output, browser "copy response headers", or bare `Name: value` lines. */
export function parseHeaders(raw: string): ParsedHeaders {
  const headers: Record<string, string[]> = {}
  let status: string | null = null
  let last: string | null = null
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) { last = null; continue }
    if (/^HTTP\/[\d.]+\s+\d{3}/i.test(line)) { status = line.trim(); last = null; continue }
    if (/^\s/.test(line) && last) { const arr = headers[last]; arr[arr.length - 1] += ' ' + line.trim(); continue }
    const i = line.indexOf(':')
    if (i < 1) continue
    const name = line.slice(0, i).trim().toLowerCase()
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue
    ;(headers[name] ??= []).push(line.slice(i + 1).trim())
    last = name
  }
  return { status, headers }
}

const first = (p: ParsedHeaders, name: string) => p.headers[name]?.[0]

export function analyzeSecurityHeaders(raw: string): { findings: Finding[]; score: number; headerCount: number } {
  const p = parseHeaders(raw)
  const f: Finding[] = []
  const add = (id: string, severity: Severity, title: string, detail: string) => f.push({ id, severity, title, detail })

  const hsts = first(p, 'strict-transport-security')
  if (!hsts) add('hsts', 'fail', 'No Strict-Transport-Security', 'Browsers may connect over plain HTTP first. Send HSTS with a long max-age on HTTPS responses.')
  else {
    const age = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0)
    if (age < 15_552_000) add('hsts', 'warn', 'HSTS max-age is short', `max-age=${age}. Use at least 15552000 (180 days); a year is common.`)
    else add('hsts', 'pass', 'HSTS is set', hsts + (/includeSubDomains/i.test(hsts) ? '' : ' (consider includeSubDomains if every subdomain is HTTPS)'))
  }

  const csp = first(p, 'content-security-policy')
  if (!csp) add('csp', 'fail', 'No Content-Security-Policy', 'A CSP is the strongest defence against script injection. Start with default-src \'self\'.')
  else {
    const issues: string[] = []
    if (/'unsafe-inline'/.test(csp.replace(/style-src[^;]*/i, ''))) issues.push("allows 'unsafe-inline' scripts")
    if (/'unsafe-eval'/.test(csp)) issues.push("allows 'unsafe-eval'")
    if (/(default-src|script-src)[^;]*(\s\*(\s|;|$)|https?:\s|data:)/i.test(csp)) issues.push('allows scripts from a wildcard or data: source')
    if (!/(default-src|script-src)/i.test(csp)) issues.push('has no default-src or script-src')
    add('csp', issues.length ? 'warn' : 'pass', issues.length ? 'CSP is present but weak' : 'CSP is set', issues.length ? `It ${issues.join(', ')}.` : 'No obviously unsafe sources found.')
  }

  const nosniff = first(p, 'x-content-type-options')
  add('nosniff', nosniff?.toLowerCase() === 'nosniff' ? 'pass' : 'fail', nosniff?.toLowerCase() === 'nosniff' ? 'MIME sniffing blocked' : 'Missing X-Content-Type-Options: nosniff', nosniff?.toLowerCase() === 'nosniff' ? 'nosniff' : 'Without it, browsers may guess a content type and run something unexpected.')

  const xfo = first(p, 'x-frame-options')
  const frameAncestors = csp ? /frame-ancestors/i.test(csp) : false
  if (xfo || frameAncestors) add('framing', 'pass', 'Clickjacking protection', frameAncestors ? 'CSP frame-ancestors is set.' : `X-Frame-Options: ${xfo}`)
  else add('framing', 'fail', 'No clickjacking protection', 'Set CSP frame-ancestors (or X-Frame-Options: DENY) so other sites cannot frame this one.')

  const ref = first(p, 'referrer-policy')
  if (!ref) add('referrer', 'warn', 'No Referrer-Policy', 'Full URLs may leak to other sites. strict-origin-when-cross-origin is a sensible default.')
  else if (/unsafe-url|no-referrer-when-downgrade/i.test(ref)) add('referrer', 'warn', 'Referrer-Policy leaks URLs', ref)
  else add('referrer', 'pass', 'Referrer-Policy is set', ref)

  add('permissions', first(p, 'permissions-policy') ? 'pass' : 'info', first(p, 'permissions-policy') ? 'Permissions-Policy is set' : 'No Permissions-Policy', first(p, 'permissions-policy') ?? 'Optional, but lets you switch off camera, microphone and geolocation you do not use.')
  add('coop', first(p, 'cross-origin-opener-policy') ? 'pass' : 'info', first(p, 'cross-origin-opener-policy') ? 'Cross-Origin-Opener-Policy is set' : 'No Cross-Origin-Opener-Policy', first(p, 'cross-origin-opener-policy') ?? 'Isolates the page from windows it opens. Useful for sensitive apps.')

  const server = first(p, 'server'); const powered = first(p, 'x-powered-by')
  if (powered) add('powered', 'warn', 'X-Powered-By reveals the stack', powered)
  if (server && /\d+\.\d+/.test(server)) add('server', 'warn', 'Server header reveals a version', server)

  const acao = first(p, 'access-control-allow-origin'); const creds = first(p, 'access-control-allow-credentials')
  if (acao === '*' && creds?.toLowerCase() === 'true') add('cors', 'fail', 'CORS allows any origin with credentials', 'Browsers reject this combination, and it signals a misconfiguration. Name the allowed origins.')
  else if (acao === '*') add('cors', 'info', 'CORS allows any origin', 'Fine for public data; wrong for anything tied to a login.')

  for (const cookie of p.headers['set-cookie'] ?? []) {
    const name = cookie.split('=')[0]
    const missing = [!/;\s*secure/i.test(cookie) && 'Secure', !/;\s*httponly/i.test(cookie) && 'HttpOnly', !/;\s*samesite=/i.test(cookie) && 'SameSite'].filter(Boolean)
    add(`cookie:${name}`, missing.length ? 'warn' : 'pass', `Cookie “${name}”`, missing.length ? `Missing ${missing.join(', ')}.` : 'Secure, HttpOnly and SameSite are set.')
  }

  const scored = f.filter((x) => x.severity !== 'info')
  const score = scored.length ? Math.round((scored.filter((x) => x.severity === 'pass').length / scored.length) * 100) : 0
  return { findings: f, score, headerCount: Object.keys(p.headers).length }
}

/* ---- Log analysis ---------------------------------------------------------------------------------------------------------- */

export interface LogReport {
  lines: number
  recognised: number
  levels: Record<string, number>
  statuses: Record<string, number>
  topIps: [string, number][]
  topErrors: [string, number][]
  topPaths: [string, number][]
  first: string | null
  last: string | null
  flags: string[]
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\S+)/
const LEVEL = /\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|CRIT(?:ICAL)?|FATAL|ALERT|EMERG)\b/i
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
const TS = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/

const top = (m: Map<string, number>, n = 5): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** Normalise an error message so the same failure with different ids or numbers groups together. */
export const normaliseMessage = (s: string) => s.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<id>').replace(/\b0x[0-9a-f]+\b/gi, '<hex>').replace(/\d+/g, '<n>').trim().slice(0, 140)

export function analyzeLog(raw: string): LogReport {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const levels = new Map<string, number>(), statuses = new Map<string, number>(), ips = new Map<string, number>(), errors = new Map<string, number>(), paths = new Map<string, number>()
  const authFailures = new Map<string, number>()
  const stamps: string[] = []
  let recognised = 0

  for (const line of lines) {
    let hit = false
    let json: Record<string, unknown> | null = null
    if (line.trimStart().startsWith('{')) { try { json = JSON.parse(line) } catch { json = null } }
    const combined = COMBINED.exec(line)
    if (combined) {
      hit = true
      bump(ips, combined[1]); bump(statuses, combined[5]); bump(paths, combined[4].split('?')[0])
      if (/^[45]/.test(combined[5])) bump(errors, `${combined[5]} ${combined[3]} ${combined[4].split('?')[0]}`)
      if (combined[5] === '401' || combined[5] === '403') bump(authFailures, combined[1])
    }
    if (json) {
      hit = true
      const lvl = String(json.level ?? json.severity ?? '').toUpperCase()
      if (lvl) bump(levels, lvl.replace('WARNING', 'WARN'))
      const status = json.status ?? json.statusCode ?? json.status_code
      if (status != null) bump(statuses, String(status))
      const ip = String(json.ip ?? json.remote_addr ?? json.client_ip ?? '')
      if (IPV4.test(ip)) { bump(ips, ip); if (String(status) === '401' || String(status) === '403') bump(authFailures, ip) }
      const msg = String(json.msg ?? json.message ?? '')
      if (msg && /^(ERROR|ERR|FATAL|CRIT|CRITICAL|ALERT|EMERG)/.test(lvl)) bump(errors, normaliseMessage(msg))
      const ts = String(json.time ?? json.timestamp ?? json.ts ?? ''); if (TS.test(ts)) stamps.push(ts)
    } else {
      const lvl = LEVEL.exec(line)
      if (lvl) {
        hit = true
        const name = lvl[1].toUpperCase().replace('WARNING', 'WARN').replace(/^ERR$/, 'ERROR').replace('CRITICAL', 'CRIT')
        bump(levels, name)
        if (/^(ERROR|CRIT|FATAL|ALERT|EMERG)$/.test(name)) bump(errors, normaliseMessage(line.slice((lvl.index ?? 0) + lvl[0].length).replace(/^[\]:\s-]+/, '')))
      }
      if (!combined) { const ip = IPV4.exec(line); if (ip) bump(ips, ip[0]) }
      const t = TS.exec(line); if (t) stamps.push(t[1])
    }
    if (hit) recognised++
  }

  const flags: string[] = []
  for (const [ip, n] of authFailures) if (n >= 10) flags.push(`${ip} was refused (401/403) ${n} times: possible credential guessing.`)
  const errorTotal = (levels.get('ERROR') ?? 0) + (levels.get('FATAL') ?? 0) + (levels.get('CRIT') ?? 0)
  if (lines.length >= 20 && errorTotal / lines.length > 0.2) flags.push(`${Math.round((errorTotal / lines.length) * 100)}% of lines are errors.`)
  const serverErrors = [...statuses].filter(([s]) => s.startsWith('5')).reduce((n, [, c]) => n + c, 0)
  if (serverErrors >= 10) flags.push(`${serverErrors} server errors (5xx).`)

  stamps.sort()
  return {
    lines: lines.length, recognised,
    levels: Object.fromEntries(levels), statuses: Object.fromEntries(statuses),
    topIps: top(ips), topErrors: top(errors), topPaths: top(paths),
    first: stamps[0] ?? null, last: stamps[stamps.length - 1] ?? null, flags,
  }
}

/* ---- DNS over HTTPS --------------------------------------------------------------------------------------------------------- */

export const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'] as const
export type DnsType = (typeof DNS_TYPES)[number]
export interface DnsRecord { name: string; type: string; ttl: number; data: string }
export interface DnsResult { status: 'ok' | 'no-records' | 'not-found' | 'error'; records: DnsRecord[]; message?: string }

const TYPE_NUMBERS: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' }
const DOMAIN = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i

export function normaliseDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
  return DOMAIN.test(d) ? d : null
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** Ask a public DNS-over-HTTPS resolver. Only the domain name is sent; the browser never contacts the target itself. */
export async function lookupDns(domainRaw: string, type: DnsType, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<DnsResult> {
  const name = normaliseDomain(domainRaw)
  if (!name) return { status: 'error', records: [], message: 'Enter a domain such as example.com.' }
  try {
    const res = await fetchImpl(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } })
    if (!res.ok) return { status: 'error', records: [], message: `The resolver answered ${res.status}.` }
    const body = (await res.json()) as { Status?: number; Answer?: { name: string; type: number; TTL: number; data: string }[] }
    if (body.Status === 3) return { status: 'not-found', records: [], message: `${name} does not exist.` }
    if (body.Status !== 0) return { status: 'error', records: [], message: `The resolver returned status ${body.Status}.` }
    const records = (body.Answer ?? []).map((a) => ({ name: a.name.replace(/\.$/, ''), type: TYPE_NUMBERS[a.type] ?? String(a.type), ttl: a.TTL, data: a.data.replace(/^"|"$/g, '') }))
    return records.length ? { status: 'ok', records } : { status: 'no-records', records: [], message: `No ${type} records for ${name}.` }
  } catch {
    return { status: 'error', records: [], message: 'Could not reach the DNS resolver. Check your connection and try again.' }
  }
}

/** SPF and DMARC are the two TXT records that decide whether mail pretending to be you is accepted. */
export function emailAuthFindings(rootTxt: DnsRecord[], dmarcTxt: DnsRecord[]): Finding[] {
  const out: Finding[] = []
  const spf = rootTxt.find((r) => /^v=spf1\b/i.test(r.data))
  if (!spf) out.push({ id: 'spf', severity: 'fail', title: 'No SPF record', detail: 'Receivers cannot tell which servers may send mail for this domain.' })
  else if (/\+all\b/.test(spf.data) || /\s\?all\b/.test(spf.data)) out.push({ id: 'spf', severity: 'fail', title: 'SPF allows anyone', detail: spf.data })
  else if (/\s~all\b/.test(spf.data)) out.push({ id: 'spf', severity: 'warn', title: 'SPF uses soft-fail (~all)', detail: `${spf.data} Move to -all once you are sure every sender is listed.` })
  else out.push({ id: 'spf', severity: 'pass', title: 'SPF is set', detail: spf.data })
  const dmarc = dmarcTxt.find((r) => /^v=DMARC1\b/i.test(r.data))
  if (!dmarc) out.push({ id: 'dmarc', severity: 'fail', title: 'No DMARC record', detail: 'Add _dmarc.<domain> with at least p=none and a reporting address, then tighten to quarantine or reject.' })
  else {
    const policy = /\bp=(\w+)/i.exec(dmarc.data)?.[1]?.toLowerCase()
    out.push({ id: 'dmarc', severity: policy === 'none' ? 'warn' : 'pass', title: policy === 'none' ? 'DMARC is monitoring only (p=none)' : `DMARC policy: ${policy}`, detail: dmarc.data })
  }
  return out
}

/* ---- Configuration checklist -------------------------------------------------------------------------------------------------- */

export interface CheckItem { id: string; group: string; text: string }
export const CONFIG_CHECKLIST: CheckItem[] = [
  { id: 'auth-mfa', group: 'Accounts', text: 'Every Main Admin account uses multi-factor authentication.' },
  { id: 'auth-passwords', group: 'Accounts', text: 'No shared accounts; temporary passwords are changed on first sign-in.' },
  { id: 'auth-offboard', group: 'Accounts', text: 'Leavers lose access the day they leave, and their sessions end.' },
  { id: 'data-rls', group: 'Data', text: 'Row-level security is enabled on every table that holds company or client data.' },
  { id: 'data-service-role', group: 'Data', text: 'The service-role key exists only in server-side secrets, never in the browser bundle.' },
  { id: 'data-backups', group: 'Data', text: 'Backups run on schedule and a restore has been tested in the last quarter.' },
  { id: 'data-storage', group: 'Data', text: 'Storage buckets holding private files are private, with signed URLs only.' },
  { id: 'web-https', group: 'Web', text: 'Every public site is HTTPS-only with HSTS.' },
  { id: 'web-csp', group: 'Web', text: 'A Content-Security-Policy is enforced (not report-only) on the main app.' },
  { id: 'web-headers', group: 'Web', text: 'Security headers pass the header analysis (nosniff, framing, referrer policy).' },
  { id: 'web-cookies', group: 'Web', text: 'Session cookies are Secure, HttpOnly and SameSite.' },
  { id: 'web-cors', group: 'Web', text: 'CORS lists specific origins; no wildcard on endpoints that use credentials.' },
  { id: 'dev-secrets', group: 'Development', text: 'Secrets are not committed to repositories; secret scanning is on.' },
  { id: 'dev-deps', group: 'Development', text: 'Dependencies are scanned and updated on a regular schedule.' },
  { id: 'dev-review', group: 'Development', text: 'Production changes require a reviewed pull request.' },
  { id: 'ops-logging', group: 'Operations', text: 'Sign-ins, role changes and administrative actions are logged and reviewed.' },
  { id: 'ops-incident', group: 'Operations', text: 'An incident runbook exists and the team knows where it is.' },
  { id: 'ops-mail', group: 'Operations', text: 'SPF and DMARC are published for the company mail domain.' },
]
export type CheckResult = 'pass' | 'fail' | 'na'

/** Percent of applicable checks that pass. Not-applicable items do not count either way; no applicable items scores null. */
export function scoreChecklist(results: Record<string, CheckResult | undefined>): { score: number | null; passed: number; failed: number; unanswered: number } {
  let passed = 0, failed = 0, unanswered = 0
  for (const item of CONFIG_CHECKLIST) {
    const r = results[item.id]
    if (r === 'pass') passed++; else if (r === 'fail') failed++; else if (r !== 'na') unanswered++
  }
  const applicable = passed + failed
  return { score: applicable ? Math.round((passed / applicable) * 100) : null, passed, failed, unanswered }
}

export const TRAINING_LINKS: { name: string; url: string; about: string; level: string }[] = [
  { name: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', about: 'Free, structured web-security labs, run on PortSwigger\u2019s own servers.', level: 'Beginner to advanced' },
  { name: 'OWASP Juice Shop', url: 'https://owasp.org/www-project-juice-shop/', about: 'A deliberately vulnerable web app you run yourself, locally.', level: 'Beginner to intermediate' },
  { name: 'OWASP WebGoat', url: 'https://owasp.org/www-project-webgoat/', about: 'A guided, self-hosted vulnerable app for learning common flaws.', level: 'Beginner' },
  { name: 'TryHackMe', url: 'https://tryhackme.com', about: 'Guided rooms in a managed browser-based lab.', level: 'Beginner' },
  { name: 'Hack The Box Academy', url: 'https://academy.hackthebox.com', about: 'Role-based learning paths with hands-on modules.', level: 'Intermediate' },
  { name: 'OverTheWire Wargames', url: 'https://overthewire.org/wargames/', about: 'Command-line puzzles that teach Linux and security basics.', level: 'Beginner' },
  { name: 'picoCTF', url: 'https://picoctf.org', about: 'A beginner-friendly capture-the-flag with a permanent practice gym.', level: 'Beginner' },
]
