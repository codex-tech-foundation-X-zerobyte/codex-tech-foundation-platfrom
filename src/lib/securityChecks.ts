/**
 * Turns raw facts about the system into findings and a score. Pure functions (no network), so every rule is unit-tested.
 * "Raw facts" come from three places: the database (security_posture() RPC), the external providers (security-monitor Edge
 * Function), and this browser's own configuration.
 */
export type FindingStatus = 'ok' | 'info' | 'warn' | 'fail' | 'unavailable'
export interface Finding { id: string; title: string; status: FindingStatus; detail: string; fix?: string; link?: string }

export interface Posture {
  generated_at: string
  table_count: number
  policy_count: number
  tables_without_rls: string[]
  tables_rls_without_policies: string[]
  public_buckets: string[]
  private_buckets: string[]
  definer_functions_without_search_path: string[]
  accounts: { total: number; superadmins: number; workers: number; clients: number; suspended_workers: number; suspended_clients: number; must_change_password: number }
  activity: { failed_logins_24h: number; failed_logins_7d: number; warnings_24h: number; errors_24h: number; events_7d: number }
}

/** Buckets that are MEANT to be world-readable (team photos, blog images). Anything else being public is worth a look. */
const INTENDED_PUBLIC = new Set(['public-content'])
const list = (items: string[], max = 6) => items.slice(0, max).join(', ') + (items.length > max ? ` and ${items.length - max} more` : '')

export function evaluatePosture(p: Posture): Finding[] {
  const out: Finding[] = []

  out.push(p.tables_without_rls.length === 0
    ? { id: 'db-rls', title: 'Row Level Security is on for every table', status: 'ok', detail: `${p.table_count} tables, ${p.policy_count} policies.` }
    : { id: 'db-rls', title: `${p.tables_without_rls.length} table${p.tables_without_rls.length === 1 ? '' : 's'} without Row Level Security`, status: 'fail', detail: `${list(p.tables_without_rls)}. Anyone holding the public key can read or change these through the API.`, fix: p.tables_without_rls.slice(0, 3).map((t) => `alter table public.${t} enable row level security;`).join('\n') })

  if (p.tables_rls_without_policies.length) {
    out.push({ id: 'db-nopolicy', title: `${p.tables_rls_without_policies.length} table${p.tables_rls_without_policies.length === 1 ? ' is' : 's are'} locked to everyone`, status: 'info', detail: `${list(p.tables_rls_without_policies)} have RLS on but no policies, so only the server (service role) can use them. Fine for internal tables; a bug if the app is meant to read them.` })
  }

  const unexpectedPublic = p.public_buckets.filter((b) => !INTENDED_PUBLIC.has(b))
  out.push(unexpectedPublic.length
    ? { id: 'db-buckets', title: `${unexpectedPublic.length} unexpected public storage bucket${unexpectedPublic.length === 1 ? '' : 's'}`, status: 'warn', detail: `${list(unexpectedPublic)} — every file in a public bucket is readable by anyone with the link.`, fix: 'Make the bucket private unless its contents are meant to be public.' }
    : { id: 'db-buckets', title: 'Storage buckets are private', status: 'ok', detail: `${p.private_buckets.length} private${p.public_buckets.length ? `, ${p.public_buckets.length} intentionally public (${list(p.public_buckets)})` : ''}.` })

  out.push(p.definer_functions_without_search_path.length
    ? { id: 'db-definer', title: `${p.definer_functions_without_search_path.length} privileged function${p.definer_functions_without_search_path.length === 1 ? '' : 's'} without a pinned search_path`, status: 'warn', detail: `${list(p.definer_functions_without_search_path)}. A SECURITY DEFINER function that doesn't pin search_path can be tricked into running a look-alike object.`, fix: 'alter function public.<name>(...) set search_path = public;' }
    : { id: 'db-definer', title: 'Privileged functions pin their search_path', status: 'ok', detail: 'Every SECURITY DEFINER function is safe from search-path hijacking.' })

  const a = p.accounts
  out.push(a.superadmins === 0 ? { id: 'acct-admin', title: 'No administrator account exists', status: 'fail', detail: 'Nobody can manage roles, workers or security settings.' }
    : a.superadmins === 1 ? { id: 'acct-admin', title: 'Only one administrator', status: 'warn', detail: 'If that account is lost, locked or compromised there is no one else to recover or contain it.', fix: 'Add a second trusted administrator (and keep both protected by strong, unique passwords).' }
    : a.superadmins > 5 ? { id: 'acct-admin', title: `${a.superadmins} administrators`, status: 'warn', detail: 'Administrators can do anything. Keep the number as small as the job allows.', fix: 'Review the list and demote anyone who does not need full access.' }
    : { id: 'acct-admin', title: `${a.superadmins} administrators`, status: 'ok', detail: 'A sensible number: enough to recover from a lockout, few enough to audit.' })

  out.push(a.must_change_password > 0
    ? { id: 'acct-temp', title: `${a.must_change_password} account${a.must_change_password === 1 ? ' is' : 's are'} still on a temporary password`, status: 'warn', detail: 'Temporary passwords were shared with a person and should be replaced promptly.', fix: 'Remind those people to sign in and choose their own password.' }
    : { id: 'acct-temp', title: 'No temporary passwords outstanding', status: 'ok', detail: 'Everyone has set their own password.' })

  if (a.suspended_workers + a.suspended_clients > 0) {
    out.push({ id: 'acct-suspended', title: `${a.suspended_workers + a.suspended_clients} suspended or disabled account${a.suspended_workers + a.suspended_clients === 1 ? '' : 's'}`, status: 'info', detail: `${a.suspended_workers} team, ${a.suspended_clients} client. Suspended accounts cannot sign in; remove any you no longer need.` })
  }

  const f = p.activity
  out.push(f.failed_logins_24h >= 50 ? { id: 'act-logins', title: `${f.failed_logins_24h} failed sign-ins in 24 hours`, status: 'fail', detail: 'That volume looks like password guessing or credential stuffing.', fix: 'Check the audit log for repeated targets and consider suspending those accounts.' }
    : f.failed_logins_24h >= 10 ? { id: 'act-logins', title: `${f.failed_logins_24h} failed sign-ins in 24 hours`, status: 'warn', detail: `${f.failed_logins_7d} this week. A handful is normal; this is higher than usual.`, fix: 'Check the audit log for repeated targets.' }
    : { id: 'act-logins', title: f.failed_logins_24h === 0 ? 'No failed sign-ins in 24 hours' : `${f.failed_logins_24h} failed sign-in${f.failed_logins_24h === 1 ? '' : 's'} in 24 hours`, status: 'ok', detail: `${f.failed_logins_7d} in the last 7 days.` })

  if (f.errors_24h > 0 || f.warnings_24h > 0) {
    out.push({ id: 'act-flags', title: `${f.errors_24h} errors and ${f.warnings_24h} warnings logged in 24 hours`, status: f.errors_24h > 0 ? 'warn' : 'info', detail: 'See "Recent security events" below.' })
  }
  return out
}

