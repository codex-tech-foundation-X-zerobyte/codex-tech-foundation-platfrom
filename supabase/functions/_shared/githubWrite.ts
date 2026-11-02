/*
  Writing to GitHub on someone's behalf, as pure code (tested under Node in tests/githubWrite.test.mjs).

  The ORDER is the safety property and is what the tests pin down:
    1. validate the input (nothing is recorded for malformed requests)
    2. the credential must be the GitHub App (the shared personal token is never used to write: it would act as one person's account)
    3. ask the database whether THIS caller may do THIS to THIS repository; a refusal is recorded and GitHub is never called
    4. record the attempt (refuses a repeated request id and runaway rates) BEFORE calling GitHub
    5. call GitHub; success is claimed only when GitHub returned an id and a github.com link
    6. record the outcome, so a failure is visible in the audit trail too
*/
import { GithubError, isItemNumber, isRepoFullName } from './github.ts'

export const MAX_COMMENT_WRITE = 8_000
export const MAX_ISSUE_TITLE = 256
export const MAX_ISSUE_BODY = 8_000
export const isRequestId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export function validateComment(text: unknown): Checked<string> {
  if (typeof text !== 'string') return { ok: false, error: 'Write a comment first.' }
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length === 0) return { ok: false, error: 'Write a comment first.' }
  if (t.length > MAX_COMMENT_WRITE) return { ok: false, error: `Comments can be up to ${MAX_COMMENT_WRITE.toLocaleString('en-US')} characters.` }
  if (CONTROL.test(t)) return { ok: false, error: 'That comment contains characters GitHub does not accept.' }
  return { ok: true, value: t }
}
export function validateIssue(title: unknown, text: unknown): Checked<{ title: string; body: string }> {
  if (typeof title !== 'string' || title.trim().length === 0) return { ok: false, error: 'Give the issue a title.' }
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length > MAX_ISSUE_TITLE) return { ok: false, error: `Titles can be up to ${MAX_ISSUE_TITLE} characters.` }
  if (CONTROL.test(t)) return { ok: false, error: 'That title contains characters GitHub does not accept.' }
  const b = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : ''
  if (b.length > MAX_ISSUE_BODY) return { ok: false, error: `The description can be up to ${MAX_ISSUE_BODY.toLocaleString('en-US')} characters.` }
  if (CONTROL.test(b)) return { ok: false, error: 'That description contains characters GitHub does not accept.' }
  return { ok: true, value: { title: t, body: b } }
}

/** The App posts as itself, so every write says which person asked for it. The name is reduced to plain characters so it cannot inject markup or mentions. */
export const safeName = (name: unknown) => String(name ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'a Workspace member'
export const withSignature = (text: string, name: unknown) => `${text}\n\n---\n*Posted from Codex Workspace by ${safeName(name)}.*`

export type WriteAction = 'comment' | 'create_issue'
export interface WriteDeps {
  credentialSource: 'github_app' | 'personal_token'
  can(repo: string, capability: 'comment' | 'issue'): Promise<boolean>
  begin(a: { requestId: string; repo: string; action: WriteAction; target: number | null; denied?: boolean }): Promise<'ok' | 'denied' | 'duplicate' | 'rate_limited'>
  finish(requestId: string, outcome: 'success' | 'failed', detail: string, url: string | null): Promise<void>
  post(path: string, payload: unknown): Promise<unknown>
  displayName: string
}
export interface WriteInput { requestId: unknown; repo: unknown; action: WriteAction; number?: unknown; text?: unknown; title?: unknown }
export interface WriteResult { status: number; body: { ok?: true; url?: string; number?: number; error?: string; code?: string; warning?: string } }

const githubUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\/github\.com\//.test(u) ? u : null)

export async function runWrite(deps: WriteDeps, input: WriteInput): Promise<WriteResult> {
  if (!isRequestId(input.requestId)) return { status: 400, body: { error: 'This request is not valid. Reload the page and try again.' } }
  if (!isRepoFullName(input.repo)) return { status: 400, body: { error: 'Choose a repository.' } }
  const repo = input.repo
  const requestId = input.requestId

  let path: string, payload: Record<string, unknown>, capability: 'comment' | 'issue', target: number | null = null
  if (input.action === 'comment') {
    if (!isItemNumber(input.number)) return { status: 400, body: { error: 'That issue or pull request number is not valid.' } }
    const c = validateComment(input.text)
    if (!c.ok) return { status: 400, body: { error: c.error } }
    target = input.number; capability = 'comment'
    path = `/repos/${repo}/issues/${target}/comments`; payload = { body: withSignature(c.value, deps.displayName) }
  } else {
    const i = validateIssue(input.title, input.text)
    if (!i.ok) return { status: 400, body: { error: i.error } }
    capability = 'issue'
    path = `/repos/${repo}/issues`; payload = { title: i.value.title, body: withSignature(i.value.body, deps.displayName) }
  }

  if (deps.credentialSource !== 'github_app') {
    return { status: 409, body: { error: 'Writing to GitHub needs the GitHub App. Ask the Main Admin to connect it in Integrations.', code: 'app_required' } }
  }
  if (!(await deps.can(repo, capability))) {
    await deps.begin({ requestId, repo, action: input.action, target, denied: true })
    return { status: 403, body: { error: 'You are not allowed to do this for this repository.', code: 'not_allowed' } }
  }
  const started = await deps.begin({ requestId, repo, action: input.action, target })
  if (started === 'duplicate') return { status: 409, body: { error: 'This was already submitted. Check GitHub before trying again.', code: 'duplicate' } }
  if (started === 'rate_limited') return { status: 429, body: { error: 'You have made a lot of changes in a short time. Wait a few minutes and try again.', code: 'rate_limited' } }
  if (started !== 'ok') return { status: 403, body: { error: 'You are not allowed to do this for this repository.', code: 'not_allowed' } }

  let created: { id?: unknown; number?: unknown; html_url?: unknown }
  try {
    created = (await deps.post(path, payload)) as typeof created
  } catch (e) {
    const message = e instanceof GithubError ? e.message : 'GitHub could not be reached. Nothing was confirmed.'
    await deps.finish(requestId, 'failed', message, null).catch(() => {})
    const status = e instanceof GithubError ? (e.status === 429 ? 429 : e.status === 403 ? 403 : e.status === 404 ? 404 : e.status === 422 ? 422 : 502) : 502
    return { status, body: { error: message } }
  }
  const url = githubUrl(created?.html_url)
  if (typeof created?.id !== 'number' || !url) {
    await deps.finish(requestId, 'failed', 'GitHub did not confirm the change.', null).catch(() => {})
    return { status: 502, body: { error: 'GitHub did not confirm the change. Check GitHub before trying again.' } }
  }
  const number = typeof created.number === 'number' ? created.number : undefined
  try { await deps.finish(requestId, 'success', '', url) } catch {
    return { status: 200, body: { ok: true, url, number, warning: 'It was posted, but the record of it could not be saved.' } }
  }
  return { status: 200, body: { ok: true, url, number } }
}
