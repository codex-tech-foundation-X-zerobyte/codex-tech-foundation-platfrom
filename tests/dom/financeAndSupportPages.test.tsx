import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Any = Record<string, unknown>
const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = []
  const state: { me: Record<string, unknown>; myDepts: { department: { id: string; name: string; slug: string }; role: string; isPrimary: boolean }[]; funds: Record<string, unknown>[]; tickets: Record<string, unknown>[]; messages: Record<string, unknown>[] } =
    { me: { id: 'me', role: 'worker' }, myDepts: [], funds: [], tickets: [], messages: [] }
  const rec = (fn: string, ret: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret }
  return { calls, state, rec }
})
const { calls, state, rec } = h

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: h.state.me }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/services', () => ({
  getMyDepartments: async () => ({ data: h.state.myDepts, error: null }),
  listDepartmentSummaries: async () => ({ data: { departments: [{ id: 'd-fe', name: 'Frontend Development', slug: 'frontend-development' }], unassigned: 0 }, error: null }),
  listFundRequests: async () => ({ data: h.state.funds, error: null }),
  listFundDecisions: async () => ({ data: [{ id: 'x1', version: 1, stage: 'requester', decision: 'submitted', reason: '', actor_id: 'maya', actor_name: 'Maya', acted_as: 'role', created_at: new Date().toISOString() }], error: null }),
  listFundDocs: async () => ({ data: [], error: null }), fundDocUrl: async () => ({ url: null }), uploadFundDoc: async () => ({ error: null }),
  listCompanySpending: async () => ({ data: [], error: null }),
  budgetPanelForRequest: async () => ({ data: [], error: null }), listRefunds: async () => ({ data: [], error: null }), recordRefund: h.rec('recordRefund'),
  createFundRequest: h.rec('createFundRequest', { id: 'new1', error: null }), updateFundRequest: h.rec('updateFundRequest'), submitFundRequest: h.rec('submitFundRequest'),
  reviewFundRequest: h.rec('reviewFundRequest'), cancelFundRequest: h.rec('cancelFundRequest'), beginFundPayment: h.rec('beginFundPayment'), recordFundPayment: h.rec('recordFundPayment'),
  failFundPayment: h.rec('failFundPayment'), reconcileFundRequest: h.rec('reconcileFundRequest'), reverseFundPayment: h.rec('reverseFundPayment'),
  listTickets: async () => ({ data: h.state.tickets, error: null }), listTicketMessages: async () => ({ data: h.state.messages, error: null }), listSupportAgents: async () => ({ data: [{ id: 'me', name: 'Me' }, { id: 'ag2', name: 'Ada' }], error: null }),
  listSupportSources: async () => ({ data: [{ id: 's1', name: 'Portfolio site', key_prefix: 'ctfs_ab12', active: true, created_at: new Date().toISOString(), last_used_at: null }], error: null }),
  replyToTicket: h.rec('replyToTicket'), assignTicket: h.rec('assignTicket'), setTicketStatus: h.rec('setTicketStatus'), escalateTicket: h.rec('escalateTicket'), createSupportTicket: h.rec('createSupportTicket', { id: 't9', error: null }),
  connectSupportProject: async (name: string) => { h.calls.push({ fn: 'connectSupportProject', args: [name] }); return { key: 'ctfs_' + 'a'.repeat(48), error: null } }, setSupportProjectActive: h.rec('setSupportProjectActive'),
}))

import { FundRequests } from '../../src/pages/finance/FundRequests'
import { SupportDesk } from '../../src/pages/support/SupportDesk'

const fr = (o: Any = {}): Any => ({ id: 'f1', ref: 'FR-2026-00001', requester_id: 'maya', department_id: 'd-fe', category: 'domain', title: 'Renew the domain', description: '', justification: 'The domain expires soon.', amount: 100000, currency: 'NGN', vendor: 'Namecheap', required_by: null, project_id: null, recurrence: 'none', status: 'finance_review', version: 1, submitted_at: null, decided_at: null, payment_reference: null, amount_paid: null, paid_on: null, payment_recorded_by: null, payment_note: null, reconciled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), requester_name: 'Maya', department_name: 'Frontend Development', ...o })
const dept = (slug: string, name: string, role = 'member') => ({ department: { id: `d-${slug}`, name, slug }, role, isPrimary: false })
const funds$ = (tab = '') => render(<MemoryRouter initialEntries={[`/worker/funds${tab}`]}><FundRequests /></MemoryRouter>)
const support$ = (tab = '') => render(<MemoryRouter initialEntries={[`/worker/support${tab}`]}><SupportDesk /></MemoryRouter>)