/** What THIS browser can verify about how it is being served. */
export function evaluateBrowser(env: { protocol: string; supabaseUrl: string; secureContext: boolean; debugOn: boolean }): Finding[] {
  const out: Finding[] = []
  out.push(env.protocol === 'https:'
    ? { id: 'br-https', title: 'This page is served over HTTPS', status: 'ok', detail: 'Traffic between browser and server is encrypted.' }
    : { id: 'br-https', title: 'This page is NOT served over HTTPS', status: env.protocol === 'http:' && !env.secureContext ? 'fail' : 'info', detail: `Loaded over ${env.protocol}//. Fine on localhost, never in production.`, fix: 'Serve the production site over HTTPS only.' })
  out.push(env.supabaseUrl.startsWith('https://')
    ? { id: 'br-api', title: 'The database API uses HTTPS', status: 'ok', detail: new URL(env.supabaseUrl).host }
    : { id: 'br-api', title: 'The database API is not using HTTPS', status: env.supabaseUrl.includes('localhost') || env.supabaseUrl.includes('127.0.0.1') ? 'info' : 'fail', detail: env.supabaseUrl, fix: 'Point VITE_SUPABASE_URL at the https:// project URL.' })
  out.push({ id: 'br-key', title: 'No service key in the browser build', status: 'ok', detail: 'The app refuses to build or run with a secret key in a VITE_ variable.' })
  if (env.debugOn) out.push({ id: 'br-debug', title: 'Verbose error logging is on in this browser', status: 'info', detail: 'localStorage "ctf:debug" is set, so database error details are printed to the console.', fix: 'localStorage.removeItem("ctf:debug")' })
  return out
}

const PENALTY: Record<FindingStatus, number> = { fail: 15, warn: 5, info: 0, ok: 0, unavailable: 0 }

/** 100 minus 15 per failure and 5 per warning. "Unavailable" checks are not guessed at: they don't count for or against. */
export function scoreFindings(findings: Finding[]): { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; counts: Record<FindingStatus, number> } {
  const counts: Record<FindingStatus, number> = { ok: 0, info: 0, warn: 0, fail: 0, unavailable: 0 }
  let score = 100
  for (const f of findings) { counts[f.status] += 1; score -= PENALTY[f.status] }
  score = Math.max(0, score)
  return { score, grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F', counts }
}

/** What the security-monitor Edge Function returns for one external service. */
export interface ProviderReport {
  provider: 'github' | 'vercel' | 'headers'
  label: string
  configured: boolean
  findings: Finding[]
  setup?: string
}

/** Everything that needs a person's attention, worst first. Passing, informational and unavailable checks are left out. */
export function attentionList<T extends Finding>(findings: T[]): T[] {
  const rank: Record<FindingStatus, number> = { fail: 0, warn: 1, info: 2, ok: 3, unavailable: 4 }
  return findings.filter((f) => f.status === 'fail' || f.status === 'warn').sort((a, b) => rank[a.status] - rank[b.status])
}
