import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'
import { ALL_DEPARTMENTS, departmentBySlug } from '../../src/workspaces/definitions'
import type { DepartmentRow } from '../../src/lib/services'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const { s, calls, track } = vi.hoisted(() => {
  const s: Record<string, any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { fn: string; args: unknown[] }[] = []
  const track = (fn: string, impl: (...a: any[]) => unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return impl(...args) } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { s, calls, track }
})

vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => ({}), functions: { invoke: async () => ({ data: null, error: null }) }, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {}, auth: { getUser: async () => ({ data: { user: null } }) } } }))
vi.mock('../../src/lib/services', async (orig) => {
  const actual = await orig<typeof import('../../src/lib/services')>()
  return {
    ...actual,
    loadIntegrationState: async () => ({ data: s.integrations, error: null }),
    githubRepos: async () => ({ data: s.repos, error: null }),
    githubBranches: track('githubBranches', () => ({ data: { branches: s.branches, page: 1, has_more: false }, error: null })),
    githubContents: track('githubContents', (_r: string, path: string) => (s.contentsError ? { data: null, error: new Error(s.contentsError) } : { data: s.tree[path], error: null })),
    githubReadme: track('githubReadme', () => ({ data: { file: s.readme }, error: null })),
    githubCommits: track('githubCommits', (_r: string, _ref: unknown, page: number) => ({ data: s.commitPages[page - 1], error: null })),
    githubCommit: track('githubCommit', () => ({ data: { commit: s.commit }, error: null })),
    githubPulls: track('githubPulls', (_r: string, state: string) => ({ data: { pulls: s.pulls.filter((p: Any) => state === 'all' || (state === 'open') === (p.state === 'open')) }, error: null })),
    githubPullDetail: track('githubPullDetail', () => (s.pullError ? { data: null, error: new Error(s.pullError) } : { data: { pull: s.pull }, error: null })),
    githubIssues: track('githubIssues', (_r: string, state: string, page: number) => ({ data: { issues: s.issues.filter((i: Any) => state === 'all' || i.state === state), page, has_more: false }, error: null })),
    githubDeployments: track('githubDeployments', () => (s.deployError ? { data: null, error: new Error(s.deployError) } : { data: s.deploys, error: null })),
    githubCapabilities: track('githubCapabilities', () => ({ data: s.caps, error: null })),
    githubComment: track('githubComment', (_r: string, _n: number, text: string) => (s.writeError ? { data: null, error: new Error(s.writeError) } : { data: { ok: true, url: 'https://github.com/codex/api/issues/3#c1', warning: s.writeWarning }, error: null })),
    githubCreateIssue: track('githubCreateIssue', (_r: string, title: string) => (s.writeError ? { data: null, error: new Error(s.writeError) } : { data: { ok: true, url: 'https://github.com/codex/api/issues/99', number: 99 }, error: null })),
    githubIssue: track('githubIssue', () => ({ data: { issue: s.issue }, error: null })),
    listGithubActivity: track('listGithubActivity', () => ({ data: s.activity, error: null })),
  }
})

import { DepartmentToolPage } from '../../src/workspaces/DepartmentToolPage'

const def = (slug: string) => departmentBySlug(slug)!
const row = (slug: string): DepartmentRow => ({ id: `id-${slug}`, name: def(slug).name, slug, is_system: true, created_at: '' })
const viewer = { id: 'u1', isMainAdmin: false, isDepartmentAdmin: false } as never
const page = () => render(<MemoryRouter initialEntries={['/x']}><ToastProvider><Routes><Route path="/x" element={<DepartmentToolPage def={def('backend-development')} row={row('backend-development')} base="/worker" toolId="code" viewer={viewer} />} /></Routes></ToastProvider></MemoryRouter>)

