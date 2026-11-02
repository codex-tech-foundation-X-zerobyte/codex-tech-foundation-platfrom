import { supabase } from '../supabase'
import { toError } from './shared'
import { parseBoard, type Board } from '../whiteboard'

/** Call an Edge Function and surface its own error message (supabase-js hides it inside `error.context` for non-2xx replies). */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (!error && !(data as { error?: string } | null)?.error) return { data: data as T, error: null }
  let message = (data as { error?: string } | null)?.error
  const ctx = (error as { context?: Response } | null)?.context
  if (!message && ctx && typeof ctx.json === 'function') { try { message = ((await ctx.json()) as { error?: string }).error } catch { /* fall through */ } }
  return { data: null, error: new Error(message ?? 'The integration service is unavailable. Try again shortly.') }
}

/* ---- GitHub (token lives only on the server) -------------------------------------------------------------------------------- */

export interface GithubRepo { full_name: string; description: string; private: boolean; default_branch: string; open_issues: number; pushed_at: string | null; html_url: string; language: string | null; department_id?: string | null; project_id?: string | null; error?: string }
export interface GithubDetail { repo: GithubRepo; branches: { name: string; protected: boolean }[]; commits: { sha: string; message: string; author: string; date: string | null; html_url: string }[]; issues: { number: number; title: string; author: string; labels: string[]; created_at: string; html_url: string }[] }
export interface GithubPull { number: number; title: string; author: string; draft: boolean; state: string; head: string; base: string; created_at: string; updated_at: string; html_url: string; approved: number; changes_requested: number }
export interface GithubRun { id: number; name: string; status: string; conclusion: string | null; branch: string; event: string; actor: string; created_at: string; html_url: string }
export interface GithubDeployment { id: number; environment: string; ref: string; created_at: string; creator: string }

export const connectGithub = (token: string) => invoke<{ account: string }>('integrations', { action: 'connect', token })
export const disconnectGithub = () => invoke<{ ok: true }>('integrations', { action: 'disconnect' })
export const githubAvailable = () => invoke<{ repos: GithubRepo[] }>('integrations', { action: 'available' })
export const githubRepos = () => invoke<{ repos: GithubRepo[] }>('integrations', { action: 'repos' })
export const githubDetail = (repo: string) => invoke<GithubDetail>('integrations', { action: 'repo-detail', repo })
export const githubPulls = (repo: string, state: ListState = 'open') => invoke<{ pulls: GithubPull[] }>('integrations', { action: 'pulls', repo, state })
export const githubRuns = (repo: string) => invoke<{ runs: GithubRun[]; deployments: GithubDeployment[] }>('integrations', { action: 'runs', repo })

/* ---- GitHub: read-only repository browser, App installations and the activity feed -------------------------------------------- */

export interface RepoTreeEntry { name: string; path: string; type: 'dir' | 'file' | 'symlink' | 'other'; size: number }
export interface RepoFile { name: string; path: string; size: number; html_url: string | null; sha: string; kind: 'text' | 'binary' | 'too_large' | 'unsupported'; text: string | null; reason: string }
export type RepoContents = { type: 'dir'; path: string; entries: RepoTreeEntry[]; truncated: boolean } | { type: 'file'; file: RepoFile }
export interface CommitListItem { sha: string; short: string; message: string; author: string; date: string | null; html_url: string | null }
export interface CommitFile { filename: string; status: string; additions: number; deletions: number; patch: string | null; patch_truncated: boolean }
export interface CommitDetail extends CommitListItem { message_full: string; stats: { additions: number; deletions: number; total: number }; parents: string[]; files: CommitFile[]; files_total: number; files_truncated: boolean }

