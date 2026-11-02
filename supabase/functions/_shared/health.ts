/*
  Connection check for the GitHub App and Vercel, as pure code (tested under Node in tests/health.test.mjs). The edge function does the
  network and database calls and hands the raw answers to these functions, which turn them into plain-language findings.

  Rules: a finding never contains a secret or any part of one (only whether it is set); every failed or warning finding says what to do next;
  a check that could not run is "skipped" with the reason, never "ok".
*/
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'
export interface Check { id: string; group: 'server' | 'github' | 'database' | 'vercel'; label: string; status: CheckStatus; detail: string }
const mk = (group: Check['group'], id: string, label: string, status: CheckStatus, detail: string): Check => ({ id, group, label, status, detail })

/** A check that could not run, with the reason. Never counted as healthy or broken. */
export const skippedCheck = (group: Check['group'], id: string, label: string, detail: string): Check => mk(group, id, label, 'skipped', detail)

/** What the Workspace needs from the App for everything built so far. Read-only baseline, then the two write permissions (slice 3). */
export const READ_PERMISSIONS: Record<string, string> = { metadata: 'read', contents: 'read', issues: 'read', pull_requests: 'read', actions: 'read', deployments: 'read', checks: 'read' }
export const WRITE_PERMISSIONS: Record<string, string> = { issues: 'write', pull_requests: 'write' }
export const REQUIRED_EVENTS = ['push', 'pull_request', 'pull_request_review', 'issues', 'workflow_run', 'deployment_status']

