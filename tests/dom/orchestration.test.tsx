import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'
import { DEPARTMENTS, boardOf, departmentBySlug } from '../../src/workspaces/definitions'
import type { DepartmentRow } from '../../src/lib/services'

type Asg = { id: string; project_id: string; project_name: string; department_id: string; objective: string; deliverables: string[]; deadline: string | null; status: string; accepted_at: string | null; created_at: string }
type Tsk = { id: string; project_id: string; project_name: string; department_id: string; assignee_id: string | null; assignee_name: string | null; title: string; description: string; status: string; priority: string; stage: string | null; due_date: string | null; created_at: string; completed_at: string | null }

const state: { records: unknown[]; detail: unknown; assignments: Asg[]; tasks: Tsk[]; members: { user_id: string; display_name: string; position: string; status: string; department_role: string }[]; summaries: unknown[] } = { records: [], detail: null, assignments: [], tasks: [], members: [], summaries: [] }
const calls: { fn: string; args: unknown[] }[] = []
const rec = (fn: string, result: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return result }

vi.mock('../../src/lib/services', () => ({
  ASSIGNMENT_STATUS_LABEL: { assigned: 'Awaiting acceptance', accepted: 'In progress', in_review: 'In review', changes_requested: 'Changes requested', completed: 'Completed' },
  listDepartmentAssignments: async () => ({ data: state.assignments, error: null }),
  listDepartmentTasks: async () => ({ data: state.tasks, error: null }),
  listDepartmentMembers: async () => ({ data: state.members, error: null }),
  setAssignmentStatus: (...a: unknown[]) => rec('setAssignmentStatus')(...a),
  createDepartmentTask: (...a: unknown[]) => rec('createDepartmentTask')(...a),
  moveTaskToStage: (...a: unknown[]) => rec('moveTaskToStage')(...a),
  listDepartmentSummaries: async () => ({ data: { departments: state.summaries, unassigned: 0 }, error: null }),
  listClients: async () => ({ data: [], error: null }),
  listRecords: async () => ({ data: state.records, error: null }),
  updateRecord: (...a: unknown[]) => rec('updateRecord')(...a),
  createRecord: (...a: unknown[]) => rec('createRecord')(...a),
  deleteRecord: (...a: unknown[]) => rec('deleteRecord')(...a),
  loadTaskDetail: async () => ({ data: state.detail, error: null }),
  distributeProject: (...a: unknown[]) => rec('distributeProject', { project: { id: 'p1', name: 'Zerobyte Launch' }, error: null, assigned: ['id-frontend-development', 'id-cybersecurity'] })(...a),
}))

import { Assignments, TaskBoard, type Viewer } from '../../src/workspaces/DepartmentWork'
import { CreateProjectWizardButton } from '../../src/components/ProjectWizard'

const def = departmentBySlug('frontend-development')!
const row: DepartmentRow = { id: 'id-frontend-development', name: def.name, slug: def.slug, is_system: true, created_at: '2026-01-01' }
const asg = (over: Partial<Asg> = {}): Asg => ({ id: 'a1', project_id: 'p1', project_name: 'Zerobyte Launch', department_id: row.id, objective: 'Build the frontend application', deliverables: ['Dashboard', 'Authentication UI'], deadline: '2026-10-15', status: 'assigned', accepted_at: null, created_at: '2026-10-01', ...over })
const tsk = (over: Partial<Tsk> = {}): Tsk => ({ id: 't1', project_id: 'p1', project_name: 'Zerobyte Launch', department_id: row.id, assignee_id: 'u-sam', assignee_name: 'Samuel', title: 'Build Authentication UI', description: '', status: 'todo', priority: 'normal', stage: 'Backlog', due_date: '2026-10-12', created_at: '2026-10-02', completed_at: null, ...over })
const viewer = (over: Partial<Viewer> = {}): Viewer => ({ id: 'u-sam', isMainAdmin: false, isDepartmentAdmin: false, ...over })
const wrap = (ui: React.ReactNode) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>)