export const githubContents = (repo: string, path: string, ref: string | null) => invoke<RepoContents>('integrations', { action: 'contents', repo, path, ref: ref ?? '' })
export const githubReadme = (repo: string, ref: string | null) => invoke<{ file: RepoFile | null }>('integrations', { action: 'readme', repo, ref: ref ?? '' })
export const githubCommits = (repo: string, ref: string | null, page: number) => invoke<{ commits: CommitListItem[]; page: number; has_more: boolean }>('integrations', { action: 'commits', repo, ref: ref ?? '', page })
export const githubCommit = (repo: string, sha: string) => invoke<{ commit: CommitDetail }>('integrations', { action: 'commit', repo, sha })
export const githubBranches = (repo: string, page = 1) => invoke<{ branches: { name: string; protected: boolean }[]; page: number; has_more: boolean }>('integrations', { action: 'branches', repo, page })

export type ListState = 'open' | 'closed' | 'all'
export interface DiscussionComment { id: number; author: string; created_at: string | null; html_url: string | null; body: string; body_truncated: boolean }
export interface ReviewEntry { id: number; author: string; state: string; submitted_at: string | null; body: string; html_url: string | null }
export interface CheckSummary { overall: 'passing' | 'failing' | 'pending' | 'none' | 'unknown'; total: number; failed: number; pending: number; items: { name: string; status: string; conclusion: string | null; html_url: string | null }[] }
export interface PullDetail extends GithubPull {
  body: string; body_truncated: boolean; merged: boolean; mergeable: boolean | null; mergeable_state: string; additions: number; deletions: number; changed_files: number
  labels: string[]; reviewers_requested: string[]; files: CommitFile[]; files_truncated: boolean; reviews: ReviewEntry[]; comments: DiscussionComment[]; checks: CheckSummary
}
export interface IssueListItem { number: number; title: string; state: string; author: string; comments: number; labels: string[]; assignees: string[]; created_at: string | null; updated_at: string | null; html_url: string | null }
export interface IssueDetail extends IssueListItem { body: string; body_truncated: boolean; state_reason: string | null; milestone: string | null; comments_list: DiscussionComment[]; comments_truncated: boolean }
export const githubPullDetail = (repo: string, number: number) => invoke<{ pull: PullDetail }>('integrations', { action: 'pull-detail', repo, number })
export const githubIssues = (repo: string, state: ListState, page: number) => invoke<{ issues: IssueListItem[]; page: number; has_more: boolean }>('integrations', { action: 'issues', repo, state, page })
export const githubIssue = (repo: string, number: number) => invoke<{ issue: IssueDetail }>('integrations', { action: 'issue-detail', repo, number })

export type WriteLevel = 'off' | 'admins' | 'members'
export interface GithubCapabilities { comment: boolean; issue: boolean }
export interface GithubPolicy { repo_full_name: string; comment_level: WriteLevel; issue_level: WriteLevel }
export interface GithubActionRow { id: string; actor_id: string; repo_full_name: string; action: 'comment' | 'create_issue'; target: number | null; outcome: 'pending' | 'success' | 'failed' | 'denied'; detail: string; result_url: string | null; created_at: string }
export interface WriteReceipt { ok: true; url: string; number?: number; warning?: string }

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0'))
/** Every click gets its own request id, so the server can refuse a double submit. The person sees the server's own plain-language error. */
export const githubComment = (repo: string, number: number, text: string) => invoke<WriteReceipt>('integrations', { action: 'comment', repo, number, text, request_id: newRequestId() })
export const githubCreateIssue = (repo: string, title: string, text: string) => invoke<WriteReceipt>('integrations', { action: 'create-issue', repo, title, text, request_id: newRequestId() })