const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 }
const pretty = (k: string) => k.replace(/_/g, ' ')
const clean = (h: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (h && typeof h === 'object' && !Array.isArray(h)) for (const [k, v] of Object.entries(h as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

/** Which of the needed permissions are absent, or granted at a lower level than needed. A higher level than needed counts as met. */
export function missingPermissions(have: unknown, need: Record<string, string>): string[] {
  const h = clean(have)
  return Object.entries(need).filter(([k, level]) => (RANK[h[k]] ?? 0) < (RANK[level] ?? 99)).map(([k, level]) => `${pretty(k)} (${level})`)
}

export function secretChecks(env: { appId: boolean; privateKey: boolean; privateKeyUsable: boolean | null; webhookSecret: string | null | undefined; vercelToken: boolean }): Check[] {
  const out: Check[] = []
  out.push(env.appId ? mk('server', 'secret-app-id', 'GITHUB_APP_ID', 'ok', 'Set.') : mk('server', 'secret-app-id', 'GITHUB_APP_ID', 'fail', 'Not set. Add the App ID (the number at the top of the App\u2019s settings page) as an Edge Function secret.'))
  if (!env.privateKey) out.push(mk('server', 'secret-key', 'GITHUB_APP_PRIVATE_KEY', 'fail', 'Not set. Generate a private key in the App\u2019s settings and add the whole .pem text as an Edge Function secret.'))
  else if (env.privateKeyUsable === false) out.push(mk('server', 'secret-key', 'GITHUB_APP_PRIVATE_KEY', 'fail', 'Set, but it is not a usable private key. Paste the complete .pem text, including the BEGIN and END lines.'))
  else out.push(mk('server', 'secret-key', 'GITHUB_APP_PRIVATE_KEY', 'ok', 'Set and readable.'))
  const w = env.webhookSecret
  out.push(!w ? mk('server', 'secret-webhook', 'GITHUB_WEBHOOK_SECRET', 'fail', 'Not set. Without it every GitHub delivery is refused. Add the same secret you gave GitHub.')
    : w.length < 16 ? mk('server', 'secret-webhook', 'GITHUB_WEBHOOK_SECRET', 'fail', 'Set, but shorter than 16 characters, so the receiver refuses to use it. Choose a longer secret and update it in both GitHub and Supabase.')
    : mk('server', 'secret-webhook', 'GITHUB_WEBHOOK_SECRET', 'ok', 'Set.'))
  out.push(env.vercelToken ? mk('server', 'secret-vercel', 'VERCEL_TOKEN', 'ok', 'Set.') : mk('server', 'secret-vercel', 'VERCEL_TOKEN', 'warn', 'Not set. Only needed if you want the Deployments tab.'))
  return out
}

/** The App itself: what it asks GitHub for. Read-only baseline is required; the write permissions are optional and reported as such. */
export function appChecks(app: { permissions?: unknown; events?: unknown; name?: unknown } | null, error: string | null): Check[] {
  if (!app) return [mk('github', 'app', 'GitHub App sign-in', 'fail', error ?? 'GitHub did not accept the App\u2019s credentials. Check the App ID and the private key belong to the same App.')]
  const out: Check[] = [mk('github', 'app', 'GitHub App sign-in', 'ok', `Signed in as the App${typeof app.name === 'string' && app.name ? ` \u201c${app.name.slice(0, 80)}\u201d` : ''}.`)]
  const missing = missingPermissions(app.permissions, READ_PERMISSIONS)
  out.push(missing.length === 0 ? mk('github', 'app-read', 'App permissions (read)', 'ok', 'The App asks for everything the Workspace reads.')
    : mk('github', 'app-read', 'App permissions (read)', 'fail', `The App is missing: ${missing.join(', ')}. In the App\u2019s settings, under Repository permissions, set each to Read-only. Features that need them will not work until then.`))
  const noWrite = missingPermissions(app.permissions, WRITE_PERMISSIONS)
  out.push(noWrite.length === 0 ? mk('github', 'app-write', 'App permissions (write)', 'ok', 'The App is allowed to write issues and pull request comments. Whether people may is decided per repository in Integrations.')
    : mk('github', 'app-write', 'App permissions (write)', 'skipped', 'The App is read-only, so commenting and creating issues from the Workspace will be refused by GitHub. That is fine if you do not want writing. To allow it, set Issues and Pull requests to Read & write in the App\u2019s settings.'))
  const events = Array.isArray(app.events) ? app.events.filter((e): e is string => typeof e === 'string') : []
  const lacking = REQUIRED_EVENTS.filter((e) => !events.includes(e))
  out.push(lacking.length === 0 ? mk('github', 'app-events', 'App webhook events', 'ok', 'The App is subscribed to every event the activity feed uses.')
    : mk('github', 'app-events', 'App webhook events', 'warn', `Not subscribed to: ${lacking.map(pretty).join(', ')}. The activity feed will miss these. Tick them under Subscribe to events in the App\u2019s settings.`))
  return out
}

/** The installation actually chosen in Integrations: can a token be made, and did the organisation accept the permissions? */
export function installationChecks(input: { selected: boolean; minted: { permissions?: Record<string, string> } | null; error: string | null; reposReadable: boolean | null; appPermissions: unknown }): Check[] {
  if (!input.selected) return [mk('github', 'installation', 'Installation', 'skipped', 'No installation is selected yet. In Integrations, press \u201cUse this installation\u201d once GitHub has reported one.')]
  if (!input.minted) return [mk('github', 'installation', 'Installation', 'fail', input.error ?? 'A token could not be made for the selected installation. It may have been removed or suspended.')]
  const out: Check[] = [mk('github', 'installation', 'Installation', 'ok', 'A token was made for the selected installation.')]
  out.push(input.reposReadable === true ? mk('github', 'installation-repos', 'Repository access', 'ok', 'GitHub lists the repositories this installation can reach.')
    : input.reposReadable === false ? mk('github', 'installation-repos', 'Repository access', 'fail', 'The installation token could not list repositories. Check the App is installed on the right organisation.')
    : mk('github', 'installation-repos', 'Repository access', 'skipped', 'Not checked.'))
  const lag = missingPermissions(input.minted.permissions, READ_PERMISSIONS)
  const appLacks = missingPermissions(input.appPermissions, READ_PERMISSIONS)
  const newlyMissing = lag.filter((x) => !appLacks.includes(x))
  out.push(lag.length === 0 ? mk('github', 'installation-perms', 'Permissions granted to the installation', 'ok', 'The organisation has granted every read permission.')
    : newlyMissing.length > 0 ? mk('github', 'installation-perms', 'Permissions granted to the installation', 'warn', `The App asks for ${newlyMissing.join(', ')} but the organisation has not accepted it yet. An organisation owner must approve the update (GitHub emails them, or see the installation\u2019s page in GitHub).`)
    : mk('github', 'installation-perms', 'Permissions granted to the installation', 'fail', `Not granted: ${lag.join(', ')}. Fix the App\u2019s permissions first (see above).`))
  return out
}

export interface HookDelivery { delivered_at?: unknown; status_code?: unknown; status?: unknown; event?: unknown }

/** What GitHub saw when it called the receiver. A refused (401) delivery leaves no trace in our database by design, so GitHub's own log is the only place to see it. */
export function deliveryCheck(list: HookDelivery[] | null, error: string | null, now: number): Check {
  if (!list) return mk('github', 'webhook', 'Webhook deliveries', 'skipped', error ?? 'Not checked.')
  if (list.length === 0) return mk('github', 'webhook', 'Webhook deliveries', 'warn', 'GitHub has not sent any deliveries yet. In the App\u2019s settings make sure the webhook is Active and the URL ends in /functions/v1/github-webhook, then make a change in a repository (or use Redeliver on the Advanced tab).')
  const codes = list.map((d) => (typeof d.status_code === 'number' ? d.status_code : 0))
  const ok = codes.filter((c) => c >= 200 && c < 300).length
  const latest = list[0]
  const ageMs = Date.parse(String(latest.delivered_at ?? '')) ? now - Date.parse(String(latest.delivered_at)) : NaN
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  const when = Number.isFinite(ageMs) && ageMs >= 0 ? (ageMs < 3_600_000 ? unit(Math.max(1, Math.round(ageMs / 60_000)), 'minute') : ageMs < 86_400_000 ? unit(Math.round(ageMs / 3_600_000), 'hour') : unit(Math.round(ageMs / 86_400_000), 'day')) : 'at an unknown time'
  if (ok === codes.length) return mk('github', 'webhook', 'Webhook deliveries', 'ok', `${codes.length === 1 ? 'The last delivery succeeded' : `The last ${codes.length} deliveries all succeeded`}. Most recent: ${when}.`)
  const worst = codes.find((c) => !(c >= 200 && c < 300)) ?? 0
  const why = worst === 401 ? 'The receiver refused the signature: GITHUB_WEBHOOK_SECRET in Supabase does not match the secret in the App\u2019s webhook settings. Set both to the same value.'
    : worst === 404 ? 'GitHub got \u201cnot found\u201d: the webhook URL is wrong, or the github-webhook function is not deployed.'
    : worst === 503 ? 'The receiver says the webhook secret is not set on the server (GITHUB_WEBHOOK_SECRET).'
    : worst === 413 ? 'The receiver refused a payload as too large.'
    : worst >= 500 ? 'The receiver failed on GitHub\u2019s delivery. Check the github-webhook function logs, and that the migrations have been run.'
    : 'GitHub could not reach the receiver (timeout or connection problem). Check the webhook URL.'
  if (ok === 0) return mk('github', 'webhook', 'Webhook deliveries', 'fail', `${codes.length === 1 ? 'The last delivery did not succeed' : `None of the last ${codes.length} deliveries succeeded`} (status ${worst || 'none'}). ${why}`)
  const latestOk = codes[0] >= 200 && codes[0] < 300
  return mk('github', 'webhook', 'Webhook deliveries', latestOk ? 'warn' : 'fail', `${ok} of the last ${codes.length} deliveries succeeded; the most recent ${latestOk ? 'did' : 'did not'} (${when}). ${why}`)
}

export const REQUIRED_TABLES: { table: string; migration: string }[] = [
  { table: 'github_installations', migration: '20261006000000_github_app_and_activity.sql' },
  { table: 'github_webhook_deliveries', migration: '20261006000000_github_app_and_activity.sql' },
  { table: 'github_activity', migration: '20261006000000_github_app_and_activity.sql' },
  { table: 'github_repo_policy', migration: '20261007000000_github_write_access.sql' },
  { table: 'github_actions', migration: '20261007000000_github_write_access.sql' },
  { table: 'deployment_targets', migration: '20261008000000_deployment_targets.sql' },
]
/** Which migration files have not been run, judged from whether their tables answer. */
export function databaseChecks(probes: Record<string, boolean>): Check[] {
  const missing = REQUIRED_TABLES.filter((t) => probes[t.table] !== true)
  if (missing.length === 0) return [mk('database', 'migrations', 'Database migrations', 'ok', 'Every GitHub table is present.')]
  const files = [...new Set(missing.map((m) => m.migration))]
  return [mk('database', 'migrations', 'Database migrations', 'fail', `Not found: ${missing.map((m) => m.table).join(', ')}. Run in the SQL editor: ${files.join(', ')}.`)]
}

export function vercelChecks(input: { tokenSet: boolean; targets: { repo: string; ok: boolean; message: string }[] }): Check[] {
  if (input.targets.length === 0) return [mk('vercel', 'vercel', 'Vercel deployments', 'skipped', input.tokenSet ? 'No repository is connected to a Vercel project yet.' : 'Vercel is not set up (optional).')]
  if (!input.tokenSet) return [mk('vercel', 'vercel', 'Vercel deployments', 'fail', 'Repositories are connected to Vercel projects but VERCEL_TOKEN is not set on the server.')]
  return input.targets.map((t) => mk('vercel', `vercel-${t.repo}`, `Vercel project for ${t.repo}`, t.ok ? 'ok' : 'fail', t.ok ? 'Vercel answered for this project.' : t.message))
}

export function overall(checks: Check[]): { status: 'ok' | 'warn' | 'fail'; failed: number; warned: number } {
  const failed = checks.filter((c) => c.status === 'fail').length
  const warned = checks.filter((c) => c.status === 'warn').length
  return { status: failed > 0 ? 'fail' : warned > 0 ? 'warn' : 'ok', failed, warned }
}
