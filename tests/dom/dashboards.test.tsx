import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const iso = (offsetDays: number) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const task = (o: Record<string, unknown>) => ({ id: String(Math.random()), project_id: 'p1', title: 'Task', status: 'todo', priority: 'medium', due_date: null, assignee_id: 'me', completed_at: null, description: '', ...o })

let role = 'worker'
const D: Record<string, any> = {}
const toasts: { message: string; tone?: string }[] = []
const calls: Record<string, unknown[]> = {}
const rec = (k: string, v: unknown) => { (calls[k] ??= []).push(v) }
let completeResult: { error: Error | null } = { error: null }

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Ada Lovelace', role } }) }))
vi.mock('../../src/components/PresenceProvider', () => ({ usePresence: () => ({ onlineIds: new Set(['u2']), statusOf: () => 'online' }) }))
vi.mock('../../src/components/ChatActivityProvider', () => ({ useChatActivity: () => ({ totalUnread: 2, unread: {}, setActiveChannel: () => {} }) }))
vi.mock('../../src/hooks/useUnreadCount', () => ({ useUnreadCount: () => ({ count: 1, refresh: () => {} }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => ({ select: () => Promise.resolve({ error: null }) }), functions: { invoke: () => Promise.resolve({ error: null }) } } }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (message: string, tone?: string) => toasts.push({ message, tone }) }) }))
vi.mock('../../src/lib/services', () => ({
  listTasks: async () => ({ data: D.tasks ?? [], error: null }),
  listMyProjects: async () => ({ data: D.projects ?? [], error: null }),
  listMyClientProjects: async () => ({ data: D.projects ?? [], error: null }),
  listMilestonesForProjects: async () => ({ data: D.milestones ?? [], error: null }),
  listProjectMilestones: async () => ({ data: D.milestones ?? [], error: null }),
  listProjectUpdates: async () => ({ data: D.updates ?? [], error: null }),
  listProjectFiles: async () => ({ data: D.files ?? [], error: null }),
  listRecentProjectUpdates: async () => ({ data: D.recentUpdates ?? [], error: null }),
  listProjectRequests: async () => ({ data: D.requests ?? [], error: null }),
  listTeamMembers: async () => ({ data: [{ id: 'me', display_name: 'Ada Lovelace', role }, { id: 'u2', display_name: 'Grace Hopper', role: 'worker' }], error: null }),
  updateTaskStatus: async (id: string, status: string) => { rec('complete', [id, status]); return completeResult },
  countRows: async (table: string, filters: unknown) => { rec('countRows', [table, filters]); return { count: D.counts?.[table] ?? 0, error: null } },
  countPublishedPosts: async () => ({ data: D.posts ?? 0, error: null }),
  getStatusCounts: async (table: string) => ({ data: D.statuses?.[table] ?? {}, error: null }),
  getSecurityPosture: async () => { rec('posture', 1); return { data: D.posture ?? null, error: D.postureError ?? null } },
  listAuditLogs: async () => ({ data: D.audit ?? [], error: null }),
}))

import { WorkerDashboard } from '../../src/pages/worker/WorkerDashboard'
import { AdminDashboard } from '../../src/pages/admin/AdminDashboard'
import { ClientDashboard } from '../../src/pages/client/ClientDashboard'

const mount = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)
const kpi = (label: string) => screen.getByText(label, { selector: '.ctf-kpi__label' }).closest('.ctf-kpi') as HTMLElement
const reset = () => { for (const k of Object.keys(D)) delete D[k]; for (const k of Object.keys(calls)) delete calls[k]; toasts.length = 0; role = 'worker'; completeResult = { error: null } }