/** What the CALLER may do to this repository. Decided by the database; the screen only mirrors it, the server re-checks every write. */
export async function githubCapabilities(repo: string): Promise<{ data: GithubCapabilities; error: Error | null }> {
  const { data, error } = await supabase.rpc('github_capabilities', { p_repo: repo })
  const d = (data ?? {}) as Partial<GithubCapabilities>
  return { data: { comment: d.comment === true, issue: d.issue === true }, error: error ? toError(error) : null }
}
export async function listGithubPolicies() {
  const { data, error } = await supabase.from('github_repo_policy').select('repo_full_name, comment_level, issue_level')
  return { data: (data ?? []) as GithubPolicy[], error: error ? toError(error) : null }
}
export async function setGithubRepoPolicy(repo: string, comment: WriteLevel, issue: WriteLevel) {
  const { error } = await supabase.rpc('set_github_repo_policy', { p_repo: repo, p_comment: comment, p_issue: issue })
  return { error: error ? toError(error) : null }
}
export async function listGithubActions(limit = 25) {
  const { data, error } = await supabase.from('github_actions').select('id, actor_id, repo_full_name, action, target, outcome, detail, result_url, created_at').order('created_at', { ascending: false }).limit(limit)
  const rows = (data ?? []) as GithubActionRow[]
  const ids = [...new Set(rows.map((r) => r.actor_id))]
  const names: Record<string, string> = {}
  if (ids.length > 0) { const { data: people } = await supabase.from('profiles').select('id, display_name').in('id', ids); for (const p of people ?? []) names[p.id as string] = String(p.display_name ?? '') }
  return { data: rows.map((r) => ({ ...r, actor: names[r.actor_id] || 'Someone' })), error: error ? toError(error) : null }
}

export type DeployState = 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | 'CANCELED' | 'UNKNOWN'
export interface DeploymentItem { id: string; state: DeployState; target: 'production' | 'preview'; created_at: string | null; url: string | null; inspector_url: string | null; branch: string | null; sha: string | null; message: string | null; author: string | null }
export interface ProductionSummary { status: 'none' | 'live' | 'failed' | 'building' | 'canceled' | 'unknown'; latest: DeploymentItem | null; last_ready: DeploymentItem | null }
export type DeploymentsResult = { status: 'ok'; production: ProductionSummary; deployments: DeploymentItem[] } | { status: 'not_mapped' } | { status: 'not_configured' }
export const githubDeployments = (repo: string) => invoke<DeploymentsResult>('integrations', { action: 'deployments', repo })
export const vercelStatus = () => invoke<{ configured: boolean }>('integrations', { action: 'vercel-status' })

export interface DeploymentTarget { repo_full_name: string; provider: 'vercel'; project_ref: string; team_ref: string | null }
export async function listDeploymentTargets() {
  const { data, error } = await supabase.from('deployment_targets').select('repo_full_name, provider, project_ref, team_ref')
  return { data: (data ?? []) as DeploymentTarget[], error: error ? toError(error) : null }
}
export async function setDeploymentTarget(repo: string, project: string, team: string) {
  const { error } = await supabase.rpc('set_deployment_target', { p_repo: repo, p_provider: 'vercel', p_project: project, p_team: team })
  return { error: error ? toError(error) : null }
}
export async function clearDeploymentTarget(repo: string) {
  const { error } = await supabase.rpc('clear_deployment_target', { p_repo: repo })
  return { error: error ? toError(error) : null }
}

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped'
export interface ConnectionCheck { id: string; group: 'server' | 'github' | 'database' | 'vercel'; label: string; status: CheckStatus; detail: string }
export interface ConnectionReport { checked_at: string; overall: { status: 'ok' | 'warn' | 'fail'; failed: number; warned: number }; checks: ConnectionCheck[] }
/** Main Admin only. Asks GitHub, Vercel and the database how the connection is doing; changes nothing and never returns a secret. */
export const runConnectionCheck = () => invoke<ConnectionReport>('integrations', { action: 'health' })

export interface GithubInstallation { installation_id: number; account_login: string; account_type: string; repository_selection: string; suspended: boolean; removed: boolean }
export const githubInstallations = () => invoke<{ app_configured: boolean; installations: GithubInstallation[] }>('integrations', { action: 'installations' })
export const selectGithubInstallation = (installationId: number) => invoke<{ ok: true; account: string }>('integrations', { action: 'select-installation', installation_id: installationId })