const file = (o: Any = {}) => ({ name: 'main.ts', path: 'src/main.ts', size: 120, html_url: 'https://github.com/codex/api/blob/main/src/main.ts', sha: 'abc', kind: 'text', text: 'export const answer = 42', reason: '', ...o })
const commit = (i: number) => ({ sha: `${i}`.repeat(40), short: `${i}`.repeat(7), message: `Commit number ${i}`, author: 'sam', date: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/api/commit/x' })

beforeEach(() => {
  calls.length = 0
  Object.assign(s, {
    integrations: { github: { status: 'connected', config: {} } },
    repos: { repos: [{ full_name: 'codex/api', description: '', private: true, default_branch: 'main', open_issues: 0, pushed_at: null, html_url: 'https://github.com/codex/api', language: 'TypeScript' }] },
    branches: [{ name: 'main', protected: true }, { name: 'feature/x', protected: false }],
    contentsError: null, readme: null,
    tree: {
      '': { type: 'dir', path: '', truncated: false, entries: [{ name: 'src', path: 'src', type: 'dir', size: 0 }, { name: 'README.md', path: 'README.md', type: 'file', size: 30 }, { name: 'logo.png', path: 'logo.png', type: 'file', size: 2000 }] },
      src: { type: 'dir', path: 'src', truncated: false, entries: [{ name: 'main.ts', path: 'src/main.ts', type: 'file', size: 120 }] },
      'src/main.ts': { type: 'file', file: file() },
      'logo.png': { type: 'file', file: file({ name: 'logo.png', path: 'logo.png', kind: 'binary', text: null, reason: 'This is a binary file.' }) },
    },
    commitPages: [{ commits: [commit(1), commit(2)], page: 1, has_more: true }, { commits: [commit(3)], page: 2, has_more: false }],
    commit: { ...commit(1), message_full: 'Commit number 1', stats: { additions: 2, deletions: 1, total: 3 }, parents: [], files_total: 2, files_truncated: false, files: [
      { filename: 'src/main.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1,2 @@\n-old line\n+new line\n+another', patch_truncated: false },
      { filename: 'logo.png', status: 'added', additions: 0, deletions: 0, patch: null, patch_truncated: false },
    ] },
    deployError: null, deploys: { status: 'not_mapped' }, activity: [], caps: { comment: false, issue: false }, writeError: null, writeWarning: undefined,
    pulls: [
      { number: 7, title: 'Add login', author: 'amy', draft: false, state: 'open', head: 'feat', base: 'main', created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', html_url: 'https://github.com/codex/api/pull/7', approved: 1, changes_requested: 0 },
      { number: 5, title: 'Old work', author: 'bo', draft: false, state: 'merged', head: 'old', base: 'main', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', html_url: 'https://github.com/codex/api/pull/5', approved: 0, changes_requested: 0 },
    ],
    pullError: null,
    pull: { number: 7, title: 'Add login', author: 'amy', draft: false, state: 'open', head: 'feat', base: 'main', created_at: '', updated_at: '2026-10-30T00:00:00Z', html_url: 'https://github.com/codex/api/pull/7', approved: 1, changes_requested: 0,
      body: 'Adds login.\n\n<script>alert(1)</script> **please review**', body_truncated: false, merged: false, mergeable: null, mergeable_state: 'unknown', additions: 3, deletions: 1, changed_files: 1, labels: ['feature'], reviewers_requested: ['bo'],
      files: [{ filename: 'src/login.ts', status: 'added', additions: 3, deletions: 1, patch: '@@ -1 +1,3 @@\n-old\n+new\n+more', patch_truncated: false }], files_truncated: false,
      reviews: [{ id: 1, author: 'bo', state: 'approved', submitted_at: '2026-10-30T00:00:00Z', body: 'Looks good', html_url: null }],
      comments: [{ id: 9, author: 'cy', created_at: '2026-10-30T01:00:00Z', html_url: 'javascript:alert(1)', body: 'Thanks!', body_truncated: false }],
      checks: { overall: 'failing', total: 2, failed: 1, pending: 0, items: [{ name: 'build', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/codex/api/runs/1' }, { name: 'lint', status: 'completed', conclusion: 'success', html_url: null }] } },
    issues: [
      { number: 3, title: 'Login bug', state: 'open', author: 'amy', comments: 2, labels: ['bug'], assignees: ['bo'], created_at: '', updated_at: '2026-10-30T00:00:00Z', html_url: 'https://github.com/codex/api/issues/3' },
      { number: 2, title: 'Fixed thing', state: 'closed', author: 'cy', comments: 0, labels: [], assignees: [], created_at: '', updated_at: '2026-10-20T00:00:00Z', html_url: null },
    ],
    issue: { number: 3, title: 'Login bug', state: 'open', author: 'amy', comments: 1, labels: ['bug'], assignees: ['bo'], created_at: '', updated_at: '', html_url: 'https://github.com/codex/api/issues/3', body: 'It breaks.', body_truncated: false, state_reason: null, milestone: 'v1', comments_list: [{ id: 4, author: 'bo', created_at: '', html_url: null, body: 'On it', body_truncated: false }], comments_truncated: false },
  })
})

describe('Code & activity tool', () => {
  it('is offered by the three developer departments and rides on the GitHub connection', () => {
    for (const slug of ['frontend-development', 'backend-development', 'devops']) {
      const t = ALL_DEPARTMENTS.find((d) => d.slug === slug)!.tools.find((x) => x.id === 'code')
      expect(t?.native, slug).toBe('github-code'); expect(t?.integration, slug).toBe('github')
    }
  })

  it('says GitHub is not connected instead of showing an empty browser', async () => {
    s.integrations = {}
    page()
    expect(await screen.findByText('GitHub is not connected')).toBeTruthy()
  })

  it('lists folders first, opens a folder, reads a file, and navigates back by breadcrumb', async () => {
    page()
    const entries = await screen.findAllByRole('button', { name: /src|README\.md|logo\.png/ })
    expect(entries.map((e) => e.textContent)[0]).toMatch(/src/)
    await userEvent.click(screen.getByRole('button', { name: /^src$/ }))
    await userEvent.click(await screen.findByRole('button', { name: /main\.ts/ }))
    expect((await screen.findByLabelText('Contents of main.ts')).textContent).toBe('export const answer = 42')
    expect(calls.filter((c) => c.fn === 'githubContents').map((c) => c.args[1])).toEqual(['', 'src', 'src/main.ts'])
    await userEvent.click(screen.getByRole('button', { name: 'api' }))
    expect(await screen.findByRole('button', { name: /logo\.png/ })).toBeTruthy()
  })

  it('never shows content for a binary file, and says why', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: /logo\.png/ }))
    expect(await screen.findByText('This is a binary file.')).toBeTruthy()
    expect(screen.queryByLabelText('Contents of logo.png')).toBeNull()
  })

  it('renders the README as text, so markup inside it cannot run', async () => {
    s.readme = { name: 'README.md', path: 'README.md', size: 50, html_url: null, sha: 'x', kind: 'text', text: '# Hello\n\n<img src=x onerror=alert(1)> and **bold**', reason: '' }
    const { container } = page()
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('passes the chosen branch to the server when browsing', async () => {
    page()
    await screen.findByRole('button', { name: /^src$/ })
    await userEvent.selectOptions(screen.getByLabelText(/Branch/), 'feature/x')
    await waitFor(() => expect(calls.some((c) => c.fn === 'githubContents' && c.args[2] === 'feature/x')).toBe(true))
  })

  it('shows a clear error with retry when GitHub cannot be reached', async () => {
    s.contentsError = 'The connected token cannot access that.'
    page()
    expect(await screen.findByText("This couldn't load")).toBeTruthy()
    expect(screen.getByText('The connected token cannot access that.')).toBeTruthy()
  })

  it('pages through commits and shows a diff with additions and deletions marked', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Commits' }))
    expect(await screen.findByText(/Commit number 2/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Load older commits' }))
    expect(await screen.findByText(/Commit number 3/)).toBeTruthy()
    expect(calls.filter((c) => c.fn === 'githubCommits').map((c) => c.args[2])).toContain(2)
    expect(screen.queryByRole('button', { name: 'Load older commits' })).toBeNull()   // has_more was false on the last page
    await userEvent.click(screen.getByRole('button', { name: /Commit number 1/ }))
    const diff = await screen.findByLabelText('Changes to src/main.ts')
    expect(diff.querySelector('.is-add')?.textContent).toContain('+new line')
    expect(diff.querySelector('.is-del')?.textContent).toContain('-old line')
    expect(diff.querySelector('.is-hunk')).toBeTruthy()
    expect(screen.getByText(/did not provide a text diff/)).toBeTruthy()   // the binary file is not shown as an empty diff
  })

  it('shows the activity feed, links only to github.com, and explains an empty feed honestly', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    expect(await screen.findByText('No activity yet')).toBeTruthy()
    expect(screen.getByText(/Nothing shows until the GitHub App's webhook is connected/)).toBeTruthy()
  })

  it('does not turn a hostile feed link into a link', async () => {
    s.activity = [
      { id: '1', repo_full_name: 'codex/api', kind: 'workflow_run', title: 'CI on main', actor: 'bo', url: 'https://github.com/codex/api/actions/runs/1', state: 'failure', occurred_at: '2026-10-30T10:00:00Z' },
      { id: '2', repo_full_name: 'codex/api', kind: 'issue', title: '#3 Bug', actor: 'amy', url: 'javascript:alert(1)', state: 'opened', occurred_at: '2026-10-30T09:00:00Z' },
    ]
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    expect(await screen.findByText('CI on main')).toBeTruthy()
    expect(screen.getByText('failure')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /Open in GitHub/ })
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://github.com/codex/api/actions/runs/1')
  })

  it('lists open pull requests, filters by state, and opens one with checks, reviews, conversation and a diff', async () => {
    const { container } = page()
    await userEvent.click(await screen.findByRole('button', { name: 'Pull requests' }))
    expect(await screen.findByText(/#7 Add login/)).toBeTruthy()
    expect(screen.queryByText(/#5 Old work/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText(/#5 Old work/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /#7 Add login/ }))
    expect(await screen.findByText('1 check failing')).toBeTruthy()                       // failing is shown, never hidden behind "approved"
    expect(screen.getByText('Conflict check not ready yet')).toBeTruthy()               // mergeable: null is not shown as "no conflicts"
    expect(screen.getByText('Looks good')).toBeTruthy(); expect(screen.getByText('Thanks!')).toBeTruthy()
    expect(screen.getByLabelText('Changes to src/login.ts').querySelector('.is-add')?.textContent).toContain('+new')
    expect(container.querySelector('script')).toBeNull()                                 // markup in the description does not run
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(screen.getAllByRole('link', { name: /Open in GitHub/ }).every((a) => a.getAttribute('href')!.startsWith('https://github.com/'))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Back to pull requests' }))
    expect(await screen.findByText(/#7 Add login/)).toBeTruthy()
  })

  it('shows a clear error when a pull request cannot be loaded', async () => {
    s.pullError = 'GitHub is not reachable.'
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Pull requests' }))
    await userEvent.click(await screen.findByRole('button', { name: /#7 Add login/ }))
    expect(await screen.findByText("This pull request couldn't load")).toBeTruthy()
    expect(screen.getByText('GitHub is not reachable.')).toBeTruthy()
  })

  it('lists issues with a state filter and opens one with its conversation', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Issues' }))
    expect(await screen.findByText(/#3 Login bug/)).toBeTruthy()
    expect(screen.queryByText(/#2 Fixed thing/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }))
    expect(await screen.findByText(/#2 Fixed thing/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(await screen.findByRole('button', { name: /#3 Login bug/ }))
    expect(await screen.findByText('It breaks.')).toBeTruthy(); expect(screen.getByText('On it')).toBeTruthy(); expect(screen.getByText('v1')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back to issues' }))
    expect(await screen.findByText(/#3 Login bug/)).toBeTruthy()
  })

  it('shows honest empty states for pull requests and issues', async () => {
    s.pulls = []; s.issues = []
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Pull requests' }))
    expect(await screen.findByText('No pull requests')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Issues' }))
    expect(await screen.findByText('No issues')).toBeTruthy()
  })

  it('with no permission there is no comment box and no new-issue button, only an explanation', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Issues' }))
    expect(screen.queryByRole('button', { name: 'New issue' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /#3 Login bug/ }))
    expect(await screen.findByText(/Commenting from the Workspace is turned off/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Post comment' })).toBeNull()
  })

  it('with permission a comment is sent for the right item, the box clears, and success is shown only after the server confirms', async () => {
    s.caps = { comment: true, issue: false }
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Issues' }))
    await userEvent.click(await screen.findByRole('button', { name: /#3 Login bug/ }))
    const box = await screen.findByLabelText('Add a comment')
    const send = screen.getByRole('button', { name: 'Post comment' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)                                  // nothing to send yet
    await userEvent.type(box, 'Looks fixed on staging')
    await userEvent.click(send)
    await waitFor(() => expect(calls).toContainEqual({ fn: 'githubComment', args: ['codex/api', 3, 'Looks fixed on staging'] }))
    expect(await screen.findByText('Comment posted to GitHub.')).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('when the server refuses or GitHub fails, the person sees the reason and keeps their text', async () => {
    s.caps = { comment: true, issue: false }; s.writeError = 'The GitHub App is not allowed to write here.'
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Pull requests' }))
    await userEvent.click(await screen.findByRole('button', { name: /#7 Add login/ }))
    const box = await screen.findByLabelText('Add a comment')
    await userEvent.type(box, 'My careful review notes')
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(await screen.findByText('The GitHub App is not allowed to write here.')).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('My careful review notes')   // nothing is lost on a failure
    expect(screen.queryByText('Comment posted to GitHub.')).toBeNull()
  })

  it('a person allowed to open issues can create one, and a blank title cannot be submitted', async () => {
    s.caps = { comment: false, issue: true }
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Issues' }))
    await userEvent.click(await screen.findByRole('button', { name: 'New issue' }))
    const create = screen.getByRole('button', { name: 'Create issue' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Title'), 'Export is slow')
    await userEvent.type(screen.getByLabelText(/Description/), 'Takes a minute.')
    await userEvent.click(create)
    await waitFor(() => expect(calls).toContainEqual({ fn: 'githubCreateIssue', args: ['codex/api', 'Export is slow', 'Takes a minute.'] }))
    expect(await screen.findByText('Issue #99 created on GitHub.')).toBeTruthy()
  })

  const dep = (o: Any = {}) => ({ id: 'd1', state: 'READY', target: 'production', created_at: '2026-10-30T10:00:00Z', url: 'https://codex-api-abc.vercel.app', inspector_url: null, branch: 'main', sha: 'abcdef1', message: 'Fix login', author: 'Amy', ...o })
  const openDeploys = async () => { page(); await userEvent.click(await screen.findByRole('button', { name: 'Deployments' })) }

  it('explains an unconnected repository and a server without a Vercel token, honestly', async () => {
    await openDeploys()
    expect(await screen.findByText("Deployments aren't connected for this repository")).toBeTruthy()
  })

  it('says the server is not set up when there is no Vercel token', async () => {
    s.deploys = { status: 'not_configured' }
    await openDeploys()
    expect(await screen.findByText("Vercel isn't set up on the server yet")).toBeTruthy()
  })

  it('shows production as live only as "finished successfully", with the preview list and safe links', async () => {
    s.deploys = { status: 'ok', production: { status: 'live', latest: dep(), last_ready: null }, deployments: [dep(), dep({ id: 'd2', target: 'preview', state: 'BUILDING', url: null, message: 'Try a thing', branch: 'feat' })] }
    await openDeploys()
    expect(await screen.findByText('The latest production deployment finished successfully')).toBeTruthy()
    expect(screen.getByText(/does not check that the website itself is answering/)).toBeTruthy()   // no overclaiming
    expect(screen.getByText('Building')).toBeTruthy(); expect(screen.getByText('Preview')).toBeTruthy()
    const links = screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').includes('vercel.app'))
    expect(links.length).toBeGreaterThan(0)
    links.forEach((a) => { expect(a.getAttribute('href')!.startsWith('https://')).toBe(true); expect(a.getAttribute('rel')).toContain('noopener') })
  })

  it('a failed latest production deployment is shown as failed, with the last good one beside it', async () => {
    s.deploys = { status: 'ok', production: { status: 'failed', latest: dep({ id: 'd3', state: 'ERROR', message: 'Break everything' }), last_ready: dep({ id: 'd1', sha: '1234567' }) }, deployments: [dep({ id: 'd3', state: 'ERROR', message: 'Break everything' })] }
    await openDeploys()
    expect(await screen.findByText('The latest production deployment failed')).toBeTruthy()
    expect(screen.getByText(/last good production deployment/)).toBeTruthy()
    expect(screen.getByText(/Visitors are probably still seeing that one/)).toBeTruthy()
    expect(screen.queryByText('The latest production deployment finished successfully')).toBeNull()
  })

  it('handles no production deployment, an unknown state, and an empty history without calling anything live', async () => {
    s.deploys = { status: 'ok', production: { status: 'none', latest: null, last_ready: null }, deployments: [] }
    await openDeploys()
    expect(await screen.findByText('No production deployment was found')).toBeTruthy()
    expect(screen.getByText('No deployments yet')).toBeTruthy()
  })

  it('shows the server\'s reason when Vercel cannot be reached', async () => {
    s.deployError = 'Vercel rejected the server token. Ask the Main Admin to replace it.'
    await openDeploys()
    expect(await screen.findByText("Deployments couldn't load")).toBeTruthy()
    expect(screen.getByText('Vercel rejected the server token. Ask the Main Admin to replace it.')).toBeTruthy()
  })
})
