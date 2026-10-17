import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'
import { DEPARTMENTS } from '../../src/workspaces/definitions'
import { resolveSource } from '../../src/workspaces/records'

type Dept = { id: string; name: string; slug: string | null; is_system: boolean; created_at: string; workerCount: number; admins: string[] }
type Member = { user_id: string; display_name: string; position: string; status: string; department_role: 'member' | 'admin' }

const state: { rows: Dept[]; unassigned: number; members: Member[]; mine: { department: Dept | null; role: 'member' | 'admin' } | null; role: string; integrations: Record<string, unknown>; channels: { id: string; name: string }[]; onboarding: Set<string> } = {
  rows: [], unassigned: 0, members: [], mine: null, role: 'superadmin', integrations: {}, channels: [], onboarding: new Set(),
}
const calls: { fn: string; args: unknown[] }[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role: state.role } }) }))
vi.mock('../../src/lib/services', () => ({
  listDepartmentSummaries: async () => ({ data: { departments: state.rows, unassigned: state.unassigned }, error: null }),
  getDepartmentBySlug: async (slug: string) => ({ data: state.rows.find((r) => r.slug === slug) ?? null, error: null }),
  getMyDepartment: async () => ({ data: state.mine, error: null }),
  listDepartmentMembers: async () => ({ data: state.members, error: null }),
  setWorkerDepartment: async (...args: unknown[]) => { calls.push({ fn: 'setWorkerDepartment', args }); return { error: null } },
  setDepartmentAdmin: async (...args: unknown[]) => { calls.push({ fn: 'setDepartmentAdmin', args }); return { error: null } },
  // Orchestration is covered in orchestration.test.tsx; here the department simply has no assignments or tasks yet.
  ASSIGNMENT_STATUS_LABEL: {},
  listDepartmentAssignments: async () => ({ data: [], error: null }),
  setAssignmentStatus: async () => ({ error: null }),
  listDepartmentTasks: async () => ({ data: [], error: null }),
  createDepartmentTask: async () => ({ error: null }),
  moveTaskToStage: async () => ({ error: null }),
  // Live numbers, integrations, channels, records and onboarding: all empty unless a test says otherwise.
  loadIntegrationState: async () => ({ data: state.integrations, error: null }),
  loadDepartmentStats: async () => ({ data: { tasks: [], records: [], leads: { 7: 0 } }, error: null }),
  resolveMetric: (def: { recordKinds: never[] }, item: { source?: never }, data: never) => (item.source ? resolveSource(def.recordKinds, item.source, data) : null),
  listDepartmentChannels: async () => ({ data: state.channels, error: null }),
  listRecords: async () => ({ data: [], error: null }),
  updateRecord: async () => ({ error: null }),
  listOnboardingProgress: async () => ({ data: state.onboarding, error: null }),
  setOnboardingItem: async (...args: unknown[]) => { calls.push({ fn: 'setOnboardingItem', args }); return { error: null } },
  raiseSuspensionCase: async (...args: unknown[]) => { calls.push({ fn: 'raiseSuspensionCase', args }); return { error: null } },
}))

import { AdminDepartmentPage, AdminDepartments } from '../../src/pages/admin/AdminDepartments'
import { WorkerDepartment } from '../../src/pages/worker/WorkerDepartment'

const row = (slug: string, over: Partial<Dept> = {}): Dept => {
  const def = DEPARTMENTS.find((d) => d.slug === slug)!
  return { id: `id-${slug}`, name: def.name, slug, is_system: true, created_at: '2026-01-01', workerCount: 0, admins: [], ...over }
}
const legacy = (name: string, over: Partial<Dept> = {}): Dept => ({ id: 'legacy', name, slug: null, is_system: false, created_at: '2026-01-01', workerCount: 0, admins: [], ...over })
const allRows = () => DEPARTMENTS.map((d) => row(d.slug))
const wrap = (ui: React.ReactNode, path = '/') => render(<MemoryRouter initialEntries={[path]}><ToastProvider>{ui}</ToastProvider></MemoryRouter>)

beforeEach(() => {
  calls.length = 0
  state.rows = allRows(); state.unassigned = 0; state.mine = null; state.role = 'superadmin'; state.integrations = {}; state.channels = []; state.onboarding = new Set()
  state.members = [
    { user_id: 'u1', display_name: 'Ike Okafor', position: 'Frontend Developer', status: 'active', department_role: 'admin' },
    { user_id: 'u2', display_name: 'Sarah Bello', position: '', status: 'active', department_role: 'member' },
  ]
})