export interface GithubActivityRow { id: string; repo_full_name: string; kind: 'push' | 'pull_request' | 'review' | 'issue' | 'workflow_run' | 'deployment'; title: string; actor: string; url: string | null; state: string; occurred_at: string }
/** Row-Level Security decides which repositories' activity the caller may read: the same rule as the repository list. */
export async function listGithubActivity(repo: string, limit = 50) {
  const { data, error } = await supabase.from('github_activity').select('id, repo_full_name, kind, title, actor, url, state, occurred_at').eq('repo_full_name', repo).order('occurred_at', { ascending: false }).limit(limit)
  return { data: (data ?? []) as GithubActivityRow[], error: error ? toError(error) : null }
}
/** Only an https link to github.com is ever rendered as a link. */
export const isGithubUrl = (u: string | null | undefined): u is string => typeof u === 'string' && /^https:\/\/github\.com\//.test(u)

export interface LinkedRepository { id: string; full_name: string; department_id: string | null; project_id: string | null }
export async function listLinkedRepositories() {
  const { data, error } = await supabase.from('integration_repositories').select('id, full_name, department_id, project_id').order('full_name')
  return { data: (data ?? []) as LinkedRepository[], error: error ? toError(error) : null }
}
export async function linkRepository(fullName: string, departmentId: string | null, projectId: string | null) {
  const { error, status } = await supabase.from('integration_repositories').insert({ full_name: fullName, department_id: departmentId, project_id: projectId })
  return { error: error ? toError(error, status) : null }
}
export async function unlinkRepository(id: string) {
  const { error, status } = await supabase.from('integration_repositories').delete().eq('id', id)
  return { error: error ? toError(error, status) : null }
}

/* ---- Figma and Canva: launchers to the company's own workspace ---------------------------------------------------------------- */

const HOSTS = { figma: ['figma.com'], canva: ['canva.com'] } as const
/** Only an https link to the provider's own domain, so the "Open in Figma" button can never point somewhere else. */
export function validateLaunchUrl(provider: 'figma' | 'canva', raw: string): string | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return 'Paste the full link, starting with https://' }
  if (u.protocol !== 'https:') return 'The link must start with https://'
  const host = u.hostname.toLowerCase()
  if (!HOSTS[provider].some((h) => host === h || host.endsWith(`.${h}`))) return `That is not a ${provider === 'figma' ? 'Figma' : 'Canva'} link.`
  return null
}
export async function saveLaunchUrl(provider: 'figma' | 'canva', url: string | null) {
  if (url) { const problem = validateLaunchUrl(provider, url); if (problem) return { error: new Error(problem) } }
  const patch = url ? { status: 'connected', config: { url: url.trim() }, connected_at: new Date().toISOString() } : { status: 'not_connected', config: {}, connected_at: null }
  const { data, error, status } = await supabase.from('integrations').update(patch).eq('provider', provider).select('provider')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only a Main Admin can change integrations.') }
  return { error: null }
}

/* ---- Whiteboards -------------------------------------------------------------------------------------------------------------- */

export interface WhiteboardMeta { id: string; title: string; version: number; updated_at: string }
export interface WhiteboardDoc extends WhiteboardMeta { board: Board; department_id: string }

