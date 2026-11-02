/*
  Vercel deployment status, as pure code (tested under Node in tests/vercel.test.mjs). READ-ONLY: nothing here can deploy, redeploy,
  roll back, cancel or change a project. The token is the Edge Function secret VERCEL_TOKEN; it is used for one request and never returned.

  API shape (Vercel REST, documented): GET https://api.vercel.com/v6/deployments?projectId=<id or name>&limit=<n>[&target=production][&teamId=<id>|&slug=<slug>]
  returns { deployments: [{ uid, name, url|null, created (ms), readyState|state, target, source, inspectorUrl, creator, meta? }] }.
  `meta` (the Git commit details) is read when present and is never required.
*/
export const VERCEL_API = 'https://api.vercel.com'

export type VercelErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'error'
export class VercelError extends Error {
  kind: VercelErrorKind
  status: number
  constructor(kind: VercelErrorKind, status: number, message: string) { super(message); this.kind = kind; this.status = status }
}

export const isProjectRef = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(s)
export const isTeamRef = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(s)

export interface VercelResponse { ok: boolean; status: number; json(): Promise<unknown> }
export type VercelFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<VercelResponse>

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function vercelListDeployments(
  token: string, q: { project: string; team?: string | null; target?: 'production'; limit: number }, fetchImpl: VercelFetcher = (u, i) => fetch(u, i),
): Promise<J[]> {
  if (!isProjectRef(q.project) || (q.team != null && !isTeamRef(q.team))) throw new VercelError('error', 400, 'The Vercel project is not set up correctly.')
  const url = new URL('/v6/deployments', VERCEL_API)
  url.searchParams.set('projectId', q.project)
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, Math.floor(q.limit)))))
  if (q.target) url.searchParams.set('target', q.target)
  if (q.team) url.searchParams.set(q.team.startsWith('team_') ? 'teamId' : 'slug', q.team)
  const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'codex-workspace' } })
  if (res.ok) {
    const body = (await res.json()) as { deployments?: unknown }
    if (!body || !Array.isArray(body.deployments)) throw new VercelError('error', 502, 'Vercel returned an unexpected answer.')
    return body.deployments as J[]
  }
  if (res.status === 401) throw new VercelError('unauthorized', 401, 'Vercel rejected the server token. Ask the Main Admin to replace it.')
  if (res.status === 403) throw new VercelError('forbidden', 403, 'The Vercel token cannot see this project. Check the project and team it was created for.')
  if (res.status === 404) throw new VercelError('not_found', 404, 'Vercel could not find that project. Check the project name or id and the team.')
  if (res.status === 429) throw new VercelError('rate_limited', 429, 'Vercel\u2019s rate limit was reached. Try again in a few minutes.')
  throw new VercelError('error', res.status, `Vercel answered ${res.status}.`)
}

export type DeployState = 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | 'CANCELED' | 'UNKNOWN'
const STATES: DeployState[] = ['READY', 'ERROR', 'BUILDING', 'QUEUED', 'INITIALIZING', 'CANCELED']
const SAFE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.vercel\.app$/
const firstLine = (v: unknown, max: number) => String(v ?? '').split('\n')[0].slice(0, max)

export function slimVercelDeployment(d: J) {
  const rawState = String(d.readyState ?? d.state ?? '').toUpperCase()
  const state = (STATES as string[]).includes(rawState) ? (rawState as DeployState) : 'UNKNOWN'
  const host = typeof d.url === 'string' ? d.url.toLowerCase() : ''
  const sha = typeof d.meta?.githubCommitSha === 'string' && /^[0-9a-f]{7,40}$/i.test(d.meta.githubCommitSha) ? d.meta.githubCommitSha.slice(0, 7).toLowerCase() : null
  const created = Number(d.created ?? d.createdAt)
  return {
    id: String(d.uid ?? d.id ?? '').slice(0, 80), state, target: d.target === 'production' ? ('production' as const) : ('preview' as const),
    created_at: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : null,
    url: SAFE_HOST.test(host) ? `https://${host}` : null,
    inspector_url: typeof d.inspectorUrl === 'string' && /^https:\/\/vercel\.com\//.test(d.inspectorUrl) ? d.inspectorUrl.slice(0, 500) : null,
    branch: typeof d.meta?.githubCommitRef === 'string' ? d.meta.githubCommitRef.slice(0, 120) : null,
    sha, message: d.meta?.githubCommitMessage ? firstLine(d.meta.githubCommitMessage, 160) : null,
    author: firstLine(d.meta?.githubCommitAuthorName ?? d.creator?.username ?? '', 80) || null,
  }
}
export type SlimVercelDeployment = ReturnType<typeof slimVercelDeployment>

const byNewest = (a: SlimVercelDeployment, b: SlimVercelDeployment) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '') || 0

/**
 * Where does production stand? Judged from the newest production deployment only: READY means "the latest production deployment finished
 * successfully", not "the site is verified to be up". A failed latest deployment is reported as failed even if an older one is live,
 * and the last good one is shown beside it so the person knows what visitors are probably still seeing.
 */
export function summariseProduction(production: SlimVercelDeployment[]) {
  const sorted = [...production].filter((d) => d.target === 'production').sort(byNewest)
  const latest = sorted[0] ?? null
  const lastReady = sorted.find((d) => d.state === 'READY') ?? null
  const status = !latest ? ('none' as const)
    : latest.state === 'READY' ? ('live' as const)
    : latest.state === 'ERROR' ? ('failed' as const)
    : latest.state === 'CANCELED' ? ('canceled' as const)
    : latest.state === 'UNKNOWN' ? ('unknown' as const)
    : ('building' as const)
  return { status, latest, last_ready: lastReady && latest && lastReady.id !== latest.id ? lastReady : null }
}
