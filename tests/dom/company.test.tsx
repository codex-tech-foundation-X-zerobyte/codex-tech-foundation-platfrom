import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'
import { departmentBySlug } from '../../src/workspaces/definitions'
import type { DepartmentRow } from '../../src/lib/services'

type Any = Record<string, unknown>
const s: {
  role: string; id: string; detail: Any; records: Any[]; integrations: Any; approvals: Any; cases: Any[]; docs: Any[]; mine: Any | null
  events: Any[]; meeting: Any | null; repos: Any[]; linked: Any[]; depts: Any[]; policies?: Any[]; actions?: Any[]; targets?: Any[]; vercelOn?: boolean; report?: Any; reportError?: string | null
} = { role: 'worker', id: 'me', detail: {}, records: [], integrations: {}, approvals: {}, cases: [], docs: [], mine: null, events: [], meeting: null, repos: [], linked: [], depts: [], installs: { app_configured: false, installations: [] }, policies: [], actions: [], targets: [], vercelOn: false, report: null, reportError: null }
const calls: { fn: string; args: unknown[] }[] = []
const rec = (fn: string, result: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return result }

// The real service module is loaded for its pure helpers (link validation, etc.), so give it an inert client.
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => ({}), functions: { invoke: async () => ({ data: null, error: null }) }, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {}, auth: { getUser: async () => ({ data: { user: null } }) } } }))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: s.id, display_name: 'Me', role: s.role } }) }))
vi.mock('../../src/lib/services', async (orig) => {
  const actual = await orig<typeof import('../../src/lib/services')>()
  return {
    ...actual,
    // task drawer
    loadTaskDetail: async () => ({ data: s.detail, error: null }),
    setReviewState: (...a: unknown[]) => rec('setReviewState')(...a), setChecklistDone: (...a: unknown[]) => rec('setChecklistDone')(...a),
    addChecklistItem: (...a: unknown[]) => rec('addChecklistItem')(...a), removeChecklistItem: (...a: unknown[]) => rec('removeChecklistItem')(...a),
    addTaskComment: (...a: unknown[]) => rec('addTaskComment')(...a), addTaskLink: (...a: unknown[]) => rec('addTaskLink')(...a), removeTaskLink: (...a: unknown[]) => rec('removeTaskLink')(...a),
    addTaskDependency: (...a: unknown[]) => rec('addTaskDependency')(...a), removeTaskDependency: (...a: unknown[]) => rec('removeTaskDependency')(...a),
    setWatching: (...a: unknown[]) => rec('setWatching')(...a), moveTaskToStage: (...a: unknown[]) => rec('moveTaskToStage')(...a), uploadProjectFile: (...a: unknown[]) => rec('uploadProjectFile')(...a),
    getProjectFileUrl: async () => ({ url: 'https://files.example/x', error: null }),
    // approvals
    loadApprovals: async () => ({ data: s.approvals, error: null }), listSuspensionCases: async () => ({ data: s.cases, error: null }),
    decideSuspensionCase: (...a: unknown[]) => rec('decideSuspensionCase')(...a), setAssignmentStatus: (...a: unknown[]) => rec('setAssignmentStatus')(...a),
    // records, integrations, departments
    listRecords: async () => ({ data: s.records, error: null }), createRecord: (...a: unknown[]) => rec('createRecord')(...a), updateRecord: (...a: unknown[]) => rec('updateRecord')(...a), deleteRecord: (...a: unknown[]) => rec('deleteRecord')(...a),
    listDepartmentMembers: async () => ({ data: [{ user_id: 'u-sam', display_name: 'Samuel', position: '', status: 'active', department_role: 'member' }], error: null }),
    loadIntegrationState: async () => ({ data: s.integrations, error: null }),
    listDepartmentSummaries: async () => ({ data: { departments: s.depts, unassigned: 0 }, error: null }),
    getMyDepartment: async () => ({ data: s.mine, error: null }),
    // Multi-department: the same fixture, as a list (primary first). A null fixture means "in no department".
    getMyDepartments: async () => ({ data: s.mine?.department ? [{ department: s.mine.department, role: s.mine.role, isPrimary: true }] : [], error: null }),
    // knowledge
    listKnowledge: (...a: unknown[]) => { calls.push({ fn: 'listKnowledge', args: a }); return Promise.resolve({ data: s.docs, error: null }) },
    saveKnowledge: (...a: unknown[]) => rec('saveKnowledge')(...a), deleteKnowledge: (...a: unknown[]) => rec('deleteKnowledge')(...a),
    // calendar & meetings
    listCalendarEvents: async () => ({ data: s.events, error: null }), getMeeting: async () => ({ data: s.meeting, error: null }), listInvitablePeople: async () => ({ data: [{ id: 'u-ike', name: 'Ike' }, { id: 'u-sam', name: 'Samuel' }], error: null }),
    createMeeting: (...a: unknown[]) => rec('createMeeting')(...a), setActionItemDone: (...a: unknown[]) => rec('setActionItemDone')(...a), addActionItem: (...a: unknown[]) => rec('addActionItem')(...a), updateMeeting: (...a: unknown[]) => rec('updateMeeting')(...a), deleteMeeting: (...a: unknown[]) => rec('deleteMeeting')(...a),
    // integrations hub
    connectGithub: (...a: unknown[]) => rec('connectGithub', { data: { account: 'codex' }, error: null })(...a), disconnectGithub: (...a: unknown[]) => rec('disconnectGithub', { data: { ok: true }, error: null })(...a),
    githubAvailable: async () => ({ data: { repos: s.repos }, error: null }), githubInstallations: async () => ({ data: s.installs, error: null }), selectGithubInstallation: (...a: unknown[]) => rec('selectGithubInstallation', { data: { ok: true, account: 'codex' }, error: null })(...a), listLinkedRepositories: async () => ({ data: s.linked, error: null }), listGithubPolicies: async () => ({ data: s.policies, error: null }), setGithubRepoPolicy: (...a: unknown[]) => rec('setGithubRepoPolicy')(...a), listGithubActions: async () => ({ data: s.actions, error: null }), runConnectionCheck: (...a: unknown[]) => rec('runConnectionCheck', s.reportError ? { data: null, error: new Error(s.reportError) } : { data: s.report, error: null })(...a), listDeploymentTargets: async () => ({ data: s.targets, error: null }), vercelStatus: async () => ({ data: { configured: s.vercelOn }, error: null }), setDeploymentTarget: (...a: unknown[]) => rec('setDeploymentTarget')(...a), clearDeploymentTarget: (...a: unknown[]) => rec('clearDeploymentTarget')(...a),
    linkRepository: (...a: unknown[]) => rec('linkRepository')(...a), unlinkRepository: (...a: unknown[]) => rec('unlinkRepository')(...a),
    saveLaunchUrl: async (p: string, url: string | null) => { calls.push({ fn: 'saveLaunchUrl', args: [p, url] }); if (url) { const problem = actual.validateLaunchUrl(p as 'figma', url); if (problem) return { error: new Error(problem) } } return { error: null } },
  }
})

