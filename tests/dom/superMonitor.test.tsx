import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Any = Record<string, unknown>
const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = []
  const state: { me: Any; projects: Any[]; incidents: Any[]; detail: Any | null; keys: Any[]; dash: Any } = { me: { id: 'me', role: 'worker' }, projects: [], incidents: [], detail: null, keys: [], dash: {} }
  const rec = (fn: string, ret: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret }
  return { calls, state, rec }
})
const { calls, state } = h

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: h.state.me }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/services', () => ({
  listMonitorProjects: async () => ({ data: h.state.projects, error: null }),
  listIncidents: async (scope: string) => ({ data: h.state.incidents.filter((i) => (scope === 'live' ? i.status !== 'resolved' : scope === 'resolved' ? i.status === 'resolved' : true)), error: null }),
  getIncident: async () => ({ data: h.state.detail, error: null }),
  getSeries: async () => ({ data: [{ bucket: new Date().toISOString(), events: 5, errors: 3, fatals: 0, heartbeats: 1, avg_ms: 100, p95_ms: 250, max_ms: 300 }], error: null }),
  getTopErrors: async () => ({ data: [{ fingerprint: 'abcdef0123456789', message: 'DB timeout after N ms', level: 'error', occurrences: 17, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), release: '1.2.0', incident_ref: 'INC-000007' }], error: null }),
  getOccurrences: async (...args: unknown[]) => { h.calls.push({ fn: 'getOccurrences', args }); return { data: [{ occurred_at: new Date().toISOString(), level: 'error', message: 'DB timeout after 30 ms', stack: 'Error\n at query (db.js:1:1)', route: '/api/users', release: '1.2.0', environment: 'production', sdk_version: '0.1.0' }], error: null } },
  listAssignable: async () => ({ data: [{ id: 'me', name: 'Me' }, { id: 'b2', name: 'Devon DevOps' }], error: null }),
  setIncidentStatus: h.rec('setIncidentStatus'), assignIncident: h.rec('assignIncident'), addIncidentNote: h.rec('addIncidentNote'), markDuplicate: h.rec('markDuplicate'),
  setIncidentSeverity: h.rec('setIncidentSeverity'), setRootCause: h.rec('setRootCause'), openIncident: h.rec('openIncident', { id: 'new', error: null }),
  runMonitorChecks: async () => { h.calls.push({ fn: 'runMonitorChecks', args: [] }); return { data: { silent_projects_opened: 1, escalated: 0, events_deleted: 0, hourly_deleted: 0 }, error: null } },
  registerMonitorProject: async (...args: unknown[]) => { h.calls.push({ fn: 'registerMonitorProject', args }); return { id: 'np', error: null } },
  listMonitorKeys: async () => ({ data: h.state.keys, error: null }),
  createMonitorKey: async (...args: unknown[]) => { h.calls.push({ fn: 'createMonitorKey', args }); return { key: 'ctfm_' + 'c'.repeat(48), error: null } },
  revokeMonitorKey: h.rec('revokeMonitorKey'), setMonitorProjectActive: h.rec('setMonitorProjectActive'),
  listDepartmentSummaries: async () => ({ data: { departments: [{ id: 'd1', name: 'DevOps', slug: 'devops' }, { id: 'd2', name: 'Backend Development', slug: 'backend-development' }], unassigned: 0 }, error: null }),
  getSuperDashboard: async () => ({ data: h.state.dash, error: null }),
}))

import { SuperMonitor } from '../../src/pages/monitor/SuperMonitor'
import { SuperDashboard } from '../../src/pages/monitor/SuperDashboard'