describe('Worker overview', () => {
  beforeEach(reset)

  it('counts only MY open tasks, and separates overdue, due soon and blocked', async () => {
    D.tasks = [task({ title: 'late', due_date: iso(-2) }), task({ title: 'today', due_date: iso(0) }), task({ title: 'soon', due_date: iso(3) }), task({ title: 'blocked', status: 'blocked' }),
      task({ title: 'theirs', assignee_id: 'someone', due_date: iso(-9) }), task({ title: 'finished', status: 'done', due_date: iso(-5) })]
    mount(<WorkerDashboard />)
    await waitFor(() => expect(within(kpi('My open tasks')).getByText('4')).toBeTruthy())
    expect(within(kpi('Overdue')).getByText('1')).toBeTruthy()
    expect(within(kpi('Due in 7 days')).getByText('2')).toBeTruthy()
    expect(within(kpi('Blocked')).getByText('1')).toBeTruthy()
  })

  it('the focus list shows overdue first, with a red "days ago" marker, and links to the project', async () => {
    D.projects = [{ id: 'p1', name: 'Acme site', status: 'active', due_date: null }]
    D.tasks = [task({ title: 'later', due_date: iso(4) }), task({ title: 'overdue one', due_date: iso(-3) }), task({ title: 'due today', due_date: iso(0) })]
    mount(<WorkerDashboard />)
    const panel = (await screen.findByRole('region', { name: /focus/i }))
    const titles = within(panel).getAllByRole('link').map((a) => a.textContent).filter((t) => ['overdue one', 'due today', 'later'].includes(t ?? ''))
    expect(titles).toEqual(['overdue one', 'due today', 'later'])
    expect(within(panel).getByText('3 days ago').className).toContain('is-late')
    expect(within(panel).getAllByText('Acme site').length).toBeGreaterThan(0)
  })

  it('marking a task done removes it immediately and tells the database', async () => {
    const user = userEvent.setup(); D.tasks = [task({ id: 't1', title: 'finish me', due_date: iso(0) })]
    mount(<WorkerDashboard />)
    await user.click(await screen.findByRole('button', { name: /mark "finish me" done/i }))
    expect(screen.queryByText('finish me')).toBeNull()
    expect(calls.complete).toEqual([['t1', 'done']])
  })

  it('if the database refuses, the task comes BACK and the real reason is shown', async () => {
    const user = userEvent.setup(); completeResult = { error: new Error("You don't have permission to change this task.") }; D.tasks = [task({ id: 't1', title: 'not yours really', due_date: iso(0) })]
    mount(<WorkerDashboard />)
    await user.click(await screen.findByRole('button', { name: /mark "not yours really" done/i }))
    await waitFor(() => expect(screen.getByText('not yours really')).toBeTruthy()) // rolled back
    expect(toasts.at(-1)).toEqual({ message: "You don't have permission to change this task.", tone: 'error' })
  })

  it('project progress comes from real milestones — and honestly says so when there are none', async () => {
    D.projects = [{ id: 'p1', name: 'Has plan', status: 'active', due_date: null }, { id: 'p2', name: 'No plan', status: 'active', due_date: null }]
    D.milestones = [{ project_id: 'p1', status: 'complete', percentage: 0 }, { project_id: 'p1', status: 'in_progress', percentage: 50 }]
    mount(<WorkerDashboard />)
    expect(await screen.findByText('1 of 2 milestones complete')).toBeTruthy()
    expect(screen.getByText(/No milestones yet, so no progress to show/)).toBeTruthy()
  })

  it('shows teammates who are online, not yourself', async () => {
    mount(<WorkerDashboard />)
    expect(await screen.findByText(/Team online \(1\)/)).toBeTruthy()
    expect(screen.getByTitle('Grace Hopper')).toBeTruthy(); expect(screen.queryByTitle('Ada Lovelace')).toBeNull()
  })

  it('greets by first name, and has a sensible empty state', async () => {
    mount(<WorkerDashboard />)
    expect(await screen.findByText(/^(Good morning|Good afternoon|Good evening|Working late), Ada$/)).toBeTruthy()
    expect(await screen.findByText(/No tasks are assigned to you/)).toBeTruthy()
  })
})

describe('Admin overview', () => {
  beforeEach(reset)

  it('"Needs attention" lists only what is genuinely waiting, each linking to where it is handled', async () => {
    role = 'superadmin'
    D.statuses = { leads: { new: 3, converted: 2 }, applications: { received: 1 }, projects: { active: 2 } }
    D.requests = [{ id: 'r1', status: 'open', project_id: 'p', title: 'x', kind: 'request', priority: 'normal' }, { id: 'r2', status: 'complete', project_id: 'p', title: 'y', kind: 'request', priority: 'normal' }]
    D.tasks = [task({ due_date: iso(-1) }), task({ due_date: iso(-4) })]
    mount(<AdminDashboard />)
    const panel = await screen.findByRole('region', { name: 'Needs attention' })
    await waitFor(() => expect(within(panel).getByText('3 new leads waiting for a first reply')).toBeTruthy())
    expect(within(panel).getByRole('link', { name: /3 new leads/ }).getAttribute('href')).toBe('/admin/leads')
    expect(within(panel).getByText('1 job application not yet reviewed')).toBeTruthy()
    expect(within(panel).getByText('1 open client request')).toBeTruthy() // the completed one is not counted
    expect(within(panel).getByText('2 overdue tasks across all projects')).toBeTruthy()
  })

  it('says "all clear" when nothing is waiting (and never shows the old placeholder text)', async () => {
    D.projects = []; mount(<AdminDashboard />)
    expect(await screen.findByText(/All clear/)).toBeTruthy()
    expect(screen.queryByText(/wired up/i)).toBeNull()
  })

  it('FIXED: "Active clients" really filters on status, and "Published posts" uses the public-blog rule, not a raw row count', async () => {
    D.counts = { clients: 7, worker_profiles: 5 }; D.posts = 4
    mount(<AdminDashboard />)
    await waitFor(() => expect(within(kpi('Active clients')).getByText('7')).toBeTruthy())
    expect(calls.countRows).toContainEqual(['clients', { status: 'active' }])
    expect(within(kpi('Published posts')).getByText('4')).toBeTruthy()
  })

  it('the security panel (and its report) is for superadmins only', async () => {
    role = 'manager'
    mount(<AdminDashboard />)
    await screen.findByText('Needs attention')
    expect(screen.queryByRole('region', { name: 'Security' })).toBeNull()
    expect(calls.posture).toBeUndefined() // a manager never even requests it
  })

  it('a superadmin sees the live security grade and what to fix', async () => {
    role = 'superadmin'
    D.posture = { generated_at: '', table_count: 10, policy_count: 30, tables_without_rls: ['invoices'], tables_rls_without_policies: [], public_buckets: [], private_buckets: [], definer_functions_without_search_path: [],
      accounts: { total: 3, superadmins: 2, workers: 1, clients: 0, suspended_workers: 0, suspended_clients: 0, must_change_password: 0 }, activity: { failed_logins_24h: 0, failed_logins_7d: 0, warnings_24h: 0, errors_24h: 0, events_7d: 1 } }
    mount(<AdminDashboard />)
    const panel = await screen.findByRole('region', { name: 'Security' })
    expect(await within(panel).findByText('Grade B')).toBeTruthy() // 100 - 15 for the table without RLS = 85
    expect(within(panel).getByText(/1 table without Row Level Security/)).toBeTruthy()
  })

  it('shows system health from real timed checks, and who is online', async () => {
    mount(<AdminDashboard />)
    const health = await screen.findByRole('region', { name: 'System health' })
    await waitFor(() => expect(within(health).getAllByText('Healthy')).toHaveLength(2))
    expect(await screen.findByText('1 online')).toBeTruthy()
  })
})

