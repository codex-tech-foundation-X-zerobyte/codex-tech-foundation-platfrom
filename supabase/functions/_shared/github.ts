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

/* ---- Repository browser: validation and slimming (read-only) ---------------------------------------------------------------------- */

/** A path inside a repository. Rejects traversal, absolute paths, backslashes, control characters and anything that could change the API route. */
export const isSafeRepoPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length <= 300 && !p.startsWith('/') && !p.endsWith('/') && !p.includes('//') &&
  p.split('/').every((seg) => seg !== '..' && seg !== '.' && seg.length > 0) && !/[\\\u0000-\u001f\u007f?#%]/.test(p)
/** A branch, tag or commit name used as `ref`. */
export const isSafeRef = (r: unknown): r is string =>
  typeof r === 'string' && r.length >= 1 && r.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(r) && !r.includes('..') && !r.startsWith('/') && !r.endsWith('/') && !r.includes('//')
export const isCommitSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{7,40}$/.test(s)
export const clampPage = (n: unknown, max = 50) => Math.min(max, Math.max(1, Math.floor(Number(n)) || 1))

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

export const MAX_FILE_BYTES = 256 * 1024
export const MAX_PATCH_CHARS = 20_000
export const MAX_COMMIT_FILES = 60

export const slimTreeEntry = (e: J) => ({ name: String(e.name), path: String(e.path), type: e.type === 'dir' ? 'dir' : e.type === 'file' ? 'file' : e.type === 'symlink' ? 'symlink' : 'other', size: Number(e.size ?? 0) })
/** Folders first, then files, each alphabetical, so the browser reads like a file manager. */
export const sortTree = <T extends { name: string; type: string }>(list: T[]) => [...list].sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name))

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''))
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
/**
 * One file as the browser shows it. Never returns raw bytes: binary files and files over the cap come back with a reason and a link,
 * so the page cannot be made to render something unexpected and a huge file cannot flood the response.
 */