export async function listWhiteboards(departmentId: string) {
  const { data, error } = await supabase.from('whiteboards').select('id, title, version, updated_at').eq('department_id', departmentId).order('updated_at', { ascending: false })
  return { data: (data ?? []) as WhiteboardMeta[], error: error ? toError(error) : null }
}
export async function createWhiteboard(departmentId: string, title: string) {
  if (!title.trim()) return { data: null, error: new Error('Give the whiteboard a name.') }
  const { data, error, status } = await supabase.from('whiteboards').insert({ department_id: departmentId, title: title.trim() }).select('id').single()
  return { data: (data?.id as string | undefined) ?? null, error: error ? toError(error, status) : null }
}
export async function loadWhiteboard(id: string) {
  const { data, error } = await supabase.from('whiteboards').select('id, department_id, title, version, updated_at, data').eq('id', id).maybeSingle()
  if (error) return { data: null as WhiteboardDoc | null, error: toError(error) }
  if (!data) return { data: null as WhiteboardDoc | null, error: new Error('Whiteboard not found.') }
  return { data: { id: data.id, department_id: data.department_id, title: data.title, version: data.version, updated_at: data.updated_at, board: parseBoard(data.data) } as WhiteboardDoc, error: null }
}
/** Save on top of the version that was loaded. If someone else saved first, nothing is overwritten and `conflict` is true. */
export async function saveWhiteboard(id: string, loadedVersion: number, board: Board) {
  const { data, error, status } = await supabase.from('whiteboards').update({ data: board, version: loadedVersion + 1 }).eq('id', id).eq('version', loadedVersion).select('version')
  if (error) return { version: null, conflict: error.code === '40001', error: error.code === '40001' ? null : toError(error, status) }
  if ((data?.length ?? 0) === 0) return { version: null, conflict: true, error: null }
  return { version: data![0].version as number, conflict: false, error: null }
}
export async function deleteWhiteboard(id: string) {
  const { data, error, status } = await supabase.from('whiteboards').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only a Department Admin can delete a whiteboard.') }
  return { error: null }
}
export function subscribeToWhiteboard(id: string, onChange: (version: number) => void): () => void {
  const channel = supabase.channel(`whiteboard:${id}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whiteboards', filter: `id=eq.${id}` }, (p) => onChange(Number((p.new as { version?: number }).version ?? 0)))
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

/* ---- Webhook inboxes ------------------------------------------------------------------------------------------------------------ */

export interface WebhookInbox { id: string; name: string; token: string; created_at: string }
export interface WebhookRequest { id: string; method: string; path: string; query: string; headers: Record<string, string>; body: string; received_at: string }

export const webhookUrl = (token: string, base: string | undefined = import.meta.env?.VITE_SUPABASE_URL) => `${(base ?? '').replace(/\/$/, '')}/functions/v1/webhook-inbox/${token}`

export async function listInboxes(departmentId: string) {
  const { data, error } = await supabase.from('webhook_inboxes').select('id, name, token, created_at').eq('department_id', departmentId).order('created_at', { ascending: false })
  return { data: (data ?? []) as WebhookInbox[], error: error ? toError(error) : null }
}
export async function createInbox(departmentId: string, name: string) {
  if (!name.trim()) return { error: new Error('Name the inbox, e.g. “Stripe test”.') }
  const { error, status } = await supabase.from('webhook_inboxes').insert({ department_id: departmentId, name: name.trim() })
  return { error: error ? toError(error, status) : null }
}
export async function deleteInbox(id: string) {
  const { data, error, status } = await supabase.from('webhook_inboxes').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You can only delete inboxes you created, unless you're a Department Admin.") }
  return { error: null }
}
export async function listCaptured(inboxId: string) {
  const { data, error } = await supabase.from('webhook_requests').select('id, method, path, query, headers, body, received_at').eq('inbox_id', inboxId).order('received_at', { ascending: false }).limit(50)
  return { data: (data ?? []) as WebhookRequest[], error: error ? toError(error) : null }
}
export async function clearCaptured(inboxId: string) {
  const { error, status } = await supabase.from('webhook_requests').delete().eq('inbox_id', inboxId)
  return { error: error ? toError(error, status) : null }
}
export function subscribeToCaptured(inboxId: string, onInsert: () => void): () => void {
  const channel = supabase.channel(`webhook:${inboxId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'webhook_requests', filter: `inbox_id=eq.${inboxId}` }, () => onInsert())
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

/* ---- Lead statistics (Marketing) ------------------------------------------------------------------------------------------------ */

export async function loadLeadStats(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabase.from('leads').select('status, created_at').gte('created_at', since).limit(5000)
  return { data: (data ?? []) as { status: string; created_at: string }[], error: error ? toError(error) : null }
}