beforeEach(() => { calls.length = 0; state.me = { id: 'me', role: 'worker' }; state.myDepts = [{ department: { id: 'd-fe', name: 'Frontend Development', slug: 'frontend-development' }, role: 'member', isPrimary: true }]; state.funds = []; state.tickets = []; state.messages = [] })

describe('Fund requests page', () => {
  it('lets a worker raise a request, and will not submit without a reason', async () => {
    funds$()
    await userEvent.click(await screen.findByRole('button', { name: /New request/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/What do you need/), 'API credits')
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '50000')
    expect((within(dialog).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)   // no justification yet
    await userEvent.type(within(dialog).getByLabelText(/Why is it needed/), 'We are running out of credits this week.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(calls[0]).toMatchObject({ fn: 'createFundRequest' }))
    const [input, submit, key] = calls[0].args as [Any, boolean, string]
    expect(input).toMatchObject({ title: 'API credits', amount: 50000, currency: 'NGN', department_id: 'd-fe' })
    expect(submit).toBe(true); expect(key).toMatch(/[0-9a-f-]{36}/)    // an idempotency key, so a double-click cannot create two
  })
  it("only offers departments the worker belongs to", async () => {
    state.myDepts = [dept('frontend-development', 'Frontend Development'), dept('devops', 'DevOps')]
    funds$()
    await userEvent.click(await screen.findByRole('button', { name: /New request/ }))
    const opts = within(await screen.findByLabelText('Department')).getAllByRole('option').map((o) => o.textContent)
    expect(opts.sort()).toEqual(['DevOps', 'Frontend Development'])
  })
  it('shows a Finance Manager the Finance review with approve, return and reject, and requires a reason to reject', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr()]
    funds$('?tab=queue')
    await userEvent.click(await screen.findByText('Renew the domain'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/does not authorise payment/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Over budget this month.')
    await userEvent.click(confirm)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'reviewFundRequest', args: ['f1', 1, 'finance', 'rejected', 'Over budget this month.'] }))
  })
  it('approves with the exact version it displayed, so a changed request cannot slip through', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr({ version: 3 })]
    funds$('?tab=queue')
    await userEvent.click(await screen.findByText('Renew the domain'))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls.at(-1)?.args).toEqual(['f1', 3, 'finance', 'approved', '']))
  })
  it('offers no review, payment or edit actions to an ordinary worker looking at someone else\'s request', async () => {
    state.funds = [fr({ requester_id: 'maya' })]; state.me = { id: 'me', role: 'worker' }
    funds$('?tab=all')            // not a finance member: the tab does not exist, fall back to My requests
    expect(screen.queryByText('Renew the domain')).toBeNull()
    expect(screen.queryByRole('tab', { name: /All requests/ })).toBeNull()
  })
  it('does not let a Finance Manager review or pay their own request', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr({ requester_id: 'me', status: 'approved' })]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Start payment' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).toBeNull()
  })
  it('does not offer to record a payment until one has been started, and then needs a real reference', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr({ status: 'approved' })]
    const first = funds$('?tab=queue')
    await userEvent.click(await screen.findByText('Renew the domain'))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Start payment' })).toBeTruthy()
    first.unmount()
    state.funds = [fr({ status: 'payment_processing' })]
    funds$('?tab=queue')
    await userEvent.click(await screen.findByText('Renew the domain'))
    dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Transaction reference/), 'TRX-9981')
    await userEvent.click(confirm)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'recordFundPayment', args: ['f1', 'TRX-9981', 100000, expect.any(String), ''] }))
  })
  it('flags a payment that differs from what was approved', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr({ status: 'reconciliation_required', payment_reference: 'TRX-1', amount_paid: 95000, paid_on: '2026-10-20', payment_recorded_by: 'other' })]
    funds$('?tab=queue')
    await userEvent.click(await screen.findByText('Renew the domain'))
    expect(await screen.findByText(/Differs from the approved/)).toBeTruthy()
  })
})

