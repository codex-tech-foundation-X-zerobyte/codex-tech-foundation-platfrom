/**
 * Read-only security checks against external services, for the Security monitor.
 *
 * Runs inside the `security-monitor` Edge Function (Deno) — tokens live in Edge Function secrets, never in the browser — and is
 * written against plain `fetch` so it can be unit-tested in Node with a fake. Design rules:
 *   - READ-ONLY: only GET requests. Nothing here can change a repository, a deployment or a setting.
 *   - NEVER THROWS: a missing scope, a disabled feature or a network error becomes a finding ("unavailable"), not a 500.
 *   - NEVER ECHOES SECRETS: errors are reduced to a status code and GitHub/Vercel's own public message.
 */
export type FindingStatus = 'ok' | 'info' | 'warn' | 'fail' | 'unavailable'

export interface Finding {
  id: string
  title: string
  status: FindingStatus
  detail: string
  /** What to do about it. */
  fix?: string
  link?: string
}

export interface ProviderReport {
  provider: 'github' | 'vercel' | 'headers'
  label: string
  configured: boolean
  findings: Finding[]
  /** When not configured: exactly what to set. */
  setup?: string
}

type Fetch = typeof fetch
const TIMEOUT_MS = 8000

async function request(fetchImpl: Fetch, url: string, headers: Record<string, string>, method: 'GET' | 'HEAD' = 'GET') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { method, headers, signal: controller.signal, redirect: 'manual' })
    let body: unknown = null
    if (method === 'GET') { try { body = await res.json() } catch { /* not JSON */ } }
    return { ok: res.ok, status: res.status, body, headers: res.headers, networkError: null as string | null }
  } catch (e) {
    return { ok: false, status: 0, body: null, headers: new Headers(), networkError: (e as Error)?.name === 'AbortError' ? 'timed out' : 'could not connect' }
  } finally {
    clearTimeout(timer)
  }
}

const messageOf = (body: unknown): string => {
  const m = (body as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m.slice(0, 160) : ''
}

// ───────────────────────────── GitHub ─────────────────────────────
export interface GithubConfig { token?: string; repository?: string }

const GITHUB_SETUP =
  'Create a fine-grained token on the repository with READ access to: Metadata, Dependabot alerts, Secret scanning alerts, Code scanning alerts, Administration (to read branch protection) and Actions. Then run:\n' +
  'supabase secrets set GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner>/<repo>\n' +
  'supabase functions deploy security-monitor'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'moderate', 'low'] as const
const tally = (levels: string[]) => {
  const counts: Record<string, number> = {}
  for (const l of levels) { const k = l === 'moderate' ? 'medium' : (l || 'unknown'); counts[k] = (counts[k] ?? 0) + 1 }
  return counts
}
const describeCounts = (c: Record<string, number>) => SEVERITY_ORDER.filter((s) => s !== 'moderate' && c[s]).map((s) => `${c[s]} ${s}`).join(', ') + (c.unknown ? `${Object.keys(c).length > 1 ? ', ' : ''}${c.unknown} unrated` : '')

