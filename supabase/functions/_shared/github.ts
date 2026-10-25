/*
  Pure GitHub helpers for the `integrations` Edge Function. No Deno or Supabase imports, so they are unit-tested under Node
  (tests/github.test.mjs). The token only ever exists on the server: it is read from `integration_secrets` with the service
  role, used for one request, and never returned to the browser.
*/

export const GITHUB_API = 'https://api.github.com'

export type GithubErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'error'
export class GithubError extends Error {
  kind: GithubErrorKind
  status: number
  constructor(kind: GithubErrorKind, status: number, message: string) { super(message); this.kind = kind; this.status = status }
}

export interface FetchResponse { ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }
export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>

export const isRepoFullName = (s: unknown): s is string => typeof s === 'string' && s.length <= 140 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) && !s.includes('..')

export async function githubGet(token: string, path: string, fetchImpl: Fetcher = (u, i) => fetch(u, i)): Promise<unknown> {
  if (!path.startsWith('/')) throw new GithubError('error', 400, 'Bad GitHub path.')
  const res = await fetchImpl(`${GITHUB_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-workspace' },
  })
  if (res.ok) return res.json()
  if (res.status === 401) throw new GithubError('unauthorized', 401, 'GitHub rejected the saved token. Reconnect GitHub.')
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') throw new GithubError('rate_limited', 429, 'GitHub\u2019s rate limit was reached. Try again in a few minutes.')
    throw new GithubError('forbidden', 403, 'The connected token cannot access that.')
  }
  if (res.status === 404) throw new GithubError('not_found', 404, 'GitHub could not find that. Check the repository is covered by the token.')
  throw new GithubError('error', res.status, `GitHub answered ${res.status}.`)
}

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const slimRepo = (r: J) => ({
  full_name: String(r.full_name), description: r.description ?? '', private: !!r.private, default_branch: r.default_branch ?? 'main',
  open_issues: Number(r.open_issues_count ?? 0), pushed_at: r.pushed_at ?? null, html_url: r.html_url, language: r.language ?? null,
})
export const slimBranch = (b: J) => ({ name: String(b.name), protected: !!b.protected })
export const slimCommit = (c: J) => ({
  sha: String(c.sha).slice(0, 7), message: String(c.commit?.message ?? '').split('\n')[0].slice(0, 160),
  author: c.author?.login ?? c.commit?.author?.name ?? 'unknown', date: c.commit?.author?.date ?? null, html_url: c.html_url,
})
/** GitHub's issues endpoint also returns pull requests; those carry a `pull_request` key and are shown under pull requests instead. */
export const slimIssues = (list: J[]) => list.filter((i) => !i.pull_request).map((i) => ({ number: Number(i.number), title: String(i.title), author: i.user?.login ?? 'unknown', labels: (i.labels ?? []).map((l: J) => String(l.name)), created_at: i.created_at, html_url: i.html_url }))

/** Latest review per person decides: someone who approved and later asked for changes counts as "changes requested". */
export function reviewSummary(reviews: J[]) {
  const latest = new Map<string, string>()
  for (const r of [...reviews].sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(String(r.user?.login ?? r.user?.id), r.state)
  }
  const states = [...latest.values()]
  return { approved: states.filter((s) => s === 'APPROVED').length, changes_requested: states.filter((s) => s === 'CHANGES_REQUESTED').length }
}
export const slimPull = (p: J, reviews: J[] = []) => ({
  number: Number(p.number), title: String(p.title), author: p.user?.login ?? 'unknown', draft: !!p.draft, state: p.merged_at ? 'merged' : String(p.state),
  head: p.head?.ref ?? '', base: p.base?.ref ?? '', created_at: p.created_at, updated_at: p.updated_at, html_url: p.html_url, ...reviewSummary(reviews),
})
export const slimRun = (r: J) => ({
  id: Number(r.id), name: String(r.name ?? r.display_title ?? 'workflow'), status: String(r.status), conclusion: r.conclusion ?? null,
  branch: r.head_branch ?? '', event: r.event ?? '', actor: r.actor?.login ?? '', created_at: r.created_at, html_url: r.html_url,
})
export const slimDeployment = (d: J) => ({ id: Number(d.id), environment: String(d.environment), ref: String(d.ref), created_at: d.created_at, creator: d.creator?.login ?? '' })
