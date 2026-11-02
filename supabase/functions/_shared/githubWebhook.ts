/*
  GitHub webhook handling as pure code (tested under Node in tests/githubWebhook.test.mjs).

  GitHub signs the EXACT raw body: header `x-hub-signature-256: sha256=<hex>` where hex = HMAC-SHA256(secret, rawBody). The receiver must
  verify before parsing, compare in constant time, and ignore a delivery id it has already processed (GitHub retries, and anyone who
  captures a signed request can replay it). Dedupe itself is a UNIQUE constraint in SQL; this module only extracts the id.
*/
import { hmacHex } from './webhookSign.ts'
import { isRepoFullName } from './github.ts'

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function verifyGithubSignature(secret: string, header: string | null, rawBody: string): Promise<boolean> {
  if (!secret || secret.length < 16) return false // an empty or tiny secret would make the signature guessable: refuse outright
  const m = header?.match(/^sha256=([0-9a-f]{64})$/)
  if (!m) return false
  return safeEqual(m[1], await hmacHex(secret, rawBody))
}

export const isDeliveryId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(s)
export const MAX_WEBHOOK_BYTES = 1_000_000 // GitHub's own cap is 25 MB; the events we keep are tiny, so refuse anything near that

export type ActivityKind = 'push' | 'pull_request' | 'review' | 'issue' | 'workflow_run' | 'deployment'
export interface ActivityRow {
  repo_full_name: string; kind: ActivityKind; title: string; actor: string; url: string | null; state: string; occurred_at: string
}
export interface InstallationChange { installation_id: number; account_login: string; account_type: string; repository_selection: string; action: string }
export type Mapped =
  | { type: 'activity'; row: ActivityRow }
  | { type: 'installation'; change: InstallationChange }
  | { type: 'ignored'; reason: string }

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown, max = 200) => String(v ?? '').slice(0, max)
const httpsOrNull = (v: unknown) => (typeof v === 'string' && /^https:\/\/github\.com\//.test(v) ? v.slice(0, 500) : null)
const nowIso = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString() }