const proj = (o: Any = {}): Any => ({ id: 'p1', name: 'Portfolio site', slug: 'portfolio', kind: 'web', active: true, owner_department: 'Backend Development', health: 'healthy', heartbeat_seconds: 300, last_heartbeat_at: new Date().toISOString(), last_event_at: new Date().toISOString(), sdk_name: 'ctf', sdk_version: '0.1.0', release: '1.2.0', open_incidents: 0, worst_severity: null, events_24h: 120, errors_24h: 3, p95_ms_24h: 250, ...o })
const inc = (o: Any = {}): Any => ({ id: 'i1', ref: 'INC-000007', title: 'Errors in Portfolio site: DB timeout', severity: 'high', status: 'open', source: 'auto_errors', project_id: 'p1', project_name: 'Portfolio site', assignee_id: null, assignee_name: null, opened_at: new Date().toISOString(), acknowledged_at: null, resolved_at: null, ack_due_at: new Date(Date.now() + 600_000).toISOString(), escalation_level: 0, reopen_count: 0, duplicate_of_ref: null, ...o })
const detail = (o: Any = {}, notes: Any[] = []): Any => ({ incident: { ...inc(o), fingerprint: 'abc', root_cause: null }, duplicates: [], notes: [{ id: 'n1', kind: 'system', body: 'Opened automatically: the same error kept repeating.', created_at: new Date().toISOString(), author_name: null }, ...notes] })
const monitor$ = (path = '/admin/monitor') => render(<MemoryRouter initialEntries={[path]}><SuperMonitor /></MemoryRouter>)
const dash$ = () => render(<MemoryRouter><SuperDashboard /></MemoryRouter>)

beforeEach(() => { calls.length = 0; state.me = { id: 'me', role: 'worker' }; state.projects = [proj()]; state.incidents = [inc()]; state.detail = detail(); state.keys = []; state.dash = { generated_at: new Date().toISOString(), sections: [] } })