describe('Client overview', () => {
  beforeEach(() => { reset(); role = 'client' })

  it('welcomes a client with no project instead of a blank page', async () => {
    D.projects = []; mount(<ClientDashboard />)
    expect(await screen.findByText('No active project yet')).toBeTruthy()
  })

  it('shows real progress, the next milestone and its date', async () => {
    D.projects = [{ id: 'p1', name: 'Acme Portal', status: 'in_development', due_date: iso(30), description: '' }]
    D.milestones = [{ id: 'm1', project_id: 'p1', title: 'Discovery', status: 'complete', percentage: 100, target_date: iso(-20), completed_date: iso(-18), is_public: false },
      { id: 'm2', project_id: 'p1', title: 'Build the dashboard', status: 'in_progress', percentage: 40, target_date: iso(5), completed_date: null, is_public: false }]
    mount(<ClientDashboard />)
    await waitFor(() => expect(within(kpi('Overall progress')).getByText('70%')).toBeTruthy()) // (100 + 40) / 2
    expect(within(kpi('Overall progress')).getByText('1 of 2 milestones complete')).toBeTruthy()
    expect(within(kpi('Next milestone')).getByText('Build the dashboard')).toBeTruthy()
    expect(within(kpi('Next milestone')).getByText('Target in 5 days')).toBeTruthy()
  })

  it('milestones with is_public=false are STILL shown (no staff screen can set that flag)', async () => {
    D.projects = [{ id: 'p1', name: 'P', status: 'active', due_date: null, description: '' }]
    D.milestones = [{ id: 'm1', project_id: 'p1', title: 'Hidden by the old filter', status: 'in_progress', percentage: 10, target_date: null, completed_date: null, is_public: false }]
    mount(<ClientDashboard />)
    const panel = await screen.findByRole('region', { name: 'Milestones' })
    expect(await within(panel).findByText('Hidden by the old filter')).toBeTruthy()
  })

  it('separates change requests from reported issues, counting only the open ones', async () => {
    D.projects = [{ id: 'p1', name: 'P', status: 'active', due_date: null, description: '' }]
    D.requests = [
      { id: '1', status: 'open', kind: 'change', title: 'a', project_id: 'p1', priority: 'normal', created_at: new Date().toISOString() },
      { id: '2', status: 'in_review', kind: 'request', title: 'b', project_id: 'p1', priority: 'normal', created_at: new Date().toISOString() },
      { id: '3', status: 'open', kind: 'bug', title: 'c', project_id: 'p1', priority: 'high', created_at: new Date().toISOString() },
      { id: '4', status: 'complete', kind: 'bug', title: 'd', project_id: 'p1', priority: 'normal', created_at: new Date().toISOString() },
    ]
    mount(<ClientDashboard />)
    await waitFor(() => expect(within(kpi('Open requests')).getByText('2')).toBeTruthy())
    expect(within(kpi('Open issues')).getByText('1')).toBeTruthy()
  })

  it('offers one-click ways to ask for something', async () => {
    D.projects = [{ id: 'p1', name: 'P', status: 'active', due_date: null, description: '' }]
    mount(<ClientDashboard />)
    expect((await screen.findByRole('link', { name: /new request/i })).getAttribute('href')).toBe('/client/requests')
    expect(screen.getByRole('link', { name: /report an issue/i }).getAttribute('href')).toBe('/client/maintenance')
  })
})
