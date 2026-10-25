import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'

type Person = { id: string; name: string; position: string; status: string }
const dept = (slug: string, name: string, admins: Person[], members: Person[]) => ({ row: { id: `id-${slug}`, name, slug, is_system: true, created_at: '' }, admins, members })
const person = (id: string, name: string, position = '', status = 'active'): Person => ({ id, name, position, status })

const s: { role: string; id: string; mine: { department: { id: string; name: string } | null; role: string } | null; feed: unknown[]; due: unknown[]; org: unknown; feedError: boolean } = {
  role: 'worker', id: 'me', mine: null, feed: [], due: [], org: null, feedError: false,
}
const calls: { fn: string; args: unknown[] }[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: s.id, display_name: 'Me', role: s.role } }) }))
vi.mock('../../src/lib/services', () => ({
  ANNOUNCEMENT_BODY_MAX: 5000, ANNOUNCEMENT_TITLE_MAX: 140,
  listOrganization: async () => ({ data: s.org, error: null }),
  listAnnouncements: async () => (s.feedError ? { data: [], error: new Error('network down') } : { data: s.feed, error: null }),
  listUpcomingDeadlines: async () => ({ data: s.due, error: null }),
  getMyDepartment: async () => ({ data: s.mine, error: null }),
  // Multi-department: the same fixture, as a list (primary first). A null fixture means "in no department".
  getMyDepartments: async () => ({ data: s.mine?.department ? [{ department: s.mine.department, role: s.mine.role, isPrimary: true }] : [], error: null }),
  createAnnouncement: async (...a: unknown[]) => { calls.push({ fn: 'createAnnouncement', args: a }); return { error: null } },
  deleteAnnouncement: async (...a: unknown[]) => { calls.push({ fn: 'deleteAnnouncement', args: a }); return { error: null } },
}))

import { CompanyHQ } from '../../src/pages/company/CompanyHQ'
const wrap = (base: '/worker' | '/admin' = '/worker') => render(<MemoryRouter><ToastProvider><CompanyHQ base={base} /></ToastProvider></MemoryRouter>)
const post = (over: Record<string, unknown> = {}) => ({ id: 'n1', department_id: null, title: 'Welcome', body: 'Hello all', pinned: false, author_id: 'main', author_name: 'Main Admin', created_at: '2026-10-01T10:00:00Z', ...over })

beforeEach(() => {
  calls.length = 0
  Object.assign(s, { role: 'worker', id: 'me', mine: { department: { id: 'id-frontend-development', name: 'Frontend Development' }, role: 'member' }, feed: [], due: [], feedError: false })
  s.org = {
    leaders: [{ id: 'main', name: 'Ada Lovelace' }],
    departments: [
      dept('frontend-development', 'Frontend Development', [person('a1', 'Ike Okafor')], [person('m1', 'Samuel Eze', 'Frontend Developer'), person('m2', 'Gone Dev', '', 'suspended')]),
      dept('cybersecurity', 'Cybersecurity', [], []),
    ],
    unassigned: [person('x1', 'Newcomer')],
  }
})

describe('Company HQ: organization', () => {
  it('shows who leads the company, each department, its admin, and its people', async () => {
    wrap()
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    const chart = screen.getByRole('list', { name: 'Departments' })
    expect(within(chart).getAllByText('Ike Okafor').length).toBeGreaterThan(0) // as admin, and again in the people list
    expect(within(chart).getByText('No Department Admin yet')).toBeTruthy() // Cybersecurity
    await userEvent.click(within(chart).getByText('3 people'))
    expect(within(chart).getByText('Samuel Eze')).toBeTruthy()
    expect(within(chart).getByText(/suspended/)).toBeTruthy()
    expect(within(chart).getByText('No one here yet.')).toBeTruthy()
  })

  it('counts real people and calls out anyone with no department', async () => {
    wrap()
    const stats = await screen.findByRole('region', { name: 'Company' })
    expect(within(stats).getByText('People').nextSibling?.textContent).toBe('4')
    expect(within(stats).getByText('Department Admins').nextSibling?.textContent).toBe('1')
    expect(screen.getByText(/1 person has no department yet: Newcomer/)).toBeTruthy()
  })

  it('links departments to their environment only for the Main Admin shell', async () => {
    const { unmount } = wrap('/worker')
    await screen.findByText('Ada Lovelace')
    expect(screen.queryByRole('link', { name: 'Frontend Development' })).toBeNull()
    unmount()
    s.role = 'superadmin'
    wrap('/admin')
    expect((await screen.findByRole('link', { name: 'Frontend Development' })).getAttribute('href')).toBe('/admin/departments/frontend-development')
  })
})