import { TaskDrawer } from '../../src/workspaces/TaskDrawer'
import { DepartmentToolPage } from '../../src/workspaces/DepartmentToolPage'
import { ApprovalsPage } from '../../src/pages/company/ApprovalsPage'
import { KnowledgePage } from '../../src/pages/company/KnowledgePage'
import { CalendarPage } from '../../src/workspaces/CalendarViews'
import { AdminIntegrations } from '../../src/pages/admin/AdminIntegrations'

const def = (slug: string) => departmentBySlug(slug)!
const row = (slug: string): DepartmentRow => ({ id: `id-${slug}`, name: def(slug).name, slug, is_system: true, created_at: '' })
const wrap = (ui: React.ReactNode, path = '/') => render(<MemoryRouter initialEntries={[path]}><ToastProvider>{ui}</ToastProvider></MemoryRouter>)
const task = (over: Any = {}) => ({ id: 't1', project_id: 'p1', project_name: 'Zerobyte', department_id: 'd', assignee_id: 'u-sam', assignee_name: 'Samuel', title: 'Build auth UI', description: 'Login and signup', status: 'in_progress', priority: 'high', stage: 'In development', due_date: '2026-10-20', review_state: 'none', created_by: 'u-admin', created_at: '', completed_at: null, ...over }) as never
const detail = (over: Any = {}) => ({ checklist: [], comments: [], dependencies: [], links: [], files: [], watching: false, ...over })
const STAGES = def('frontend-development').boards[0].stages
const viewer = (o: Any = {}) => ({ id: 'u-sam', isMainAdmin: false, isDepartmentAdmin: false, ...o }) as never

beforeEach(() => {
  calls.length = 0
  Object.assign(s, { role: 'worker', id: 'u-sam', detail: detail(), records: [], integrations: {}, approvals: { assignmentsToAccept: [], assignmentsInReview: [], tasksToReview: [], myChanges: [] }, cases: [], docs: [], mine: null, events: [], meeting: null, repos: [], linked: [], depts: [], installs: { app_configured: false, installations: [] }, policies: [], actions: [], targets: [], vercelOn: false, report: null, reportError: null })
})