/** Turn one delivery into at most one feed row. Unknown events and actions are ignored, never guessed at. */
export function mapGithubEvent(event: string, p: J): Mapped {
  const repoName = p.repository?.full_name
  if (event === 'ping') return { type: 'ignored', reason: 'ping' }
  if (event === 'installation' || event === 'installation_repositories') {
    const i = p.installation
    if (!i || !Number.isFinite(Number(i.id))) return { type: 'ignored', reason: 'no installation' }
    return { type: 'installation', change: { installation_id: Number(i.id), account_login: s(i.account?.login, 100), account_type: s(i.account?.type, 20), repository_selection: s(i.repository_selection, 20), action: s(p.action, 40) } }
  }
  if (!isRepoFullName(repoName)) return { type: 'ignored', reason: 'no repository' }
  const base = { repo_full_name: repoName as string }
  switch (event) {
    case 'push': {
      if (p.deleted) return { type: 'ignored', reason: 'branch deleted' }
      const branch = s(p.ref).replace(/^refs\/heads\//, '')
      const n = Array.isArray(p.commits) ? p.commits.length : 0
      return { type: 'activity', row: { ...base, kind: 'push', title: `${n} commit${n === 1 ? '' : 's'} pushed to ${branch}`, actor: s(p.pusher?.name || p.sender?.login, 100), url: httpsOrNull(p.compare), state: p.forced ? 'forced' : 'pushed', occurred_at: nowIso(p.head_commit?.timestamp) } }
    }
    case 'pull_request': {
      const pr = p.pull_request
      if (!pr || !['opened', 'closed', 'reopened', 'ready_for_review', 'converted_to_draft'].includes(p.action)) return { type: 'ignored', reason: `pull_request ${s(p.action, 40)}` }
      const state = p.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : p.action
      return { type: 'activity', row: { ...base, kind: 'pull_request', title: `#${Number(pr.number)} ${s(pr.title, 160)}`, actor: s(p.sender?.login, 100), url: httpsOrNull(pr.html_url), state, occurred_at: nowIso(pr.updated_at) } }
    }
    case 'pull_request_review': {
      const r = p.review
      if (p.action !== 'submitted' || !r) return { type: 'ignored', reason: 'review not submitted' }
      return { type: 'activity', row: { ...base, kind: 'review', title: `Review on #${Number(p.pull_request?.number)} ${s(p.pull_request?.title, 140)}`, actor: s(r.user?.login, 100), url: httpsOrNull(r.html_url), state: s(r.state, 30).toLowerCase(), occurred_at: nowIso(r.submitted_at) } }
    }
    case 'issues': {
      const i = p.issue
      if (!i || !['opened', 'closed', 'reopened'].includes(p.action)) return { type: 'ignored', reason: `issues ${s(p.action, 40)}` }
      return { type: 'activity', row: { ...base, kind: 'issue', title: `#${Number(i.number)} ${s(i.title, 160)}`, actor: s(p.sender?.login, 100), url: httpsOrNull(i.html_url), state: p.action, occurred_at: nowIso(i.updated_at) } }
    }
    case 'workflow_run': {
      const w = p.workflow_run
      if (p.action !== 'completed' || !w) return { type: 'ignored', reason: 'workflow not completed' }
      return { type: 'activity', row: { ...base, kind: 'workflow_run', title: `${s(w.name, 120)} on ${s(w.head_branch, 80)}`, actor: s(w.actor?.login, 100), url: httpsOrNull(w.html_url), state: s(w.conclusion || 'unknown', 30), occurred_at: nowIso(w.updated_at) } }
    }
    case 'deployment_status': {
      const d = p.deployment_status
      if (!d || !['success', 'failure', 'error'].includes(d.state)) return { type: 'ignored', reason: 'deployment not finished' }
      return { type: 'activity', row: { ...base, kind: 'deployment', title: `Deployment to ${s(p.deployment?.environment, 80)}`, actor: s(d.creator?.login, 100), url: httpsOrNull(d.target_url) ?? httpsOrNull(d.log_url), state: d.state, occurred_at: nowIso(d.updated_at) } }
    }
    default:
      return { type: 'ignored', reason: `unsupported event ${s(event, 40)}` }
  }
}

/** Failed builds and deployments are the events people want to be told about; everything else stays in the feed only. */
export const isAlertWorthy = (row: ActivityRow) => (row.kind === 'workflow_run' && row.state === 'failure') || (row.kind === 'deployment' && (row.state === 'failure' || row.state === 'error'))

export interface DeliveryDeps {
  secret: string | undefined
  record: (a: {
    delivery: string; event: string; action: string; repo: string | null; outcome: 'recorded' | 'ignored'; detail: string
    row?: ActivityRow
  }) => Promise<'recorded' | 'ignored' | 'duplicate'>
  upsertInstallation: (c: InstallationChange) => Promise<void>
}
export interface DeliveryResult { status: number; body: { ok?: true; result?: string; error?: string } }

/**
 * The whole receiver decision, with the database injected so it is tested without Deno. Order matters: size, then secret, then
 * SIGNATURE (before anything is parsed or stored), then delivery id, then JSON. An unsigned or mis-signed request leaves no trace.
 */
export async function processDelivery(deps: DeliveryDeps, headers: { get(n: string): string | null }, rawBody: string): Promise<DeliveryResult> {
  if (!deps.secret) return { status: 503, body: { error: 'The GitHub webhook is not configured.' } }
  if (rawBody.length > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: 'Payload too large.' } }
  if (!(await verifyGithubSignature(deps.secret, headers.get('x-hub-signature-256'), rawBody))) return { status: 401, body: { error: 'Invalid signature.' } }
  const delivery = headers.get('x-github-delivery')
  const event = (headers.get('x-github-event') ?? '').slice(0, 60)
  if (!isDeliveryId(delivery) || !/^[a-z_]{1,60}$/.test(event)) return { status: 400, body: { error: 'Missing GitHub delivery headers.' } }
  let payload: Record<string, unknown>
  try { payload = JSON.parse(rawBody) } catch { return { status: 400, body: { error: 'Body is not JSON.' } } }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 400, body: { error: 'Body is not a JSON object.' } }

  const action = String((payload as { action?: unknown }).action ?? '').slice(0, 60)
  const repo = (payload as { repository?: { full_name?: unknown } }).repository?.full_name
  const repoName = isRepoFullName(repo) ? repo : null
  const mapped = mapGithubEvent(event, payload)
  if (mapped.type === 'installation') {
    // Record the delivery first: a replay stops here and never re-applies an old suspend/delete over a newer state.
    const r = await deps.record({ delivery, event, action, repo: null, outcome: 'recorded', detail: 'installation' })
    if (r === 'duplicate') return { status: 200, body: { ok: true, result: 'duplicate' } }
    await deps.upsertInstallation(mapped.change)
    return { status: 200, body: { ok: true, result: 'recorded' } }
  }
  if (mapped.type === 'ignored') {
    const r = await deps.record({ delivery, event, action, repo: repoName, outcome: 'ignored', detail: mapped.reason.slice(0, 200) })
    return { status: 200, body: { ok: true, result: r === 'duplicate' ? 'duplicate' : 'ignored' } }
  }
  const r = await deps.record({ delivery, event, action, repo: mapped.row.repo_full_name, outcome: 'recorded', detail: '', row: mapped.row })
  return { status: 200, body: { ok: true, result: r } }
}