const tk = (o: Any = {}): Any => ({ id: 't1', ref: 'TKT-000001', source_id: 's1', external_ref: 'o1', customer_ref: 'u9', customer_name: 'Ada', subject: 'Cannot log in', description: 'It fails', category: 'account', priority: 'high', status: 'open', assignee_id: null, escalated_department_id: null, created_by: null, due_at: new Date(Date.now() - 3_600_000).toISOString(), first_response_at: null, resolved_at: null, rating: null, rating_note: null, created_at: new Date(Date.now() - 7_200_000).toISOString(), updated_at: new Date().toISOString(), assignee_name: null, source_name: 'Portfolio site', ...o })

describe('Support desk', () => {
  beforeEach(() => { state.myDepts = [dept('customer-service', 'Customer Service')] })
  it('lists tickets with their overdue state', async () => {
    state.tickets = [tk()]; support$()
    expect(await screen.findByText('Cannot log in')).toBeTruthy()
    expect(screen.getByText(/Overdue by/)).toBeTruthy()
  })
  it('separates a reply the customer will read from an internal note, visibly and in what is sent', async () => {
    state.tickets = [tk()]; state.messages = [{ id: 'm1', author_id: 'a', author_kind: 'agent', visibility: 'internal', body: 'Looks like the cookie bug.', created_at: new Date().toISOString(), author_name: 'Ada' }, { id: 'm2', author_id: 'a', author_kind: 'agent', visibility: 'public', body: 'We are on it.', created_at: new Date().toISOString(), author_name: 'Ada' }]
    support$()
    await userEvent.click(await screen.findByText('Cannot log in'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Looks like the cookie bug.').closest('li')?.className).toContain('is-internal')
    expect(within(dialog).getByText('We are on it.').closest('li')?.className).not.toContain('is-internal')
    expect(within(dialog).getByText('Customer can see')).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText('Reply to the customer'), 'Please try again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to customer' }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'replyToTicket', args: ['t1', 'Please try again.', 'public'] }))
    await userEvent.click(within(dialog).getByRole('button', { name: /Internal note/ }))
    await userEvent.type(within(dialog).getByLabelText('Internal note'), 'Customer on old app version.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'replyToTicket', args: ['t1', 'Customer on old app version.', 'internal'] }))
  })
  it('requires a note before escalating, and escalates only to technical departments', async () => {
    state.tickets = [tk({ assignee_id: 'me', status: 'in_progress' })]; support$()
    await userEvent.click(await screen.findByText('Cannot log in'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /Escalate to a technical team/ }))
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Backend Development', 'DevOps', 'Cybersecurity', 'Frontend Development']))
    const go = within(dialog).getByRole('button', { name: 'Escalate' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/What do you need from them/), 'Login returns 500 for this customer.')
    await userEvent.click(go)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'escalateTicket', args: ['t1', 'backend-development', 'Login returns 500 for this customer.'] }))
  })
  it("won't let an agent change a ticket assigned to a colleague, but lets them see it", async () => {
    state.tickets = [tk({ assignee_id: 'ag2', assignee_name: 'Ada', status: 'in_progress' })]; support$()
    await userEvent.click(await screen.findByText('Cannot log in'))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true)
    expect(within(dialog).queryByRole('button', { name: /Escalate to a technical team/ })).toBeNull()
  })
  it('shows leads connected projects and performance, but not to a plain agent', async () => {
    state.tickets = []; support$()
    expect(await screen.findByRole('tab', { name: /Inbox/ })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Connected projects/ })).toBeNull()
  })
  it('shows a lead the connected projects and gives the new key exactly once, never in the list', async () => {
    state.myDepts = [dept('customer-service', 'Customer Service', 'admin')]; state.me = { id: 'me', role: 'superadmin' }
    support$('?tab=projects')
    expect(await screen.findByText('Portfolio site')).toBeTruthy()
    expect(screen.getByText(/Key ctfs_ab12…/)).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Project name'), 'Docs site')
    await userEvent.click(screen.getByRole('button', { name: /Connect project/ }))
    expect(await screen.findByText(/ctfs_a{48}/)).toBeTruthy()
    expect(screen.getByText(/only time it is shown/i)).toBeTruthy()
  })
  it('tells a technical-department member there is nothing for them unless a ticket was escalated to them', async () => {
    state.myDepts = [dept('backend-development', 'Backend Development')]; state.tickets = []; support$()
    expect(await screen.findByText('Nothing here for you')).toBeTruthy()
  })
})
