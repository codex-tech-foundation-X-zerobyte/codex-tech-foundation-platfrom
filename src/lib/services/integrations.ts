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
export const githubPulls = (repo: string) => invoke<{ pulls: GithubPull[] }>('integrations', { action: 'pulls', repo })
export const githubRuns = (repo: string) => invoke<{ runs: GithubRun[]; deployments: GithubDeployment[] }>('integrations', { action: 'runs', repo })

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