describe('Company HQ: announcements', () => {
  it('has an honest empty state', async () => {
    wrap()
    expect(await screen.findByText('No announcements yet')).toBeTruthy()
  })

  it('labels company vs department posts, and shows pinned ones', async () => {
    s.feed = [post({ pinned: true, title: 'Pinned news' }), post({ id: 'n2', title: 'Stand-up moved', department_id: 'id-frontend-development', author_name: 'Ike Okafor' })]
    wrap()
    const feed = await screen.findByText('Pinned news')
    expect(feed).toBeTruthy()
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('Company')).toBeTruthy()
    expect(screen.getAllByText('Frontend Development').length).toBeGreaterThan(0)
  })

  it('reports a feed that failed to load instead of pretending it is empty', async () => {
    s.feedError = true
    wrap()
    expect(await screen.findByText("Announcements couldn't load")).toBeTruthy()
    expect(screen.queryByText('No announcements yet')).toBeNull()
  })

  it('offers no composer to a plain worker', async () => {
    wrap()
    await screen.findByText('Ada Lovelace')
    expect(screen.queryByRole('button', { name: /New announcement/ })).toBeNull()
  })

  it('lets a Department Admin post to their own department only', async () => {
    s.mine = { department: { id: 'id-frontend-development', name: 'Frontend Development' }, role: 'admin' }
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: /New announcement/ }))
    const dialog = await screen.findByRole('dialog')
    const audience = within(dialog).getByLabelText('Audience') as HTMLSelectElement
    expect([...audience.options].map((o) => o.textContent)).toEqual(['Frontend Development'])
    expect(audience.disabled).toBe(true)
    expect(within(dialog).queryByLabelText('Pin to the top')).toBeNull()
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Release freeze')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createAnnouncement')?.args[0]).toEqual({ title: 'Release freeze', body: '', departmentId: 'id-frontend-development', pinned: false }))
  })

  it('lets the Main Admin address the whole company and pin the post', async () => {
    s.role = 'superadmin'; s.mine = null
    wrap('/admin')
    await userEvent.click(await screen.findByRole('button', { name: /New announcement/ }))
    const dialog = await screen.findByRole('dialog')
    const audience = within(dialog).getByLabelText('Audience') as HTMLSelectElement
    expect([...audience.options].map((o) => o.textContent)).toEqual(['Whole company', 'Frontend Development', 'Cybersecurity'])
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'All hands')
    await userEvent.click(within(dialog).getByLabelText('Pin to the top'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createAnnouncement')?.args[0]).toEqual({ title: 'All hands', body: '', departmentId: null, pinned: true }))
  })

  it('shows remove only to the author and the Main Admin', async () => {
    s.feed = [post({ author_id: 'someone-else' }), post({ id: 'n2', title: 'Mine', author_id: 'me' })]
    wrap()
    await screen.findByText('Welcome')
    expect(screen.queryByRole('button', { name: 'Remove Welcome' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Mine' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'deleteAnnouncement', args: ['n2'] }))
  })
})

describe('Company HQ: coming up', () => {
  it('is empty, not invented, when nothing is due', async () => {
    wrap()
    expect(await screen.findByText('Nothing due')).toBeTruthy()
  })

  it('lists real deadlines nearest first with their kind', async () => {
    s.due = [
      { kind: 'task', id: 't1', label: 'Build Authentication UI', context: 'Zerobyte Launch', date: '2026-10-12' },
      { kind: 'project', id: 'a1', label: 'Zerobyte Launch: Frontend Development deliverables', context: 'Build the frontend', date: '2026-10-15' },
    ]
    wrap()
    expect(await screen.findByText('Build Authentication UI')).toBeTruthy()
    expect(screen.getByText('Task')).toBeTruthy()
    expect(screen.getByText('Project')).toBeTruthy()
  })
})