describe('Departments overview (/admin/departments)', () => {
  it('shows all eight Codex departments immediately, without anyone creating them', async () => {
    wrap(<AdminDepartments />)
    for (const d of DEPARTMENTS) expect(await screen.findByText(d.name)).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /new department|create department/i })).toBeNull()
  })

  it('shows head-count and Department Admins, and flags a department with no admin', async () => {
    state.rows = [row('frontend-development', { workerCount: 3, admins: ['Ike Okafor'] }), ...DEPARTMENTS.slice(1).map((d) => row(d.slug))]
    wrap(<AdminDepartments />)
    expect(await screen.findByText('3 workers')).toBeTruthy()
    expect(screen.getByText(/Admin: Ike Okafor/)).toBeTruthy()
    expect(screen.getAllByText('No Department Admin')).toHaveLength(7)
  })

  it('says so when a department has not been provisioned by the migration', async () => {
    state.rows = allRows().filter((r) => r.slug !== 'marketing')
    wrap(<AdminDepartments />)
    expect(await screen.findByText('Not provisioned')).toBeTruthy()
  })

  it('warns about workers with no department and lists hand-made legacy departments separately', async () => {
    state.unassigned = 2
    state.rows = [...allRows(), legacy('Legacy Ops', { workerCount: 1 })]
    wrap(<AdminDepartments />)
    expect(await screen.findByText(/2 workers have no department/)).toBeTruthy()
    expect(screen.getByText('Legacy Ops')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Departments' })).getAllByRole('link')).toHaveLength(8) // legacy departments get no environment link
  })
})

describe('Department environment', () => {
  const open = (slug: string, role = 'superadmin') => {
    state.role = role
    return wrap(<Routes><Route path="/admin/departments/:slug" element={<AdminDepartmentPage />} /></Routes>, `/admin/departments/${slug}`)
  }

  it('Frontend is a developer environment: sprint board, dev tools, GitHub', async () => {
    open('frontend-development')
    expect(await screen.findByRole('heading', { name: 'Frontend Development', level: 2 })).toBeTruthy()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Overview', 'Sprint board', 'Dev tools', 'Integrations', 'Channels', 'Team'])
    expect(screen.getByText('Pull requests')).toBeTruthy()
  })

  it('shows the real workflow stages on the board and no invented work', async () => {
    open('frontend-development')
    await userEvent.click(await screen.findByRole('tab', { name: 'Sprint board' }))
    const stages = within(screen.getByRole('list', { name: /stages/ })).getAllByRole('listitem')
    expect(stages.map((s) => within(s).getByRole('heading').textContent)).toEqual(['Backlog', 'Ready', 'In development', 'Code review', 'QA', 'Ready for deployment', 'Deployed'])
    expect(screen.getAllByText('No work in this stage.')).toHaveLength(7)
  })

  it('is honest about integrations: GitHub tools say not connected and are not links; real tools are', async () => {
    open('frontend-development')
    await userEvent.click(await screen.findByRole('tab', { name: 'Dev tools' }))
    expect(screen.getAllByText('GitHub not connected').length).toBeGreaterThan(0)
    expect(screen.getByText('Repository browser').closest('a')).toBeNull()
    expect(screen.getByText('Bug tracker').closest('a')?.getAttribute('href')).toBe('/admin/departments/frontend-development/tool/bugs')
    expect(screen.getByText('API request tester').closest('a')?.getAttribute('href')).toBe('/admin/tools/api')
    expect(screen.queryByText('Planned')).toBeNull() // nothing in the product is a placeholder any more
  })

  it('turns a tool into a link once its integration is connected', async () => {
    state.integrations = { github: { status: 'connected', config: { account: 'codex' } } }
    open('frontend-development')
    await userEvent.click(await screen.findByRole('tab', { name: 'Dev tools' }))
    expect(await screen.findByText('Repository browser')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Repository browser').closest('a')?.getAttribute('href')).toBe('/admin/departments/frontend-development/tool/repos'))
  })

  it('never invents numbers: with nothing recorded every figure is a real zero or says there is no data', async () => {
    open('marketing')
    expect(await screen.findByRole('heading', { name: 'Marketing Hub' })).toBeTruthy()
    expect((await screen.findAllByText('No data yet')).length).toBeGreaterThanOrEqual(3) // followers, conversions, reach, engagements: nobody has entered any
    const shown = screen.getAllByText(/^\d[\d,.]*%?$/).map((e) => e.textContent)
    expect(shown.every((t) => t === '0')).toBe(true)
  })

  it('Cybersecurity has Security Operations and a Security Lab with the authorised-use notice', async () => {
    open('cybersecurity')
    expect(await screen.findByRole('heading', { name: 'Security Workspace' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Security Operations', 'Security Lab', 'Channels', 'Team'])
    await userEvent.click(screen.getByRole('tab', { name: 'Security Lab' }))
    expect(screen.getByRole('note').textContent).toMatch(/authori[sz]ed testing/i)
    expect(screen.getByText('Hash & HMAC')).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'Security Operations' }))
    expect(screen.getByText('Risk assessment')).toBeTruthy()
  })

  it('warns when the department is not provisioned in the database', async () => {
    state.rows = allRows().filter((r) => r.slug !== 'devops')
    open('devops')
    expect((await screen.findByRole('alert')).textContent).toMatch(/hasn.t been provisioned/)
  })

  it('shows a clear message for an unknown department', async () => {
    open('sales')
    expect(await screen.findByText("That department doesn't exist")).toBeTruthy()
  })

  describe('Team', () => {
    it('lets a Main Admin assign a Department Admin and move a worker', async () => {
      open('frontend-development')
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      expect(await screen.findByText('Ike Okafor')).toBeTruthy()
      expect(screen.getAllByText('Department Admin').length).toBeGreaterThan(0)
      await userEvent.click(screen.getByRole('button', { name: 'Make Department Admin' }))
      await waitFor(() => expect(calls).toContainEqual({ fn: 'setDepartmentAdmin', args: ['u2', true] }))
      await userEvent.selectOptions(screen.getByLabelText('Department for Sarah Bello'), 'id-devops')
      await waitFor(() => expect(calls).toContainEqual({ fn: 'setWorkerDepartment', args: ['u2', 'id-devops'] }))
    })

    it('hides every management control from anyone but a Main Admin', async () => {
      open('frontend-development', 'manager')
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      expect(await screen.findByText('Ike Okafor')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Department Admin|Remove admin/ })).toBeNull()
      expect(screen.queryByLabelText(/Department for/)).toBeNull()
    })

    it('explains an empty department instead of showing fake people', async () => {
      state.members = []
      open('devops')
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      expect(await screen.findByText('No one in DevOps yet')).toBeTruthy()
    })
  })
})