describe('task drawer', () => {
  const open = (t = task(), v = viewer()) => wrap(<TaskDrawer task={t} stages={STAGES} siblings={[t, task({ id: 't2', title: 'Design tokens' })]} viewer={v} onChanged={() => {}} />)

  it('lets the assignee submit for review, and not approve their own work', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setReviewState', args: ['t1', 'requested'] }))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('lets a Department Admin approve or send back work that is waiting for review', async () => {
    open(task({ review_state: 'requested' }), viewer({ id: 'u-admin', isDepartmentAdmin: true }))
    expect(await screen.findByText('Waiting for review')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setReviewState', args: ['t1', 'changes_requested'] }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setReviewState', args: ['t1', 'approved'] }))
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
  })

  it('shows a colleague who is not the assignee a read-only task', async () => {
    open(task(), viewer({ id: 'someone-else' }))
    await screen.findByText('Build auth UI', { selector: 'p, span' }).catch(() => null)
    expect(await screen.findByText('Checklist')).toBeTruthy()
    for (const name of ['Submit for review', 'Approve', 'Link']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByLabelText('New checklist item')).toBeNull()
    expect(screen.queryByLabelText('Stage')).toBeNull()
    expect(screen.getByLabelText('Write a comment')).toBeTruthy() // anyone who can see the task can discuss it
  })

  it('builds and ticks a checklist, with progress shown', async () => {
    s.detail = detail({ checklist: [{ id: 'c1', body: 'Login form', done: true, position: 0 }, { id: 'c2', body: 'Validation', done: false, position: 1 }] })
    open()
    expect(await screen.findByText('1/2')).toBeTruthy()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Validation' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setChecklistDone', args: ['c2', true] }))
    await userEvent.type(screen.getByLabelText('New checklist item'), 'Write tests{enter}')
    await waitFor(() => expect(calls).toContainEqual({ fn: 'addChecklistItem', args: ['t1', 'Write tests', 2] }))
  })

  it('shows what blocks a task and lets people add another dependency from the same project', async () => {
    s.detail = detail({ dependencies: [{ depends_on_task_id: 't0', title: 'API contract', done: false }] })
    open()
    expect(await screen.findByText('API contract')).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Add a dependency'), 't2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1) as HTMLElement)
    await waitFor(() => expect(calls).toContainEqual({ fn: 'addTaskDependency', args: ['t1', 't2'] }))
  })

  it('links a GitHub pull request, comments, and toggles watching', async () => {
    s.detail = detail({ links: [{ id: 'l1', kind: 'pull_request', url: 'https://github.com/codex/web/pull/42', label: 'codex/web#42' }], comments: [{ id: 'k1', author_id: 'x', author_name: 'Ike', body: 'Looks good @Samuel', created_at: '2026-10-01T10:00:00Z' }] })
    open()
    expect(await screen.findByRole('link', { name: /codex\/web#42/ })).toBeTruthy()
    expect(screen.getByText('Looks good @Samuel')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('GitHub link'), 'https://github.com/codex/web/pull/43')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'addTaskLink', args: ['t1', 'https://github.com/codex/web/pull/43'] }))
    await userEvent.type(screen.getByLabelText('Write a comment'), 'On it')
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'addTaskComment', args: ['t1', 'On it'] }))
    await userEvent.click(screen.getByRole('button', { name: 'Watch' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setWatching', args: ['t1', 'u-sam', true] }))
  })
})