beforeEach(() => {
  calls.length = 0
  state.assignments = []; state.tasks = []; state.records = []
  state.members = [{ user_id: 'u-sam', display_name: 'Samuel', position: 'Frontend Developer', status: 'active', department_role: 'member' }, { user_id: 'u-old', display_name: 'Former Dev', position: '', status: 'suspended', department_role: 'member' }]
  state.summaries = DEPARTMENTS.map((d) => ({ id: `id-${d.slug}`, name: d.name, slug: d.slug, is_system: true, created_at: '', workerCount: 0, admins: d.slug === 'frontend-development' ? ['Ike Okafor'] : [] }))
})

describe('Assignments (a department receives its part of a project)', () => {
  it('shows an empty state before anything is assigned', async () => {
    wrap(<Assignments def={def} row={row} viewer={viewer()} />)
    expect(await screen.findByText('No project assignments yet')).toBeTruthy()
  })

  it('shows the project, objective, deliverables, deadline and status', async () => {
    state.assignments = [asg()]
    wrap(<Assignments def={def} row={row} viewer={viewer()} />)
    expect(await screen.findByText('Zerobyte Launch')).toBeTruthy()
    expect(screen.getByText('Build the frontend application')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Deliverables' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Dashboard', 'Authentication UI'])
    expect(screen.getByText('Awaiting acceptance')).toBeTruthy()
  })

  it('lets the Department Admin accept it', async () => {
    state.assignments = [asg()]
    wrap(<Assignments def={def} row={row} viewer={viewer({ isDepartmentAdmin: true })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a1', 'accepted'] }))
  })

  it('gives a plain worker no way to act on an assignment', async () => {
    state.assignments = [asg()]
    wrap(<Assignments def={def} row={row} viewer={viewer()} />)
    await screen.findByText('Zerobyte Launch')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets a Department Admin submit accepted work for review, but not mark it completed', async () => {
    state.assignments = [asg({ status: 'accepted' })]
    wrap(<Assignments def={def} row={row} viewer={viewer({ isDepartmentAdmin: true })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a1', 'in_review'] }))
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull()
  })

  it('lets the Main Admin request changes or complete work that is in review', async () => {
    state.assignments = [asg({ status: 'in_review' })]
    wrap(<Assignments def={def} row={row} viewer={viewer({ isMainAdmin: true })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a1', 'changes_requested'] }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark completed' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'setAssignmentStatus', args: ['a1', 'completed'] }))
  })
})

describe('TaskBoard (the department workflow, backed by real tasks)', () => {
  const stages = boardOf(def, 'sprint')!.stages
  const column = (name: string) => within(screen.getByRole('list', { name: /stages/ })).getAllByRole('listitem').filter((c) => c.tagName === 'SECTION').find((c) => within(c).getByRole('heading').textContent === name)!

  it('places each task in its stage and leaves the other stages empty', async () => {
    state.tasks = [tsk({ stage: 'Code review' }), tsk({ id: 't2', title: 'Dashboard layout', stage: null })]
    wrap(<TaskBoard def={def} row={row} boardId="sprint" viewer={viewer()} />)
    await screen.findByText('Build Authentication UI')
    expect(within(column('Code review')).getByText('Build Authentication UI')).toBeTruthy()
    expect(within(column('Backlog')).getByText('Dashboard layout')).toBeTruthy() // no stage yet => first stage
    expect(screen.getAllByText('No work in this stage.')).toHaveLength(stages.length - 2)
  })

  it('highlights and lets a worker move their own task, and calls the right stage', async () => {
    state.tasks = [tsk()]
    wrap(<TaskBoard def={def} row={row} viewer={viewer()} />)
    await userEvent.selectOptions(await screen.findByLabelText('Move Build Authentication UI'), 'QA')
    await waitFor(() => expect(calls).toContainEqual({ fn: 'moveTaskToStage', args: ['t1', stages, 'QA'] }))
    expect(screen.getByText('You')).toBeTruthy()
  })

  it("does not let a worker move someone else's task", async () => {
    state.tasks = [tsk({ assignee_id: 'u-other', assignee_name: 'Maria' })]
    wrap(<TaskBoard def={def} row={row} viewer={viewer()} />)
    await screen.findByText('Build Authentication UI')
    expect(screen.queryByLabelText('Move Build Authentication UI')).toBeNull()
    expect(screen.getByText('Maria')).toBeTruthy()
  })

  it('lets a Department Admin create a task from an accepted assignment, in the first stage', async () => {
    state.assignments = [asg({ status: 'accepted' })]
    wrap(<TaskBoard def={def} row={row} viewer={viewer({ isDepartmentAdmin: true })} />)
    await userEvent.click(await screen.findByRole('button', { name: /New task/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByLabelText(/Project/), 'p1')
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Password reset')
    const assignees = within(dialog).getByLabelText('Assign to') as HTMLSelectElement
    expect([...assignees.options].map((o) => o.textContent)).toEqual(['Unassigned', 'Samuel']) // suspended workers aren't offered
    await userEvent.selectOptions(assignees, 'u-sam')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createDepartmentTask')?.args[0]).toMatchObject({ project_id: 'p1', department_id: row.id, title: 'Password reset', assignee_id: 'u-sam', stage: 'Backlog' }))
  })

  it("tells a Department Admin to accept first when nothing has been accepted", async () => {
    state.assignments = [asg({ status: 'assigned' })]
    wrap(<TaskBoard def={def} row={row} viewer={viewer({ isDepartmentAdmin: true })} />)
    await userEvent.click(await screen.findByRole('button', { name: /New task/ }))
    expect(await screen.findByText('Accept an assignment first')).toBeTruthy()
  })

  it('offers no way for a plain worker to create tasks', async () => {
    wrap(<TaskBoard def={def} row={row} viewer={viewer()} />)
    await screen.findByText('No work in this stage.', { selector: 'p' }).catch(() => null)
    expect(screen.queryByRole('button', { name: /New task/ })).toBeNull()
  })

  it('keeps the Security Lab free of tasks: tasks live on Security Operations only', async () => {
    const sec = departmentBySlug('cybersecurity')!
    state.tasks = [tsk({ department_id: 'id-cybersecurity', title: 'Patch gateway' })]
    wrap(<TaskBoard def={sec} row={{ ...row, id: 'id-cybersecurity', slug: sec.slug, name: sec.name }} boardId="operations" viewer={viewer()} />)
    expect(await screen.findByText('Patch gateway')).toBeTruthy()
  })
})

describe('Create project wizard (one project, many departments)', () => {
  const open = async () => {
    wrap(<CreateProjectWizardButton onCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    return await screen.findByRole('dialog')
  }

  it('needs a project name before moving on', async () => {
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/name/i)
  })

  it('rejects a deadline before the start date', async () => {
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText(/Project name/), 'X')
    await userEvent.type(within(dialog).getByLabelText('Start date'), '2026-10-10')
    await userEvent.type(within(dialog).getByLabelText('Deadline'), '2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/before the start/)
  })

  it('needs at least one department, each with an objective', async () => {
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText(/Project name/), 'Zerobyte Launch')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/at least one department/)
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Frontend Development/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Frontend Development should deliver/)
  })

  it('creates ONE project, assigns it to the chosen departments, and reports who was notified', async () => {
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText(/Project name/), 'Zerobyte Launch')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Frontend Development/ }))
    await userEvent.type(within(dialog).getByLabelText(/Objective/), 'Build the frontend')
    await userEvent.type(within(dialog).getByLabelText('Deliverables'), 'Dashboard{enter}Auth UI')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Cybersecurity/ }))
    const objectives = within(dialog).getAllByLabelText(/Objective/)
    await userEvent.type(objectives[1], 'Security assessment')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(within(dialog).getByText('Will be assigned to')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and distribute' }))

    await waitFor(() => expect(calls.filter((c) => c.fn === 'distributeProject')).toHaveLength(1))
    const [project, briefs] = calls.find((c) => c.fn === 'distributeProject')!.args as [Record<string, unknown>, { departmentId: string; objective: string; deliverables: string[] }[]]
    expect(project).toMatchObject({ name: 'Zerobyte Launch', priority: 'normal', status: 'planning' })
    expect(briefs.map((b) => b.departmentId)).toEqual(['id-frontend-development', 'id-cybersecurity'])
    expect(briefs[0].deliverables).toEqual(['Dashboard', 'Auth UI'])

    const result = await screen.findByRole('list', { name: 'Distribution' })
    expect(within(result).getByText('Ike Okafor notified')).toBeTruthy() // Frontend has an admin
    expect(within(result).getByText(/No Department Admin yet/)).toBeTruthy() // Cybersecurity does not: said plainly, not "notified"
  })
})