export async function checkGithub(config: GithubConfig, fetchImpl: Fetch = fetch): Promise<ProviderReport> {
  const base: ProviderReport = { provider: 'github', label: 'GitHub', configured: false, findings: [] }
  if (!config.token || !config.repository) return { ...base, setup: GITHUB_SETUP }
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository)) {
    return { ...base, configured: true, findings: [{ id: 'gh-config', title: 'Repository setting is invalid', status: 'fail', detail: 'GITHUB_REPOSITORY must look like "owner/repo".', fix: 'supabase secrets set GITHUB_REPOSITORY=owner/repo' }] }
  }

  const repo = config.repository
  const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-security-monitor' }
  const gh = (path: string) => request(fetchImpl, `https://api.github.com/repos/${repo}${path}`, headers)
  const web = `https://github.com/${repo}`

  const meta = await gh('')
  if (meta.networkError) return { ...base, configured: true, findings: [{ id: 'gh-reach', title: 'Could not reach GitHub', status: 'unavailable', detail: `The request ${meta.networkError}.` }] }
  if (meta.status === 401) return { ...base, configured: true, findings: [{ id: 'gh-auth', title: 'GitHub rejected the token', status: 'fail', detail: 'The token is invalid or expired.', fix: 'Create a new token and run: supabase secrets set GITHUB_TOKEN=<token>' }] }
  if (meta.status === 404 || meta.status === 403) return { ...base, configured: true, findings: [{ id: 'gh-repo', title: `No access to ${repo}`, status: 'fail', detail: `GitHub answered ${meta.status}: ${messageOf(meta.body) || 'the token cannot see this repository'}.`, fix: 'Check the owner/repo name, and that the token was granted access to this repository.' }] }

  const repoInfo = (meta.body ?? {}) as { default_branch?: string; private?: boolean; security_and_analysis?: Record<string, { status?: string } | undefined> }
  const branch = repoInfo.default_branch ?? 'main'
  const [dependabot, secrets, code, protection, runs] = await Promise.all([
    gh('/dependabot/alerts?state=open&per_page=100'),
    gh('/secret-scanning/alerts?state=open&per_page=100'),
    gh('/code-scanning/alerts?state=open&per_page=100'),
    gh(`/branches/${encodeURIComponent(branch)}/protection`),
    gh(`/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`),
  ])

  const findings: Finding[] = []
  const unavailable = (id: string, title: string, r: { status: number; body: unknown }, fix: string): Finding =>
    ({ id, title, status: 'unavailable', detail: `GitHub answered ${r.status}${messageOf(r.body) ? `: ${messageOf(r.body)}` : ''}.`, fix })

  // Dependabot alerts (known-vulnerable dependencies)
  if (dependabot.ok && Array.isArray(dependabot.body)) {
    const alerts = dependabot.body as { security_advisory?: { severity?: string }; security_vulnerability?: { severity?: string } }[]
    const counts = tally(alerts.map((a) => a.security_advisory?.severity ?? a.security_vulnerability?.severity ?? ''))
    const worst = (counts.critical ?? 0) + (counts.high ?? 0)
    findings.push(alerts.length === 0
      ? { id: 'gh-dependabot', title: 'No open dependency vulnerabilities', status: 'ok', detail: 'Dependabot reports no open alerts.', link: `${web}/security/dependabot` }
      : { id: 'gh-dependabot', title: `${alerts.length}${alerts.length >= 100 ? '+' : ''} open dependency vulnerabilit${alerts.length === 1 ? 'y' : 'ies'}`, status: worst > 0 ? 'fail' : 'warn', detail: describeCounts(counts), fix: 'Review and merge the Dependabot pull requests, or update the affected packages.', link: `${web}/security/dependabot` })
  } else if (dependabot.status === 403 && /disabled/i.test(messageOf(dependabot.body))) {
    findings.push({ id: 'gh-dependabot', title: 'Dependabot alerts are turned off', status: 'warn', detail: 'You will not be told when a dependency has a known vulnerability.', fix: 'Repository Settings → Code security → enable Dependabot alerts.', link: `${web}/settings/security_analysis` })
  } else findings.push(unavailable('gh-dependabot', 'Dependabot alerts', dependabot, 'Grant the token "Dependabot alerts: read".'))

  // Secret scanning (credentials committed to the repo)
  if (secrets.ok && Array.isArray(secrets.body)) {
    const n = (secrets.body as unknown[]).length
    findings.push(n === 0
      ? { id: 'gh-secrets', title: 'No leaked secrets detected', status: 'ok', detail: 'Secret scanning has no open alerts.', link: `${web}/security/secret-scanning` }
      : { id: 'gh-secrets', title: `${n}${n >= 100 ? '+' : ''} secret${n === 1 ? '' : 's'} found in the repository`, status: 'fail', detail: 'A credential appears in your code or history. Treat it as compromised.', fix: 'Rotate each exposed credential FIRST, then close the alert. Removing it from the code does not un-leak it.', link: `${web}/security/secret-scanning` })
  } else if ((secrets.status === 404 || secrets.status === 403) && /disabled|not enabled/i.test(messageOf(secrets.body))) {
    findings.push({ id: 'gh-secrets', title: 'Secret scanning is turned off', status: 'warn', detail: 'Committed credentials would go unnoticed.', fix: 'Repository Settings → Code security → enable Secret scanning and Push protection.', link: `${web}/settings/security_analysis` })
  } else findings.push(unavailable('gh-secrets', 'Secret scanning', secrets, 'Grant the token "Secret scanning alerts: read" (and make sure the feature is enabled).'))

  // Code scanning (static analysis)
  if (code.ok && Array.isArray(code.body)) {
    const alerts = code.body as { rule?: { security_severity_level?: string | null; severity?: string } }[]
    const counts = tally(alerts.map((a) => a.rule?.security_severity_level ?? a.rule?.severity ?? ''))
    const worst = (counts.critical ?? 0) + (counts.high ?? 0)
    findings.push(alerts.length === 0
      ? { id: 'gh-code', title: 'No open code-scanning alerts', status: 'ok', detail: 'Static analysis found nothing open.', link: `${web}/security/code-scanning` }
      : { id: 'gh-code', title: `${alerts.length}${alerts.length >= 100 ? '+' : ''} open code-scanning alert${alerts.length === 1 ? '' : 's'}`, status: worst > 0 ? 'fail' : 'warn', detail: describeCounts(counts), fix: 'Open the alerts and fix or dismiss each with a reason.', link: `${web}/security/code-scanning` })
  } else if (code.status === 404 && /no analysis found|not enabled|disabled/i.test(messageOf(code.body))) {
    findings.push({ id: 'gh-code', title: 'Code scanning is not set up', status: 'info', detail: 'No static analysis has run on this repository.', fix: 'Repository → Security → Code scanning → set up CodeQL (free for public repositories).', link: `${web}/security/code-scanning` })
  } else findings.push(unavailable('gh-code', 'Code scanning', code, 'Grant the token "Code scanning alerts: read".'))

  // Branch protection on the default branch
  if (protection.ok) {
    const p = protection.body as { required_pull_request_reviews?: unknown; required_status_checks?: unknown; allow_force_pushes?: { enabled?: boolean } }
    const gaps = [!p.required_pull_request_reviews && 'no required reviews', !p.required_status_checks && 'no required status checks', p.allow_force_pushes?.enabled && 'force pushes allowed'].filter(Boolean)
    findings.push(gaps.length === 0
      ? { id: 'gh-protection', title: `\`${branch}\` is protected`, status: 'ok', detail: 'Reviews and status checks are required, and force pushes are blocked.', link: `${web}/settings/branches` }
      : { id: 'gh-protection', title: `\`${branch}\` protection has gaps`, status: 'warn', detail: gaps.join(', '), fix: 'Tighten the branch protection rule so unreviewed code cannot reach production.', link: `${web}/settings/branches` })
  } else if (protection.status === 404 && /not protected/i.test(messageOf(protection.body))) {
    findings.push({ id: 'gh-protection', title: `\`${branch}\` is not protected`, status: 'warn', detail: 'Anyone with write access can push straight to production code.', fix: 'Repository Settings → Branches → add a rule requiring pull-request reviews.', link: `${web}/settings/branches` })
  } else findings.push(unavailable('gh-protection', 'Branch protection', protection, 'Grant the token "Administration: read".'))

  // CI health on the default branch
  if (runs.ok) {
    const list = ((runs.body as { workflow_runs?: { conclusion: string | null; name?: string; html_url?: string; updated_at?: string }[] })?.workflow_runs ?? []).filter((r) => r.conclusion)
    const latest = list[0]
    findings.push(!latest
      ? { id: 'gh-ci', title: 'No recent CI runs', status: 'info', detail: `No completed workflow runs on \`${branch}\`.`, fix: 'Add a GitHub Actions workflow that type-checks, lints and tests on every push.' }
      : latest.conclusion === 'success'
        ? { id: 'gh-ci', title: 'Latest CI run passed', status: 'ok', detail: `${latest.name ?? 'Workflow'} succeeded on \`${branch}\`.`, link: latest.html_url }
        : { id: 'gh-ci', title: 'Latest CI run did not pass', status: 'warn', detail: `${latest.name ?? 'Workflow'} finished as "${latest.conclusion}" on \`${branch}\`.`, fix: 'Open the run and fix it before deploying.', link: latest.html_url })
  } else findings.push(unavailable('gh-ci', 'CI status', runs, 'Grant the token "Actions: read".'))

  // Repo-level toggles (only visible to tokens with admin rights)
  const sa = repoInfo.security_and_analysis
  if (sa?.secret_scanning_push_protection?.status === 'disabled') {
    findings.push({ id: 'gh-pushprotect', title: 'Push protection is off', status: 'warn', detail: 'Pushes containing credentials are not blocked.', fix: 'Repository Settings → Code security → enable Push protection.', link: `${web}/settings/security_analysis` })
  }
  return { ...base, configured: true, findings }
}