describe('Worker: my department', () => {
  const mine = (slug: string | null, role: 'member' | 'admin' = 'member') => {
    state.role = 'worker'
    state.mine = { department: slug ? row(slug) : null, role }
    return wrap(<WorkerDepartment />)
  }

  it('a Frontend worker lands in the Frontend environment, with no management controls', async () => {
    mine('frontend-development')
    expect(await screen.findByRole('heading', { name: 'Frontend Development', level: 2 })).toBeTruthy()
    expect(screen.queryByText('Department Admin')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.queryByLabelText(/Department for/)).toBeNull()
  })

  it('a Cybersecurity worker gets the security environment, not the frontend one', async () => {
    mine('cybersecurity')
    expect(await screen.findByRole('heading', { name: 'Security Workspace' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Sprint board' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Security Lab' })).toBeTruthy()
  })

  it('a Department Admin is labelled as one', async () => {
    mine('content', 'admin')
    expect(await screen.findByText('Department Admin')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Content Studio' })).toBeTruthy()
  })

  it('a worker with no department is told what to expect', async () => {
    mine(null)
    expect(await screen.findByText("You haven't been assigned to a department yet")).toBeTruthy()
  })

  it('a worker in a hand-made legacy department is pointed at the Codex departments', async () => {
    state.role = 'worker'
    state.mine = { department: legacy('Legacy Ops'), role: 'member' }
    wrap(<WorkerDepartment />)
    expect(await screen.findByText('Legacy Ops has no workspace yet')).toBeTruthy()
  })
})

describe('Department environment: new capabilities', () => {
  const open = (slug: string, role = 'superadmin') => { state.role = role; return wrap(<Routes><Route path="/admin/departments/:slug" element={<AdminDepartmentPage />} /></Routes>, `/admin/departments/${slug}`) }

  it('shows the department\'s real channels from the database', async () => {
    state.channels = [{ id: 'c1', name: 'Frontend Development · #general' }, { id: 'c2', name: 'Frontend Development · #bugs' }]
    open('frontend-development')
    await userEvent.click(await screen.findByRole('tab', { name: 'Channels' }))
    expect(await screen.findByText('#general')).toBeTruthy()
    expect(screen.getByText('Defects and regressions.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Chat' }).getAttribute('href')).toBe('/admin/chat')
  })

  it('says plainly when no channels exist yet instead of inventing them', async () => {
    open('devops')
    await userEvent.click(await screen.findByRole('tab', { name: 'Channels' }))
    expect(await screen.findByText('No channels yet')).toBeTruthy()
  })

  it('shows live integration status and points the Main Admin at the hub', async () => {
    state.integrations = { github: { status: 'connected', config: {} } }
    open('frontend-development')
    await userEvent.click(await screen.findByRole('tab', { name: 'Integrations' }))
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBeGreaterThan(0))
    expect(screen.getByRole('link', { name: 'Integrations hub' }).getAttribute('href')).toBe('/admin/integrations')
  })

  it('shows a worker their onboarding checklist, and lets them tick a step', async () => {
    state.role = 'worker'; state.mine = { department: row('frontend-development'), role: 'member' }
    wrap(<WorkerDepartment />)
    const region = await screen.findByRole('region', { name: 'Getting started' })
    expect(within(region).getByText('0 of 8 done')).toBeTruthy()
    await userEvent.click(within(region).getByRole('checkbox', { name: 'Set your own password' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setOnboardingItem', args: ['me', 'company.password', true] }))
  })

  it('hides onboarding once every step is done', async () => {
    state.role = 'worker'; state.mine = { department: row('frontend-development'), role: 'member' }
    const def = DEPARTMENTS[0]
    state.onboarding = new Set(['company.password', 'company.profile', 'company.handbook', 'company.channels', 'company.admin', ...def.onboarding.map((i) => i.key)])
    wrap(<WorkerDepartment />)
    await screen.findByRole('heading', { name: 'Frontend Development', level: 2 })
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull()
  })

  describe('suspension requests from the Team tab', () => {
    const asDeptAdmin = async () => {
      state.role = 'worker'; state.mine = { department: row('frontend-development'), role: 'admin' }
      state.members = [
        { user_id: 'me', display_name: 'Me Admin', position: '', status: 'active', department_role: 'admin' },
        { user_id: 'u2', display_name: 'Sarah Bello', position: '', status: 'active', department_role: 'member' },
        { user_id: 'u3', display_name: 'Other Admin', position: '', status: 'active', department_role: 'admin' },
        { user_id: 'u4', display_name: 'Already Pending', position: '', status: 'suspension_pending', department_role: 'member' },
      ]
      wrap(<WorkerDepartment />)
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      await screen.findByText('Sarah Bello')
    }

    it('lets a Department Admin request a suspension for a plain member only', async () => {
      await asDeptAdmin()
      expect(screen.getAllByRole('button', { name: 'Request suspension' })).toHaveLength(1) // not themselves, not another admin, not someone already pending
      expect(screen.getByText('suspension pending')).toBeTruthy()
    })

    it('needs a real reason, then sends the case with the evidence', async () => {
      await asDeptAdmin()
      await userEvent.click(screen.getByRole('button', { name: 'Request suspension' }))
      const dialog = await screen.findByRole('dialog')
      expect((within(dialog).getByRole('button', { name: 'Send for review' }) as HTMLButtonElement).disabled).toBe(true)
      await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Repeated missed deadlines')
      await userEvent.type(within(dialog).getByLabelText(/Evidence/), 'Three in October')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send for review' }))
      await waitFor(() => expect(calls).toContainEqual({ fn: 'raiseSuspensionCase', args: ['u2', 'Repeated missed deadlines', 'Three in October'] }))
    })

    it('offers a plain worker no way to start one', async () => {
      state.role = 'worker'; state.mine = { department: row('frontend-development'), role: 'member' }
      wrap(<WorkerDepartment />)
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      await screen.findByText('Ike Okafor')
      expect(screen.queryByRole('button', { name: /suspension/i })).toBeNull()
    })

    it('calls it a review, and includes other admins, when the Main Admin starts one', async () => {
      state.members = [{ user_id: 'u3', display_name: 'Other Admin', position: '', status: 'active', department_role: 'admin' }]
      open('frontend-development')
      await userEvent.click(await screen.findByRole('tab', { name: 'Team' }))
      expect(await screen.findByRole('button', { name: 'Start suspension review' })).toBeTruthy()
    })
  })
})