describe('approvals inbox', () => {
  const none = { assignmentsToAccept: [], assignmentsInReview: [], tasksToReview: [], myChanges: [] }
  const theCase = (o: Any = {}) => ({ id: 'case1', worker_user_id: 'w1', worker_name: 'Sarah Bello', department_id: 'd', department_name: 'Frontend Development', requested_by: 'a1', requester_name: 'Ike Okafor', reason: 'Repeated missed deadlines', evidence: 'Three in October', status: 'pending', decision_note: '', decided_at: null, created_at: '2026-10-05T09:00:00Z', events: [{ id: 'e1', actor_name: 'Ike Okafor', action: 'requested', note: 'Repeated missed deadlines', created_at: '2026-10-05T09:00:00Z' }], ...o })

  it('says so when nothing is waiting', async () => {
    s.approvals = none
    wrap(<ApprovalsPage />)
    expect(await screen.findByText("You're all caught up")).toBeTruthy()
  })

  it('a Department Admin accepts assignments and reviews tasks', async () => {
    s.approvals = { ...none, assignmentsToAccept: [{ id: 'a1', project_name: 'Zerobyte', department_name: 'Frontend Development', objective: 'Build the app', deadline: '2026-10-15' }], tasksToReview: [{ id: 't1', title: 'Auth UI', project_name: 'Zerobyte', assignee_name: 'Samuel', department_id: 'd' }] }
    wrap(<ApprovalsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a1', 'accepted'] }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setReviewState', args: ['t1', 'approved'] }))
  })

  it('only the Main Admin signs off department work', async () => {
    s.approvals = { ...none, assignmentsInReview: [{ id: 'a2', project_name: 'Zerobyte', department_name: 'Backend Development', objective: 'API' }] }
    const first = wrap(<ApprovalsPage />)
    await screen.findByText("You're all caught up").catch(() => null)
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull()
    first.unmount()
    s.role = 'superadmin'
    wrap(<ApprovalsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Mark completed' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a2', 'completed'] }))
  })

  it('shows a Department Admin their case is waiting, with no decision buttons', async () => {
    s.cases = [theCase()]
    wrap(<ApprovalsPage />)
    expect(await screen.findByText('Sarah Bello')).toBeTruthy()
    expect(screen.getByText('Waiting for a Main Admin to decide.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore worker' })).toBeNull()
  })

  it('lets the Main Admin restore, continue, review or offboard, with a note, and offboarding asks twice', async () => {
    s.role = 'superadmin'; s.cases = [theCase()]
    wrap(<ApprovalsPage />)
    expect(await screen.findByText('Repeated missed deadlines', { selector: 'dd' })).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Decision note for Sarah Bello'), 'Cleared after talking')
    await userEvent.click(screen.getByRole('button', { name: 'Restore worker' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'decideSuspensionCase', args: ['case1', 'restored', 'Cleared after talking'] }))
    calls.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Offboard worker' }))
    expect(calls.filter((c) => c.fn === 'decideSuspensionCase')).toHaveLength(0) // one click is not enough
    await userEvent.click(screen.getByRole('button', { name: 'Confirm offboard' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'decideSuspensionCase')?.args.slice(0, 2)).toEqual(['case1', 'offboarded']))
  })

  it('does not offer the status a case is already in, and keeps closed cases as history', async () => {
    s.role = 'superadmin'; s.cases = [theCase({ status: 'suspended' }), theCase({ id: 'case2', worker_name: 'Old Case', status: 'restored', decision_note: 'Cleared' })]
    wrap(<ApprovalsPage />)
    await screen.findByText('Sarah Bello')
    expect(screen.queryByRole('button', { name: 'Continue suspension' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Move to review' })).toBeTruthy()
    expect(screen.getByText('Earlier cases')).toBeTruthy()
    expect(screen.getByText('Old Case')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Restore worker' })).toHaveLength(1) // only the open case can be decided
  })

  it('shows a worker the tasks sent back to them', async () => {
    s.approvals = { ...none, myChanges: [{ id: 't9', title: 'Fix header', project_name: 'Zerobyte' }] }
    wrap(<ApprovalsPage />)
    expect(await screen.findByText('Sent back to you')).toBeTruthy()
    expect(screen.getByText('Fix header')).toBeTruthy()
  })
})

describe('department tool pages', () => {
  const page = (slug: string, toolId: string, v = viewer(), base: '/worker' | '/admin' = '/worker') =>
    wrap(<Routes><Route path="/x" element={<DepartmentToolPage def={def(slug)} row={row(slug)} base={base} toolId={toolId} viewer={v} />} /><Route path="*" element={<p>redirected</p>} /></Routes>, '/x')

  it('the Frontend bug tracker starts empty and files a real bug', async () => {
    page('frontend-development', 'bugs')
    expect(await screen.findByText('No bugs yet')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: 'New bug' })[0])
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Login button misaligned')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Severity is required.')
    expect(calls.some((c) => c.fn === 'createRecord')).toBe(false)
    await userEvent.selectOptions(within(dialog).getByLabelText(/Severity/), 'High')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createRecord')?.args[0]).toMatchObject({ department_id: 'id-frontend-development', kind: 'bug', title: 'Login button misaligned', stage: 'Reported', fields: { severity: 'High' } }))
  })

  it('hides finished items until asked, filters by stage, and lets members move their own', async () => {
    s.records = [
      { id: 'r1', kind: 'bug', department_id: 'd', title: 'Open bug', stage: 'Triaged', fields: { severity: 'Low' }, assignee_id: null, assignee_name: null, due_date: null, created_by: 'u-sam', created_at: '2026-10-01T00:00:00Z' },
      { id: 'r2', kind: 'bug', department_id: 'd', title: 'Old fixed bug', stage: 'Verified', fields: { severity: 'Low' }, assignee_id: null, assignee_name: null, due_date: null, created_by: 'u-sam', created_at: '2026-09-01T00:00:00Z' },
    ]
    page('frontend-development', 'bugs')
    expect(await screen.findByText('Open bug')).toBeTruthy()
    expect(screen.queryByText('Old fixed bug')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: /Show 1 finished/ }))
    expect(await screen.findByText('Old fixed bug')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Stage of Open bug'), 'In progress')
    await waitFor(() => expect(calls).toContainEqual({ fn: 'updateRecord', args: ['r1', { stage: 'In progress' }] }))
  })

  it('does not let someone move a record they did not file and are not assigned', async () => {
    s.records = [{ id: 'r1', kind: 'bug', department_id: 'd', title: 'Not mine', stage: 'Reported', fields: {}, assignee_id: null, assignee_name: null, due_date: null, created_by: 'someone-else', created_at: '2026-10-01T00:00:00Z' }]
    page('frontend-development', 'bugs')
    await screen.findByText('Not mine')
    expect(screen.queryByLabelText('Stage of Not mine')).toBeNull()
  })

  it('the Content script tool shows only scripts and opens the structured script editor', async () => {
    const base = { department_id: 'd', stage: 'Idea', assignee_id: null, assignee_name: null, due_date: null, created_by: 'u-sam', created_at: '2026-10-01T00:00:00Z' }
    s.records = [{ ...base, id: 'a', kind: 'content_item', title: 'Launch script', fields: { content_type: 'Script' } }, { ...base, id: 'b', kind: 'content_item', title: 'Blog article', fields: { content_type: 'Article' } }]
    page('content', 'script')
    expect(await screen.findByText('Launch script')).toBeTruthy()
    expect(screen.queryByText('Blog article')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'New content' }))
    const dialog = await screen.findByRole('dialog')
    for (const label of ['Hook', 'Introduction', 'Main point', 'Supporting points', 'Call to action', 'Caption', 'Hashtags']) expect(within(dialog).getByLabelText(new RegExp(label))).toBeTruthy()
    expect(within(dialog).queryByLabelText('Body')).toBeNull()
    await userEvent.selectOptions(within(dialog).getByLabelText(/Type/), 'Article')
    expect(within(dialog).getByLabelText('Body')).toBeTruthy()
    expect(within(dialog).queryByLabelText('Hook')).toBeNull()
  })

  it('the domain watch list warns about expiry', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    s.records = [{ id: 'd1', kind: 'domain', department_id: 'd', title: 'codex.dev', stage: 'Watching', fields: { domain: 'codex.dev', expires_on: soon }, assignee_id: null, assignee_name: null, due_date: null, created_by: 'u-sam', created_at: '2026-10-01T00:00:00Z' }]
    page('devops', 'domains')
    expect(await screen.findByText(/Domain expires: expires in 10 days/)).toBeTruthy()
  })

  it('"Open in Figma" explains what is missing, and opens the real link once configured', async () => {
    const first = page('ui-ux-design', 'figma', viewer({ isMainAdmin: true }), '/admin')
    expect(await screen.findByText("Open in Figma isn't set up")).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open Integrations/ }).getAttribute('href')).toBe('/admin/integrations')
    first.unmount()
    s.integrations = { figma: { status: 'connected', config: { url: 'https://www.figma.com/files/team/9' } } }
    page('ui-ux-design', 'figma')
    const link = await screen.findByRole('link', { name: /Open Figma/ })
    expect(link.getAttribute('href')).toBe('https://www.figma.com/files/team/9')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('knowledge and built-in tools hand over to the page that already exists', async () => {
    page('frontend-development', 'docs')
    expect(await screen.findByText('redirected')).toBeTruthy()
  })

  it('an unknown tool says so instead of rendering nothing', async () => {
    page('frontend-development', 'nope')
    expect(await screen.findByText("That tool doesn't exist")).toBeTruthy()
  })
})