describe('Super Monitor: overview', () => {
  it('lists projects worst first, so a problem is never buried', async () => {
    state.projects = [proj({ id: 'a', name: 'Alpha healthy' }), proj({ id: 'b', name: 'Bravo down', health: 'down' }), proj({ id: 'c', name: 'Charlie degraded', health: 'degraded', open_incidents: 2, worst_severity: 'high' })]
    monitor$()
    await screen.findByText('Bravo down')
    expect(screen.getAllByRole('heading', { level: 2 }).map((x) => x.textContent)).toEqual(['Bravo down', 'Charlie degraded', 'Alpha healthy'])
    expect(screen.getByText(/2 · worst high/)).toBeTruthy()
  })
  it('says what is waiting for an acknowledgement', async () => {
    state.incidents = [inc(), inc({ id: 'i2', ref: 'INC-000008', status: 'reopened' }), inc({ id: 'i3', ref: 'INC-000009', status: 'investigating' })]
    monitor$()
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('2 incidents are waiting'))
  })
  it('tells a worker with no project that there is nothing for them, without offering setup', async () => {
    state.projects = []; state.incidents = []
    monitor$('/worker/monitor')
    expect(await screen.findByText('Nothing to monitor for you yet')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Setup/ })).toBeNull()
  })
  it('offers setup and "Run checks now" to the Main Admin only', async () => {
    monitor$('/worker/monitor')
    await screen.findByText('Portfolio site')
    expect(screen.queryByRole('tab', { name: /Setup/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run checks now' })).toBeNull()
  })
  it('lets the Main Admin run the checks by hand', async () => {
    state.me = { id: 'me', role: 'superadmin' }
    monitor$()
    await userEvent.click(await screen.findByRole('button', { name: 'Run checks now' }))
    await waitFor(() => expect(calls.some((c) => c.fn === 'runMonitorChecks')).toBe(true))
    expect(screen.getByRole('tab', { name: /Setup/ })).toBeTruthy()
  })
  it('shows a project\'s errors, and loads the redacted occurrences only when asked', async () => {
    monitor$()
    await userEvent.click(await screen.findByRole('button', { name: 'Portfolio site' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('DB timeout after N ms')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: /3 errors in the last 24 hours/ })).toBeTruthy()
    expect(calls.some((c) => c.fn === 'getOccurrences')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: /DB timeout after N ms/ }))
    expect(await within(dialog).findByText('DB timeout after 30 ms')).toBeTruthy()
    expect(calls.find((c) => c.fn === 'getOccurrences')?.args).toEqual(['p1', 'abcdef0123456789'])
  })
  it('opens an incident by hand, refusing a too-short title', async () => {
    monitor$()
    await userEvent.click(await screen.findByRole('button', { name: 'Portfolio site' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Open an incident' }))
    const submit = within(dialog).getByRole('button', { name: 'Open incident' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/What is wrong/), 'Checkout is slow')
    await userEvent.selectOptions(within(dialog).getByLabelText('Severity'), 'high')
    await userEvent.click(submit)
    await waitFor(() => expect(calls.find((c) => c.fn === 'openIncident')?.args).toEqual(['p1', 'Checkout is slow', 'high', '']))
  })
})

describe('Super Monitor: an incident', () => {
  const open$ = async (status = 'open', extra: Any = {}) => {
    state.incidents = [inc({ status, ...extra })]; state.detail = detail({ status, ...extra })
    monitor$('/admin/monitor?tab=incidents')
    if (status === 'resolved') await userEvent.click(await screen.findByRole('button', { name: 'Resolved' }))
    await userEvent.click(await screen.findByText('Errors in Portfolio site: DB timeout'))
    return screen.findByRole('dialog')
  }
  it('offers only the moves the database will accept', async () => {
    const dlg = await open$('open')
    const actions = within(dlg).getByRole('group', { name: 'Move this incident forward' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Acknowledge', 'Mark investigating', 'Resolve…'])
  })
  it('offers only "Reopen" on a resolved incident, and hides the editing controls', async () => {
    const dlg = await open$('resolved')
    expect(within(within(dlg).getByRole('group', { name: 'Move this incident forward' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reopen'])
    expect(within(dlg).queryByLabelText('Assign to')).toBeNull()
    expect(within(dlg).queryByLabelText('Severity')).toBeNull()
  })
  it('acknowledges in one click', async () => {
    const dlg = await open$('open')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'setIncidentStatus')?.args).toEqual(['i1', 'acknowledged']))
  })
  it('will not resolve without a real root cause', async () => {
    const dlg = await open$('investigating')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Resolve…' }))
    const submit = within(dlg).getByRole('button', { name: 'Resolve incident' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(dlg).getByLabelText(/What caused it/), 'too short')
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(dlg).getByLabelText(/What caused it/), ' and now it is long enough')
    expect(submit.disabled).toBe(false)
    await userEvent.click(submit)
    await waitFor(() => expect(calls.find((c) => c.fn === 'setIncidentStatus')?.args).toEqual(['i1', 'resolved', 'too short and now it is long enough']))
  })
  it('keeps typing in a field without losing focus', async () => {
    const dlg = await open$('open')
    const note = within(dlg).getByLabelText(/Add a note/) as HTMLTextAreaElement
    await userEvent.type(note, 'checking the pool size')
    expect(note.value).toBe('checking the pool size')
    expect(document.activeElement).toBe(note)
  })
  it('adds a note, and refuses an empty one', async () => {
    const dlg = await open$('acknowledged')
    const add = within(dlg).getByRole('button', { name: 'Add note' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    await userEvent.type(within(dlg).getByLabelText(/Add a note/), 'Looks like the pool.')
    await userEvent.click(add)
    await waitFor(() => expect(calls.find((c) => c.fn === 'addIncidentNote')?.args).toEqual(['i1', 'Looks like the pool.']))
  })
  it('offers only people who can see the project as assignees', async () => {
    const dlg = await open$('acknowledged')
    const select = within(dlg).getByLabelText('Assign to') as HTMLSelectElement
    await waitFor(() => expect([...select.options].map((o) => o.text)).toEqual(['Nobody', 'Me', 'Devon DevOps']))
    await userEvent.selectOptions(select, 'b2')
    await waitFor(() => expect(calls.find((c) => c.fn === 'assignIncident')?.args).toEqual(['i1', 'b2']))
  })
  it('lets you close it as a duplicate of another live incident in the SAME project only', async () => {
    state.incidents = [inc({ status: 'acknowledged' }), inc({ id: 'i2', ref: 'INC-000008', title: 'Checkout is slow' }), inc({ id: 'i3', ref: 'INC-000009', title: 'Other project', project_id: 'p2', project_name: 'Marketing' }), inc({ id: 'i4', ref: 'INC-000010', title: 'Already resolved', status: 'resolved' })]
    state.detail = detail({ status: 'acknowledged' })
    monitor$('/admin/monitor?tab=incidents')
    await userEvent.click(await screen.findByText('Errors in Portfolio site: DB timeout'))
    const dlg = await screen.findByRole('dialog')
    const select = within(dlg).getByLabelText('Close as a duplicate of') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['Choose the original…', 'INC-000008 · Checkout is slow'])
    await userEvent.selectOptions(select, 'i2')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'markDuplicate')?.args).toEqual(['i1', 'i2']))
  })
  it('shows the full history, including automatic entries', async () => {
    state.detail = detail({ status: 'open' }, [{ id: 'n2', kind: 'escalation', body: 'Not acknowledged in time. Escalated to level 1.', created_at: new Date().toISOString(), author_name: null }])
    state.incidents = [inc()]
    monitor$('/admin/monitor?tab=incidents')
    await userEvent.click(await screen.findByText('Errors in Portfolio site: DB timeout'))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('Opened automatically: the same error kept repeating.')).toBeTruthy()
    expect(within(dlg).getByText(/Escalated to level 1/)).toBeTruthy()
  })
  it('counts down the acknowledgement clock in the list', async () => {
    state.incidents = [inc({ ack_due_at: new Date(Date.now() - 12 * 60_000).toISOString(), escalation_level: 1 })]
    monitor$('/admin/monitor?tab=incidents')
    expect(await screen.findByText(/Unacknowledged for 12m · escalated to level 1/)).toBeTruthy()
  })
})

describe('Super Monitor: setup (Main Admin)', () => {
  beforeEach(() => { state.me = { id: 'me', role: 'superadmin' } })
  it('registers a project, filling in the short name from the name', async () => {
    monitor$('/admin/monitor?tab=setup')
    await userEvent.type(await screen.findByLabelText(/Project name/), 'Portfolio Site (v2)')
    expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('portfolio-site-v2')
    await userEvent.selectOptions(screen.getByLabelText('Owning department'), 'backend-development')
    await userEvent.click(screen.getByRole('button', { name: 'Register project' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'registerMonitorProject')?.args[0]).toMatchObject({ name: 'Portfolio Site (v2)', slug: 'portfolio-site-v2', kind: 'web', department: 'backend-development', heartbeatSeconds: 300, burst: 10 }))
  })
  it('shows a new key once, with the setup example, and never lists it afterwards', async () => {
    monitor$('/admin/monitor?tab=setup')
    await userEvent.type(await screen.findByLabelText('Label'), 'production API')
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('ctfm_' + 'c'.repeat(48))).toBeTruthy()
    expect(within(dialog).getByText(/process\.env\.MONITOR_KEY/)).toBeTruthy()
    expect(calls.find((c) => c.fn === 'createMonitorKey')?.args).toEqual(['p1', 'production API', ['events', 'heartbeat'], null])
    await userEvent.click(within(dialog).getByRole('button', { name: 'I have saved it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('ctfm_' + 'c'.repeat(48))).toBeNull()
  })
  it('will not create a key that may send nothing', async () => {
    monitor$('/admin/monitor?tab=setup')
    await userEvent.type(await screen.findByLabelText('Label'), 'k')
    await userEvent.click(screen.getByLabelText(/Errors, messages and latency/)); await userEvent.click(screen.getByLabelText(/Heartbeats/))
    expect((screen.getByRole('button', { name: 'Create key' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('lists keys by their prefix only, and revokes an active one', async () => {
    state.keys = [{ id: 'k1', project_id: 'p1', label: 'production', key_prefix: 'ctfm_ab12', scopes: ['events'], active: true, expires_at: null, created_at: new Date().toISOString(), revoked_at: null, last_used_at: null }, { id: 'k2', project_id: 'p1', label: 'old', key_prefix: 'ctfm_ff00', scopes: ['events'], active: false, expires_at: null, created_at: new Date().toISOString(), revoked_at: new Date().toISOString(), last_used_at: null }]
    monitor$('/admin/monitor?tab=setup')
    expect(await screen.findByText(/ctfm_ab12…/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)   // the revoked key has nothing left to revoke
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'revokeMonitorKey')?.args).toEqual(['k1']))
  })
})

describe('Super Dashboard', () => {
  const money = (currency: string, amount: number, basis: string, count?: number) => ({ currency, amount, basis, ...(count ? { count } : {}) })
  it('shows only the sections the caller was given, with nothing for the rest', async () => {
    state.dash = { generated_at: new Date().toISOString(), sections: ['monitoring'], monitoring: { projects: { total: 3, healthy: 2, degraded: 1, down: 0, unknown: 0, paused: 0 }, incidents: { open: 2, critical: 1, high: 0, unacknowledged: 1, oldest_unacknowledged_minutes: 14 }, errors_24h: 55 } }
    dash$()
    expect(await screen.findByRole('heading', { name: 'Monitoring' })).toBeTruthy()
    expect(screen.getByText(/gone unacknowledged for 14 minutes/)).toBeTruthy()
    for (const name of ['Spending', 'Renewals', 'Customer support', 'Security and audit']) expect(screen.queryByRole('heading', { name })).toBeNull()
  })
  it('labels every money figure with what kind of figure it is', async () => {
    state.dash = { generated_at: new Date().toISOString(), sections: ['finance'], finance: { needs_attention: 2, pending_decision: [money('NGN', 100000, 'pending', 1)], approved_unpaid: [], paid_30d: [money('NGN', 50000, 'actual', 1)], reconciled_30d: [money('USD', 20, 'reconciled', 1)] } }
    dash$()
    await screen.findByRole('heading', { name: 'Spending' })
    for (const label of ['Pending', 'Paid', 'Reconciled']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.getByRole('status').textContent).toMatch(/2 requests need attention/)
    expect(screen.getByRole('list', { name: 'What the labels mean' })).toBeTruthy()
    expect(screen.getAllByText('None').length).toBe(1)   // "approved, not yet paid" has nothing in it
  })
  it('marks renewal amounts as estimates', async () => {
    state.dash = { generated_at: new Date().toISOString(), sections: ['renewals'], renewals: { due_30d_count: 1, critical_due_30d: 1, overdue: 0, due_30d_amount: [money('NGN', 85000, 'estimated')] } }
    dash$()
    expect(await screen.findByText('Estimated')).toBeTruthy()
  })
  it('points the Main Admin to /admin and a worker to /worker', async () => {
    state.dash = { generated_at: new Date().toISOString(), sections: ['monitoring'], monitoring: { projects: { total: 0, healthy: 0, degraded: 0, down: 0, unknown: 0, paused: 0 }, incidents: { open: 0, critical: 0, high: 0, unacknowledged: 0, oldest_unacknowledged_minutes: null }, errors_24h: 0 } }
    state.me = { id: 'me', role: 'superadmin' }
    const { unmount } = dash$()
    expect((await screen.findByRole('link', { name: 'Open Super Monitor' })).getAttribute('href')).toBe('/admin/monitor')
    unmount(); state.me = { id: 'me', role: 'worker' }; dash$()
    expect((await screen.findByRole('link', { name: 'Open Super Monitor' })).getAttribute('href')).toBe('/worker/monitor')
  })
  it('says so plainly when the role covers no section', async () => {
    dash$()
    expect(await screen.findByText('Nothing here for you yet')).toBeTruthy()
  })
})