export function slimFile(f: J) {
  const base = { name: String(f.name), path: String(f.path), size: Number(f.size ?? 0), html_url: typeof f.html_url === 'string' && /^https:\/\/github\.com\//.test(f.html_url) ? f.html_url : null, sha: String(f.sha ?? '').slice(0, 40) }
  if (f.type !== 'file') return { ...base, kind: 'unsupported' as const, text: null, reason: 'This is not a regular file.' }
  if (base.size > MAX_FILE_BYTES) return { ...base, kind: 'too_large' as const, text: null, reason: 'This file is larger than 256 KB. Open it on GitHub.' }
  if (f.encoding !== 'base64' || typeof f.content !== 'string') return { ...base, kind: 'unsupported' as const, text: null, reason: 'GitHub did not return the contents.' }
  const text = decodeBase64Utf8(f.content)
  if (text.includes('\u0000')) return { ...base, kind: 'binary' as const, text: null, reason: 'This is a binary file.' }
  return { ...base, kind: 'text' as const, text, reason: '' }
}

export const slimCommitListItem = (c: J) => ({
  sha: String(c.sha), short: String(c.sha).slice(0, 7), message: String(c.commit?.message ?? '').split('\n')[0].slice(0, 200),
  author: c.author?.login ?? c.commit?.author?.name ?? 'unknown', date: c.commit?.author?.date ?? null, html_url: typeof c.html_url === 'string' && /^https:\/\/github\.com\//.test(c.html_url) ? c.html_url : null,
})
export function slimCommitDetail(c: J) {
  const files: J[] = Array.isArray(c.files) ? c.files : []
  return {
    ...slimCommitListItem(c), message_full: String(c.commit?.message ?? '').slice(0, 4000),
    stats: { additions: Number(c.stats?.additions ?? 0), deletions: Number(c.stats?.deletions ?? 0), total: Number(c.stats?.total ?? 0) },
    parents: (Array.isArray(c.parents) ? c.parents : []).map((p: J) => String(p.sha).slice(0, 40)).slice(0, 5),
    files: files.slice(0, MAX_COMMIT_FILES).map((f) => ({
      filename: String(f.filename), status: String(f.status ?? 'modified'), additions: Number(f.additions ?? 0), deletions: Number(f.deletions ?? 0),
      // GitHub omits `patch` for binary or very large diffs. Say so rather than showing an empty diff as if nothing changed.
      patch: typeof f.patch === 'string' ? f.patch.slice(0, MAX_PATCH_CHARS) : null, patch_truncated: typeof f.patch === 'string' && f.patch.length > MAX_PATCH_CHARS,
    })),
    files_total: files.length, files_truncated: files.length > MAX_COMMIT_FILES,
  }
}

/* ---- Pull request and issue detail (read-only) ---------------------------------------------------------------------------------- */

export const MAX_BODY_CHARS = 10_000
export const MAX_COMMENT_CHARS = 4_000
export const MAX_COMMENTS = 30
export const isItemNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10_000_000
export const isListState = (s: unknown): s is 'open' | 'closed' | 'all' => s === 'open' || s === 'closed' || s === 'all'
const gh = (u: unknown) => (typeof u === 'string' && /^https:\/\/github\.com\//.test(u) ? u : null)
const login = (u: J | null | undefined) => (typeof u?.login === 'string' ? u.login : 'unknown')

export const slimComment = (c: J) => ({
  id: Number(c.id), author: login(c.user), created_at: c.created_at ?? null, html_url: gh(c.html_url),
  body: String(c.body ?? '').slice(0, MAX_COMMENT_CHARS), body_truncated: String(c.body ?? '').length > MAX_COMMENT_CHARS,
})
export const slimReviewEntry = (r: J) => ({
  id: Number(r.id), author: login(r.user), state: String(r.state ?? '').toLowerCase().slice(0, 30), submitted_at: r.submitted_at ?? null,
  body: String(r.body ?? '').slice(0, MAX_COMMENT_CHARS), html_url: gh(r.html_url),
})
export const slimChangedFile = (f: J) => ({
  filename: String(f.filename), status: String(f.status ?? 'modified'), additions: Number(f.additions ?? 0), deletions: Number(f.deletions ?? 0),
  patch: typeof f.patch === 'string' ? f.patch.slice(0, MAX_PATCH_CHARS) : null, patch_truncated: typeof f.patch === 'string' && f.patch.length > MAX_PATCH_CHARS,
})

/** CI status for a commit, from GitHub's check runs. `none` means GitHub reported no checks: it never means "passing". */
export function summariseChecks(runs: J[] | null) {
  if (runs === null) return { overall: 'unknown' as const, total: 0, failed: 0, pending: 0, items: [] as { name: string; status: string; conclusion: string | null; html_url: string | null }[] }
  const items = runs.slice(0, 30).map((r) => ({ name: String(r.name ?? 'check').slice(0, 120), status: String(r.status ?? ''), conclusion: typeof r.conclusion === 'string' ? r.conclusion : null, html_url: gh(r.html_url) }))
  const bad = (c: string | null) => c === 'failure' || c === 'timed_out' || c === 'cancelled' || c === 'action_required' || c === 'startup_failure'
  const failed = items.filter((i) => i.status === 'completed' && bad(i.conclusion)).length
  const pending = items.filter((i) => i.status !== 'completed').length
  const overall = items.length === 0 ? ('none' as const) : failed > 0 ? ('failing' as const) : pending > 0 ? ('pending' as const) : ('passing' as const)
  return { overall, total: items.length, failed, pending, items }
}

export function slimPullDetail(pr: J, files: J[], reviews: J[], comments: J[], checkRuns: J[] | null) {
  return {
    ...slimPull(pr, reviews),
    body: String(pr.body ?? '').slice(0, MAX_BODY_CHARS), body_truncated: String(pr.body ?? '').length > MAX_BODY_CHARS,
    merged: !!pr.merged_at, mergeable: typeof pr.mergeable === 'boolean' ? pr.mergeable : null, mergeable_state: String(pr.mergeable_state ?? 'unknown').slice(0, 30),
    additions: Number(pr.additions ?? 0), deletions: Number(pr.deletions ?? 0), changed_files: Number(pr.changed_files ?? files.length),
    labels: (Array.isArray(pr.labels) ? pr.labels : []).map((l: J) => String(l.name).slice(0, 60)).slice(0, 20),
    reviewers_requested: (Array.isArray(pr.requested_reviewers) ? pr.requested_reviewers : []).map((u: J) => login(u)).slice(0, 20),
    files: files.slice(0, MAX_COMMIT_FILES).map(slimChangedFile), files_truncated: files.length > MAX_COMMIT_FILES,
    reviews: reviews.filter((r) => r.state !== 'PENDING').slice(-MAX_COMMENTS).map(slimReviewEntry),
    comments: comments.slice(-MAX_COMMENTS).map(slimComment),
    checks: summariseChecks(checkRuns),
  }
}

export const slimIssueListItem = (i: J) => ({
  number: Number(i.number), title: String(i.title).slice(0, 300), state: String(i.state), author: login(i.user), comments: Number(i.comments ?? 0),
  labels: (Array.isArray(i.labels) ? i.labels : []).map((l: J) => String(l.name).slice(0, 60)).slice(0, 10), assignees: (Array.isArray(i.assignees) ? i.assignees : []).map((a: J) => login(a)).slice(0, 10),
  created_at: i.created_at ?? null, updated_at: i.updated_at ?? null, html_url: gh(i.html_url),
})
export const slimIssueDetail = (i: J, comments: J[]) => ({
  ...slimIssueListItem(i), body: String(i.body ?? '').slice(0, MAX_BODY_CHARS), body_truncated: String(i.body ?? '').length > MAX_BODY_CHARS,
  state_reason: typeof i.state_reason === 'string' ? i.state_reason : null, milestone: typeof i.milestone?.title === 'string' ? i.milestone.title.slice(0, 120) : null,
  comments_list: comments.slice(-MAX_COMMENTS).map(slimComment), comments_truncated: comments.length > MAX_COMMENTS,
})

/* ---- Writing to GitHub (App only) --------------------------------------------------------------------------------------------- */

export type PostFetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchResponse>

/** POST JSON to GitHub. Error messages are written for the person who pressed the button, and never echo what GitHub returned. */
export async function githubPost(token: string, path: string, payload: unknown, fetchImpl: PostFetcher = (u, i) => fetch(u, i)): Promise<unknown> {
  if (!path.startsWith('/')) throw new GithubError('error', 400, 'Bad GitHub path.')
  const res = await fetchImpl(`${GITHUB_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-workspace', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.ok) return res.json()
  if (res.status === 401) throw new GithubError('unauthorized', 401, 'GitHub rejected the App credentials. Ask the Main Admin to reconnect GitHub.')
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') throw new GithubError('rate_limited', 429, 'GitHub\u2019s rate limit was reached. Try again in a few minutes.')
    throw new GithubError('forbidden', 403, 'The GitHub App is not allowed to write here. Ask the Main Admin to give the App write access for Issues and Pull requests, then accept the change in GitHub.')
  }
  if (res.status === 404) throw new GithubError('not_found', 404, 'GitHub could not find that, or the App cannot reach it. Check the repository is part of the App installation.')
  if (res.status === 410) throw new GithubError('error', 410, 'Issues are turned off for this repository on GitHub.')
  if (res.status === 422) throw new GithubError('error', 422, 'GitHub refused this content (it may be locked, empty or invalid). Nothing was posted.')
  throw new GithubError('error', res.status, `GitHub answered ${res.status}. Nothing was confirmed.`)
}