describe('knowledge base', () => {
  const doc = (o: Any = {}) => ({ id: 'k1', title: 'Code of conduct', category: 'Policies', department_id: null, body: '# Be kind\n\nAlways.', author_id: 'a', author_name: 'Ada', updated_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', ...o })
  const own = { id: 'id-frontend-development', name: 'Frontend Development', slug: 'frontend-development', is_system: true, created_at: '', workerCount: 0, admins: [] }

  it('lists documents, renders the selected one, and gives a plain worker no way to write', async () => {
    s.docs = [doc()]; s.depts = [own]; s.mine = { department: own, role: 'member' }
    wrap(<KnowledgePage />)
    await userEvent.click(await screen.findByRole('button', { name: /Code of conduct/ }))
    expect(await screen.findByRole('heading', { name: 'Be kind' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('has honest empty states that differ by role', async () => {
    s.depts = [own]; s.mine = { department: own, role: 'member' }
    const first = wrap(<KnowledgePage />)
    expect(await screen.findByText('Documents your Department Admins and the Main Admin publish will appear here.')).toBeTruthy()
    first.unmount()
    s.mine = { department: own, role: 'admin' }
    wrap(<KnowledgePage />)
    expect(await screen.findByText('Write the first document: a policy, a runbook, a standard.')).toBeTruthy()
  })

  it('a Department Admin publishes only into their own department, a Main Admin can address the company', async () => {
    s.depts = [own, { ...own, id: 'id-devops', name: 'DevOps', slug: 'devops' }]; s.mine = { department: own, role: 'admin' }
    const first = wrap(<KnowledgePage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'New document' }))[0])
    let dialog = await screen.findByRole('dialog')
    const scope = within(dialog).getByLabelText(/Who can read it/) as HTMLSelectElement
    expect([...scope.options].map((o) => o.textContent)).toEqual(['Frontend Development'])
    expect(scope.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Release checklist')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'saveKnowledge')?.args[0]).toMatchObject({ title: 'Release checklist', department_id: 'id-frontend-development' }))
    first.unmount(); calls.length = 0
    s.role = 'superadmin'; s.mine = null
    wrap(<KnowledgePage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'New document' }))[0])
    dialog = await screen.findByRole('dialog')
    const scope2 = within(dialog).getByLabelText(/Who can read it/) as HTMLSelectElement
    expect([...scope2.options].map((o) => o.textContent)).toEqual(['Whole company', 'Frontend Development', 'DevOps'])
  })

  it('searches after a short pause rather than on every keystroke', async () => {
    s.depts = [own]; s.mine = { department: own, role: 'member' }
    wrap(<KnowledgePage />)
    await screen.findByLabelText('Search the knowledge base')
    calls.length = 0
    await userEvent.type(screen.getByLabelText('Search the knowledge base'), 'deploy')
    await waitFor(() => expect(calls.some((c) => (c.args[0] as Any)?.q === 'deploy')).toBe(true))
    expect(calls.filter((c) => c.fn === 'listKnowledge' && (c.args[0] as Any)?.q && (c.args[0] as Any).q !== 'deploy').length).toBe(0) // no query for 'd', 'de', 'dep'…
  })
})

describe('calendar', () => {
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const ev = (o: Any) => ({ detail: '', ...o })

  it('shows dated items from every source and lets people filter them', async () => {
    s.events = [ev({ id: 'm:1', date: `${ym}-15`, time: '10:00', title: 'Stand-up', group: 'meeting', detail: 'Room 1' }), ev({ id: 't:1', date: `${ym}-15`, title: 'Build login', group: 'task' }), ev({ id: 'a:1', date: `${ym}-20`, title: 'Zerobyte', group: 'deadline' })]
    wrap(<CalendarPage />)
    await userEvent.click(await screen.findByRole('gridcell', { name: new RegExp(`${now.toLocaleString('en', { month: 'long' })} 15.*2 items`) }))
    expect(await screen.findByText('Stand-up')).toBeTruthy()
    expect(screen.getByText('Build login')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    await waitFor(() => expect(screen.queryByText('Build login')).toBeNull())
    expect(screen.getByText('Stand-up')).toBeTruthy()
  })

  it('opens a meeting with its agenda, participants and action items, and ticks one off', async () => {
    s.events = [ev({ id: 'm:abc', date: `${ym}-15`, time: '10:00', title: 'Launch review', group: 'meeting' })]
    s.meeting = { id: 'abc', title: 'Launch review', starts_at: `${ym}-15T10:00:00`, ends_at: `${ym}-15T11:00:00`, location: 'Room 1', agenda: 'Blockers first', notes: '', recording_url: '', created_by: 'someone', project_id: null, department_id: null, participants: [{ user_id: 'u-sam', name: 'Samuel' }], actions: [{ id: 'ai1', body: 'Fix flaky test', assignee_id: 'u-sam', assignee_name: 'Samuel', due_date: null, done: false }] }
    wrap(<CalendarPage />)
    await userEvent.click(await screen.findByRole('gridcell', { name: new RegExp(`${now.toLocaleString('en', { month: 'long' })} 15`) }))
    await userEvent.click(await screen.findByRole('button', { name: 'Launch review' }))
    expect(await screen.findByText('Blockers first')).toBeTruthy()
    expect(screen.getByText('Samuel', { selector: 'p' })).toBeTruthy()
    await userEvent.click(screen.getByRole('checkbox', { name: /Fix flaky test/ }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setActionItemDone', args: ['ai1', true] }))
    expect(screen.getByLabelText('Meeting notes').hasAttribute('disabled')).toBe(true) // not the organiser
  })

  it('schedules a meeting with the chosen invitees, never inviting yourself', async () => {
    wrap(<CalendarPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'New meeting' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Planning')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Ike' }))
    expect(within(dialog).queryByRole('checkbox', { name: 'Samuel' })).toBeNull() // that is you
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createMeeting')?.args[0]).toMatchObject({ title: 'Planning', participants: ['u-ike'] }))
  })
})

describe('integrations hub', () => {
  const as = () => { s.role = 'superadmin'; return wrap(<AdminIntegrations />) }

  it('connects GitHub with a pasted token, never shows it back, and clears the field', async () => {
    as()
    const input = (await screen.findByLabelText('Access token')) as HTMLInputElement
    expect(input.type).toBe('password')
    const connect = screen.getByRole('button', { name: 'Connect GitHub' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    await userEvent.type(input, 'github_pat_abcdefghijklmnopqrstuvwxyz')
    await userEvent.click(connect)
    await waitFor(() => expect(calls).toContainEqual({ fn: 'connectGithub', args: ['github_pat_abcdefghijklmnopqrstuvwxyz'] }))
    await waitFor(() => expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe(''))
    expect(document.body.textContent).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz')
  })

  it('GitHub App: explains the server secrets when the App is not set up, and never offers an installation that is not there', async () => {
    as()
    const appPanel = within((await screen.findByText('GitHub App', { selector: 'p' })).closest('section') as HTMLElement)
    expect(await appPanel.findByText(/GITHUB_APP_PRIVATE_KEY/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this installation' })).toBeNull()
  })

  it('GitHub App: lists installations, offers only usable ones, and selecting one calls the server', async () => {
    s.installs = { app_configured: true, installations: [
      { installation_id: 11, account_login: 'codex-tech', account_type: 'Organization', repository_selection: 'selected', suspended: false, removed: false },
      { installation_id: 12, account_login: 'old-org', account_type: 'Organization', repository_selection: 'all', suspended: true, removed: false },
      { installation_id: 13, account_login: 'gone-org', account_type: 'Organization', repository_selection: 'all', suspended: false, removed: true },
    ] }
    as()
    expect(await screen.findByText('codex-tech')).toBeTruthy()
    expect(screen.getByText('Suspended')).toBeTruthy(); expect(screen.getByText('Removed')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Use this installation' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    await waitFor(() => expect(calls).toContainEqual({ fn: 'selectGithubInstallation', args: [11] }))
  })

  it('GitHub App: when connected through the App it says so, marks the active installation, and offers no switch to it', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech', auth: 'github_app', installation_id: 11 } } }
    s.installs = { app_configured: true, installations: [{ installation_id: 11, account_login: 'codex-tech', account_type: 'Organization', repository_selection: 'selected', suspended: false, removed: false }] }
    as()
    expect(await screen.findByText(/Connected through the GitHub App/)).toBeTruthy()
    expect(await screen.findByText('In use')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this installation' })).toBeNull()
    expect(screen.queryByText(/shared personal token/)).toBeNull()
  })

  it('write access: every linked repository starts Off, and the controls are locked until the GitHub App is connected', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'me', auth: 'personal_token' } } }
    s.linked = [{ id: 'r1', full_name: 'codex/api', department_id: null, project_id: null }]
    as()
    const group = await screen.findByRole('group', { name: 'Write access for codex/api' })
    const selects = group.querySelectorAll('select')
    expect(selects).toHaveLength(2)
    selects.forEach((sel) => { expect((sel as HTMLSelectElement).value).toBe('off'); expect((sel as HTMLSelectElement).disabled).toBe(true) })
    expect(screen.getByText(/Writing needs the GitHub App connection/)).toBeTruthy()
  })

  it('write access: with the App connected the Main Admin can change a level, and the change is sent for that repository only', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech', auth: 'github_app', installation_id: 11 } } }
    s.installs = { app_configured: true, installations: [] }
    s.linked = [{ id: 'r1', full_name: 'codex/api', department_id: null, project_id: null }, { id: 'r2', full_name: 'codex/web', department_id: null, project_id: null }]
    s.policies = [{ repo_full_name: 'codex/web', comment_level: 'members', issue_level: 'off' }]
    as()
    const api = await screen.findByRole('group', { name: 'Write access for codex/api' })
    const web = screen.getByRole('group', { name: 'Write access for codex/web' })
    expect((web.querySelectorAll('select')[0] as HTMLSelectElement).value).toBe('members')   // reflects the stored policy
    expect((api.querySelectorAll('select')[0] as HTMLSelectElement).value).toBe('off')       // an unconfigured repository is off, not inherited
    await userEvent.selectOptions(api.querySelectorAll('select')[1] as HTMLSelectElement, 'admins')
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setGithubRepoPolicy', args: ['codex/api', 'off', 'admins'] }))
    expect(calls.some((c) => c.fn === 'setGithubRepoPolicy' && c.args[0] === 'codex/web')).toBe(false)
  })

  it('the history of GitHub changes shows who did what, including refused attempts, and says plainly when there is none', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech', auth: 'github_app', installation_id: 11 } } }
    s.installs = { app_configured: true, installations: [] }
    as()
    expect(await screen.findByText('Nothing has been posted from the Workspace yet.')).toBeTruthy()
  })

  it('the history lists actions with their outcome', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech', auth: 'github_app', installation_id: 11 } } }
    s.installs = { app_configured: true, installations: [] }
    s.actions = [
      { id: 'a1', actor: 'Amy', actor_id: 'u1', repo_full_name: 'codex/api', action: 'comment', target: 12, outcome: 'success', detail: '', result_url: null, created_at: '2026-10-30T10:00:00Z' },
      { id: 'a2', actor: 'Bo', actor_id: 'u2', repo_full_name: 'codex/api', action: 'create_issue', target: null, outcome: 'denied', detail: 'Not allowed for this repository.', result_url: null, created_at: '2026-10-30T11:00:00Z' },
    ]
    as()
    expect(await screen.findByText(/Amy · comment on #12/)).toBeTruthy()
    expect(screen.getByText(/Bo · new issue/)).toBeTruthy()
    expect(screen.getByText('success')).toBeTruthy(); expect(screen.getByText('denied')).toBeTruthy()
  })

  it('deployments: the Main Admin connects a repository to a Vercel project, and is told when the server token is missing', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'me', auth: 'personal_token' } } }
    s.linked = [{ id: 'r1', full_name: 'codex/api', department_id: null, project_id: null }]
    as()
    expect(await screen.findByText(/Vercel status is not switched on yet/)).toBeTruthy()      // the warning itself, not just any mention of the secret name
    const group = await screen.findByRole('group', { name: 'Vercel project for codex/api' })
    const save = screen.getByRole('button', { name: 'Connect deployments' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)                                   // nothing to save without a project
    await userEvent.type(group.querySelector('input') as HTMLInputElement, 'codex-api')
    await userEvent.type(screen.getByLabelText(/Vercel team/), 'team_abc')
    await userEvent.click(save)
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setDeploymentTarget', args: ['codex/api', 'codex-api', 'team_abc'] }))
  })

  it('deployments: an existing connection is shown, can be updated, and can be disconnected', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'me', auth: 'personal_token' } } }
    s.vercelOn = true
    s.linked = [{ id: 'r1', full_name: 'codex/api', department_id: null, project_id: null }]
    s.targets = [{ repo_full_name: 'codex/api', provider: 'vercel', project_ref: 'codex-api', team_ref: null }]
    as()
    const group = await screen.findByRole('group', { name: 'Vercel project for codex/api' })
    expect((group.querySelector('input') as HTMLInputElement).value).toBe('codex-api')
    expect(screen.queryByText(/Vercel status is not switched on yet/)).toBeNull()               // token is set, so no warning
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'clearDeploymentTarget', args: ['codex/api'] }))
  })

  it('connection check: nothing is claimed until it is run, and the check is offered before GitHub is even connected', async () => {
    as()
    expect(await screen.findByRole('button', { name: 'Run the check' })).toBeTruthy()
    expect(screen.queryByText('All clear')).toBeNull()
    expect(calls.some((c) => c.fn === 'runConnectionCheck')).toBe(false)   // it never runs on its own: it calls GitHub and Vercel
  })

  it('connection check: shows each finding with what to do, an honest overall verdict, and never a green light for what was skipped', async () => {
    s.report = { checked_at: '2026-11-01T12:00:00Z', overall: { status: 'fail', failed: 2, warned: 1 }, checks: [
      { id: 'secret-key', group: 'server', label: 'GITHUB_APP_PRIVATE_KEY', status: 'ok', detail: 'Set and readable.' },
      { id: 'app-read', group: 'github', label: 'App permissions (read)', status: 'fail', detail: 'The App is missing: checks (read). In the App\u2019s settings, set each to Read-only.' },
      { id: 'webhook', group: 'github', label: 'Webhook deliveries', status: 'fail', detail: 'None of the last 3 deliveries succeeded (status 401). The receiver refused the signature.' },
      { id: 'app-events', group: 'github', label: 'App webhook events', status: 'warn', detail: 'Not subscribed to: workflow run.' },
      { id: 'installation', group: 'github', label: 'Installation', status: 'skipped', detail: 'No installation is selected yet.' },
      { id: 'migrations', group: 'database', label: 'Database migrations', status: 'ok', detail: 'Every GitHub table is present.' },
    ] }
    as()
    await userEvent.click(await screen.findByRole('button', { name: 'Run the check' }))
    expect(await screen.findByText('Something needs fixing before this will work.')).toBeTruthy()
    const panel = within(screen.getByText('Connection check').closest('section') as HTMLElement)
    expect(panel.getByText(/missing: checks \(read\)/)).toBeTruthy()
    expect(panel.getByText(/refused the signature/)).toBeTruthy()
    expect(panel.getByText('Server settings')).toBeTruthy(); expect(panel.getByText('GitHub')).toBeTruthy(); expect(panel.getByText('Database')).toBeTruthy()
    expect(panel.queryByText('Vercel')).toBeNull()                                              // a group with no findings is not shown
    expect(panel.getAllByText('Needs fixing').length).toBeGreaterThanOrEqual(3)               // overall badge + two failures
    expect(panel.getByText('Check this', { selector: 'span' })).toBeTruthy()                 // the warning
    const skipped = panel.getByText('Installation').closest('li')!
    expect(skipped.textContent).toContain('Not checked'); expect(skipped.textContent).not.toContain('OK')
    expect(screen.getByRole('button', { name: 'Run the check again' })).toBeTruthy()
    expect(calls.filter((c) => c.fn === 'runConnectionCheck')).toHaveLength(1)
  })

  it('connection check: an all-clear says so only when every finding that ran is fine', async () => {
    s.report = { checked_at: '2026-11-01T12:00:00Z', overall: { status: 'ok', failed: 0, warned: 0 }, checks: [{ id: 'migrations', group: 'database', label: 'Database migrations', status: 'ok', detail: 'Every GitHub table is present.' }] }
    as()
    await userEvent.click(await screen.findByRole('button', { name: 'Run the check' }))
    expect(await screen.findByText('All clear')).toBeTruthy()
  })

  it('connection check: if the check itself cannot run, the reason is shown and no verdict is invented', async () => {
    s.reportError = 'The integration service is unavailable.'
    as()
    await userEvent.click(await screen.findByRole('button', { name: 'Run the check' }))
    expect(await screen.findByText('The integration service is unavailable.')).toBeTruthy()
    expect(screen.queryByText('All clear')).toBeNull(); expect(screen.queryByText('Something needs fixing before this will work.')).toBeNull()
  })

  it('setup guide: sits in the GitHub card from the start, claims nothing, and updates from the connection check', async () => {
    as()
    expect(await screen.findByText(/Setup guide — 0 of 10 required steps done/)).toBeTruthy()
    expect(screen.queryByText('Done')).toBeNull()
    s.report = { checked_at: '2026-11-01T12:00:00Z', overall: { status: 'fail', failed: 1, warned: 0 }, checks: [{ id: 'migrations', group: 'database', label: 'Database migrations', status: 'ok', detail: 'Every GitHub table is present.' }] }
    await userEvent.click(screen.getByRole('button', { name: 'Run the check' }))
    expect(await screen.findByText(/Setup guide — 1 of 10 required steps done/)).toBeTruthy()
    expect(screen.getByText('Run the three database files').closest('summary')!.textContent).toContain('Done')
  })

  it('setup guide: is also shown once GitHub is connected, collapsed content still reachable', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech', auth: 'github_app', installation_id: 11 } } }
    s.installs = { app_configured: true, installations: [] }
    as()
    expect(await screen.findByText(/Setup guide — \d+ of 10 required steps done/)).toBeTruthy()
    expect(screen.getByText('Create the GitHub App')).toBeTruthy()
  })

  it('when connected: names the account, offers no token field, links repositories to departments, and disconnects', async () => {
    s.integrations = { github: { status: 'connected', config: { account: 'codex-tech' } } }
    s.repos = [{ full_name: 'codex/web', private: true }]; s.depts = [{ id: 'd1', name: 'Frontend Development', slug: 'frontend-development', workerCount: 0, admins: [] }]
    s.linked = [{ id: 'lk1', full_name: 'codex/infra', department_id: 'd1', project_id: null }]
    as()
    expect(await screen.findByText('codex-tech')).toBeTruthy()
    expect(screen.queryByLabelText('Access token')).toBeNull()
    expect(await screen.findByText('codex/infra')).toBeTruthy() // the linked-repository list loads separately
    await userEvent.click(await screen.findByRole('button', { name: 'Choose from my GitHub repositories' }))
    await userEvent.selectOptions(await screen.findByLabelText('Repository'), 'codex/web')
    await userEvent.selectOptions(await screen.findByLabelText('Department'), 'd1')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'linkRepository', args: ['codex/web', 'd1', null] }))
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'unlinkRepository', args: ['lk1'] }))
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }))
    await waitFor(() => expect(calls.some((c) => c.fn === 'disconnectGithub')).toBe(true))
  })

  it('tells the Main Admin when GitHub has rejected the saved token', async () => {
    s.integrations = { github: { status: 'needs_authorization', config: {} } }
    as()
    expect((await screen.findByRole('alert')).textContent).toMatch(/rejected the saved token/)
  })

  it('accepts only the provider\'s own domain for Figma and Canva links', async () => {
    as()
    const figma = await screen.findByLabelText(/Figma team link/)
    await userEvent.type(figma, 'https://evil.example/figma.com')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(calls).toContainEqual({ fn: 'saveLaunchUrl', args: ['figma', 'https://evil.example/figma.com'] }))
    expect(await screen.findByText('That is not a Figma link.')).toBeTruthy()
  })
})