// ───────────────────────────── Vercel ─────────────────────────────
export interface VercelConfig { token?: string; projectId?: string; teamId?: string }
const VERCEL_SETUP = 'Create a token at vercel.com/account/tokens, then run:\nsupabase secrets set VERCEL_TOKEN=<token> VERCEL_PROJECT_ID=<project id> [VERCEL_TEAM_ID=<team id>]\nsupabase functions deploy security-monitor'

export async function checkVercel(config: VercelConfig, fetchImpl: Fetch = fetch): Promise<ProviderReport> {
  const base: ProviderReport = { provider: 'vercel', label: 'Vercel', configured: false, findings: [] }
  if (!config.token || !config.projectId) return { ...base, setup: VERCEL_SETUP }
  const qs = new URLSearchParams({ projectId: config.projectId, limit: '10', target: 'production' })
  if (config.teamId) qs.set('teamId', config.teamId)
  const r = await request(fetchImpl, `https://api.vercel.com/v6/deployments?${qs}`, { Authorization: `Bearer ${config.token}` })
  if (r.networkError) return { ...base, configured: true, findings: [{ id: 'vc-reach', title: 'Could not reach Vercel', status: 'unavailable', detail: `The request ${r.networkError}.` }] }
  if (r.status === 401 || r.status === 403) return { ...base, configured: true, findings: [{ id: 'vc-auth', title: 'Vercel rejected the token', status: 'fail', detail: 'The token is invalid, expired, or has no access to this project/team.', fix: 'Create a new token and run: supabase secrets set VERCEL_TOKEN=<token>' }] }
  if (!r.ok) return { ...base, configured: true, findings: [{ id: 'vc-err', title: 'Vercel returned an error', status: 'unavailable', detail: `Vercel answered ${r.status}${messageOf((r.body as { error?: unknown })?.error ?? r.body) ? `: ${messageOf((r.body as { error?: unknown })?.error ?? r.body)}` : ''}.` }] }

  const deployments = ((r.body as { deployments?: { state?: string; readyState?: string; created?: number; url?: string }[] })?.deployments ?? [])
  const latest = deployments[0]
  const state = latest?.state ?? latest?.readyState
  const when = latest?.created ? new Date(latest.created).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown time'
  const findings: Finding[] = [
    !latest ? { id: 'vc-deploy', title: 'No production deployments found', status: 'info', detail: 'Vercel has no production deployments for this project.' }
      : state === 'READY' ? { id: 'vc-deploy', title: 'Production deployment is live', status: 'ok', detail: `Latest production deployment is READY (${when}).` }
      : state === 'ERROR' || state === 'CANCELED' ? { id: 'vc-deploy', title: 'Latest production deployment failed', status: 'fail', detail: `State: ${state} (${when}). The site may be running an older build.`, fix: 'Open the deployment in Vercel and check the build log.' }
      : { id: 'vc-deploy', title: 'A deployment is in progress', status: 'info', detail: `State: ${state ?? 'unknown'} (${when}).` },
  ]
  const recentFailures = deployments.slice(0, 5).filter((d) => (d.state ?? d.readyState) === 'ERROR').length
  if (recentFailures >= 3) findings.push({ id: 'vc-flaky', title: 'Repeated failed deployments', status: 'warn', detail: `${recentFailures} of the last 5 production deployments failed.`, fix: 'Fix the build before it hides a real problem.' })
  return { ...base, configured: true, findings }
}

// ───────────────────────────── Site security headers ─────────────────────────────
export async function checkSecurityHeaders(siteUrl: string | undefined, fetchImpl: Fetch = fetch): Promise<ProviderReport> {
  const base: ProviderReport = { provider: 'headers', label: 'Website headers', configured: false, findings: [] }
  let url: URL
  try { url = new URL(siteUrl ?? '') } catch { return { ...base, setup: 'Set the public address of the site, then redeploy the function:\nsupabase secrets set SITE_URL=https://your-domain.com\nsupabase functions deploy security-monitor' } }
  if (url.protocol !== 'https:') {
    return { ...base, configured: true, findings: [{ id: 'hdr-https', title: 'The site is not served over HTTPS', status: 'fail', detail: `${url.protocol}// is unencrypted: logins and data can be read in transit.`, fix: 'Serve the site over HTTPS only.' }] }
  }
  const r = await request(fetchImpl, url.href, { 'User-Agent': 'codex-security-monitor' }, 'HEAD')
  if (r.networkError) return { ...base, configured: true, findings: [{ id: 'hdr-reach', title: 'Could not reach the site', status: 'unavailable', detail: `The request ${r.networkError}.` }] }

  const h = (name: string) => r.headers.get(name)
  const csp = h('content-security-policy')
  const cspRo = h('content-security-policy-report-only')
  const hsts = h('strict-transport-security')
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? '')?.[1] ?? 0)
  const fix = 'Add it in vercel.json under "headers".'
  const findings: Finding[] = [
    { id: 'hdr-https', title: 'Served over HTTPS', status: 'ok', detail: url.origin },
    !hsts ? { id: 'hdr-hsts', title: 'No Strict-Transport-Security', status: 'warn', detail: 'Browsers may still try plain HTTP first.', fix }
      : maxAge < 15552000 ? { id: 'hdr-hsts', title: 'HSTS lifetime is short', status: 'warn', detail: `max-age=${maxAge}; six months (15552000) or more is recommended.`, fix }
      : { id: 'hdr-hsts', title: 'Strict-Transport-Security is set', status: 'ok', detail: `max-age=${maxAge}` },
    csp ? { id: 'hdr-csp', title: 'Content-Security-Policy is enforced', status: 'ok', detail: 'The browser blocks scripts and resources outside the policy.' }
      : cspRo ? { id: 'hdr-csp', title: 'Content-Security-Policy is report-only', status: 'info', detail: 'The policy is being tested but not enforced.', fix: 'When the browser console shows no violations, rename Content-Security-Policy-Report-Only to Content-Security-Policy.' }
      : { id: 'hdr-csp', title: 'No Content-Security-Policy', status: 'warn', detail: 'Nothing limits what a cross-site-scripting bug could load or send.', fix },
    /nosniff/i.test(h('x-content-type-options') ?? '') ? { id: 'hdr-nosniff', title: 'X-Content-Type-Options: nosniff', status: 'ok', detail: 'Browsers will not guess file types.' }
      : { id: 'hdr-nosniff', title: 'Missing X-Content-Type-Options', status: 'warn', detail: 'Browsers may reinterpret uploaded files as scripts.', fix },
    h('x-frame-options') || /frame-ancestors/i.test(csp ?? cspRo ?? '') ? { id: 'hdr-frame', title: 'Clickjacking protection is set', status: 'ok', detail: 'The site cannot be framed by other sites.' }
      : { id: 'hdr-frame', title: 'Can be embedded in other sites', status: 'warn', detail: 'Missing X-Frame-Options / frame-ancestors: clickjacking is possible.', fix },
    h('referrer-policy') ? { id: 'hdr-referrer', title: 'Referrer-Policy is set', status: 'ok', detail: h('referrer-policy') ?? '' }
      : { id: 'hdr-referrer', title: 'No Referrer-Policy', status: 'info', detail: 'Full page URLs may be sent to other sites.', fix },
    h('permissions-policy') ? { id: 'hdr-perms', title: 'Permissions-Policy is set', status: 'ok', detail: 'Camera, microphone and location access are restricted.' }
      : { id: 'hdr-perms', title: 'No Permissions-Policy', status: 'info', detail: 'Embedded content could request the camera or microphone.', fix: 'Allow only what calls need: camera=(self), microphone=(self).' },
  ]
  return { ...base, configured: true, findings }
}
