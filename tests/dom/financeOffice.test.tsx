import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Any = Record<string, unknown>
const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = []
  const state: { me: Any; myDepts: { department: { id: string; name: string; slug: string }; role: string; isPrimary: boolean }[]; budgets: Any[]; renewals: Any[]; vendors: Any[]; receipts: Any[]; funds: Any[]; panel: Any[]; refunds: Any[]; docs: Any[]; deptDelay: number } =
    { me: { id: 'me', role: 'worker' }, myDepts: [], budgets: [], renewals: [], vendors: [], receipts: [], funds: [], panel: [], refunds: [], docs: [], deptDelay: 0 }
  const rec = (fn: string, ret: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret }
  return { calls, state, rec }
})
const { calls, state } = h

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: h.state.me }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/services', () => ({
  getMyDepartments: async () => { if (h.state.deptDelay) await new Promise((r) => setTimeout(r, h.state.deptDelay)); return { data: h.state.myDepts, error: null } },
  listDepartmentSummaries: async () => ({ data: { departments: [{ id: 'd-fe', name: 'Frontend Development', slug: 'frontend-development' }, { id: 'd-fin', name: 'Finance', slug: 'finance' }], unassigned: 0 }, error: null }),
  listBudgetStatus: async () => ({ data: h.state.budgets, error: null }), createBudget: h.rec('createBudget'), changeBudget: h.rec('changeBudget'), archiveBudget: h.rec('archiveBudget'),
  listRenewals: async () => ({ data: h.state.renewals, error: null }), createRenewal: h.rec('createRenewal'), changeRenewal: h.rec('changeRenewal'), setRenewalStatus: h.rec('setRenewalStatus'),
  markRenewalRenewed: h.rec('markRenewalRenewed'), requestFromRenewal: h.rec('requestFromRenewal', { id: 'new-req', error: null }), sendRenewalReminders: h.rec('sendRenewalReminders', { sent: 2, error: null }),
  listVendors: async () => ({ data: h.state.vendors, error: null }), saveVendor: h.rec('saveVendor'), listMissingReceipts: async () => ({ data: h.state.receipts, error: null }),
  listFundRequests: async () => ({ data: h.state.funds, error: null }), listFundDecisions: async () => ({ data: [], error: null }), listFundDocs: async () => ({ data: h.state.docs, error: null }),
  fundDocUrl: async () => ({ url: null }), uploadFundDoc: async () => ({ error: null }), listCompanySpending: async () => ({ data: [], error: null }),
  createFundRequest: h.rec('createFundRequest'), updateFundRequest: h.rec('updateFundRequest'), submitFundRequest: h.rec('submitFundRequest'), reviewFundRequest: h.rec('reviewFundRequest'),
  cancelFundRequest: h.rec('cancelFundRequest'), beginFundPayment: h.rec('beginFundPayment'), recordFundPayment: h.rec('recordFundPayment'), failFundPayment: h.rec('failFundPayment'),
  reconcileFundRequest: h.rec('reconcileFundRequest'), reverseFundPayment: h.rec('reverseFundPayment'),
  budgetPanelForRequest: async (id: string) => { h.calls.push({ fn: 'budgetPanelForRequest', args: [id] }); return { data: h.state.panel, error: null } },
  listRefunds: async () => ({ data: h.state.refunds, error: null }), recordRefund: h.rec('recordRefund'),
}))

import { FinanceOffice } from '../../src/pages/finance/FinanceOffice'
import { FundRequests } from '../../src/pages/finance/FundRequests'
import { addCycle, periodStart } from '../../src/lib/financeRules'

const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
const dept = (slug: string, name: string, role = 'member') => ({ department: { id: `d-${slug}`, name, slug }, role, isPrimary: false })
const office$ = (tab = '') => render(<MemoryRouter initialEntries={[`/worker/finance${tab}`]}><FinanceOffice /></MemoryRouter>)
const funds$ = (tab = '?tab=all') => render(<MemoryRouter initialEntries={[`/worker/funds${tab}`]}><FundRequests /></MemoryRouter>)
const budget = (o: Any = {}): Any => ({ budget_id: 'b1', department_id: 'd-fe', department_name: 'Frontend Development', category: 'domain', period_kind: 'month', period_start: periodStart('month', iso()), period_end: iso(20), amount: 1000000, currency: 'NGN', note: '', version: 1, pending: 100000, approved_unpaid: 200000, paid: 250000, reconciled: 50000, refunded: 0, spent: 300000, committed: 500000, remaining: 500000, ...o })
const renewal = (o: Any = {}): Any => ({ id: 'n1', department_id: 'd-fe', title: 'codextechfoundation.com domain', category: 'domain', vendor: 'Namecheap', amount: 85000, currency: 'NGN', frequency: 'yearly', next_due: iso(7), critical: false, remind_days: [30, 14, 7, 1], status: 'active', notes: '', last_request_id: null, version: 1, ...o })
const fr = (o: Any = {}): Any => ({ id: 'f1', ref: 'FR-2026-00001', requester_id: 'maya', department_id: 'd-fe', category: 'domain', title: 'Renew the domain', description: '', justification: 'The domain expires soon.', amount: 100000, currency: 'NGN', vendor: 'Namecheap', required_by: null, project_id: null, recurrence: 'none', status: 'finance_review', version: 1, submitted_at: null, decided_at: null, payment_reference: null, amount_paid: null, paid_on: null, payment_recorded_by: null, payment_note: null, reconciled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), requester_name: 'Maya', department_name: 'Frontend Development', ...o })

beforeEach(() => {
  calls.length = 0; state.me = { id: 'me', role: 'worker' }; state.myDepts = [dept('frontend-development', 'Frontend Development')]
  state.budgets = []; state.renewals = []; state.vendors = []; state.receipts = []; state.funds = []; state.panel = []; state.refunds = []; state.docs = []; state.deptDelay = 0
})

describe('Finance office tabs follow the person', () => {
  it('shows an ordinary worker only Renewals and Vendors', async () => {
    office$()
    await screen.findByRole('tab', { name: 'Renewals' })
    expect(screen.queryByRole('tab', { name: 'Budgets' })).toBeNull(); expect(screen.queryByRole('tab', { name: /Missing receipts/ })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Vendors' })).toBeTruthy()
  })
  it('shows a department admin Budgets as well (their own, as the database decides)', async () => {
    state.myDepts = [dept('frontend-development', 'Frontend Development', 'admin')]
    office$()
    expect(await screen.findByRole('tab', { name: 'Budgets' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Missing receipts/ })).toBeNull()
  })
  it('shows Finance members every tab, and the Main Admin too', async () => {
    state.myDepts = [dept('finance', 'Finance')]
    const { unmount } = office$()
    for (const n of ['Budgets', 'Renewals', 'Vendors', 'Missing receipts']) expect(await screen.findByRole('tab', { name: n })).toBeTruthy()
    unmount(); state.me = { id: 'me', role: 'superadmin' }; state.myDepts = []
    office$()
    for (const n of ['Budgets', 'Renewals', 'Vendors', 'Missing receipts']) expect(await screen.findByRole('tab', { name: n })).toBeTruthy()
  })
})

describe('Budgets', () => {
  it('shows what is committed and remaining, and warns when a budget is over', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    state.budgets = [budget(), budget({ budget_id: 'b2', category: 'hosting', amount: 400000, committed: 450000, remaining: -50000 })]
    office$('?tab=budgets')
    expect(await screen.findByText('Within budget')).toBeTruthy()
    expect(screen.getByText('Over budget')).toBeTruthy()
    expect(screen.getAllByText(/Pending ₦100,000\.00/)).toHaveLength(2)
    expect(screen.getAllByText(/Refunded/)).toHaveLength(2)
    const meters = screen.getAllByRole('meter')
    expect(meters[0].getAttribute('aria-valuenow')).toBe('50')
    expect(meters[1].getAttribute('aria-valuenow')).toBe('100')   // the bar stops at full, the label says Over budget
  })
  it('lets only the Finance Manager or Main Admin set a budget', async () => {
    state.myDepts = [dept('finance', 'Finance')]   // an officer, not the manager
    const { unmount } = office$('?tab=budgets')
    await screen.findByText('No budget covers this date')
    expect(screen.queryByRole('button', { name: /Set a budget/ })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=budgets')
    expect(await screen.findByRole('button', { name: /Set a budget/ })).toBeTruthy()
  })
  it('sends the first day of the chosen period, the amount, and nothing else invented', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=budgets')
    await userEvent.click(await screen.findByRole('button', { name: /Set a budget/ }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Set budget' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '750000')
    await userEvent.selectOptions(within(dialog).getByLabelText('Period'), 'quarter')
    await userEvent.click(save)
    await waitFor(() => expect(calls.at(-1)?.fn).toBe('createBudget'))
    expect(calls.at(-1)?.args[0]).toEqual({ department_id: null, category: null, period_kind: 'quarter', period_start: periodStart('quarter', iso()), amount: 750000, currency: 'NGN', note: '' })
  })
  it('archives only after a second, explicit confirmation', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.budgets = [budget()]
    office$('?tab=budgets')
    await userEvent.click(await screen.findByText('Frontend Development · Domain'))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(calls.some((c) => c.fn === 'archiveBudget')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm archive' }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'archiveBudget', args: ['b1', expect.any(String)] }))
  })
})

describe('Renewals', () => {
  it('shows how soon each is due and flags the overdue and critical ones', async () => {
    state.renewals = [renewal(), renewal({ id: 'n2', title: 'API credits', next_due: iso(-3), critical: true })]
    office$('?tab=renewals')
    expect(await screen.findByText('Due in 7 days')).toBeTruthy()
    expect(screen.getByText('3 days overdue')).toBeTruthy()
    expect(screen.getByText('Critical')).toBeTruthy()
  })
  it('turns a renewal into a draft fund request (never a payment) and goes to it', async () => {
    const assign = vi.fn(); Object.defineProperty(window, 'location', { value: { ...window.location, assign, pathname: '/worker/finance' }, writable: true })
    state.renewals = [renewal()]
    office$('?tab=renewals')
    await userEvent.click(await screen.findByText('codextechfoundation.com domain'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/still needs Finance, department and Main Admin approval/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create a fund request' }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'requestFromRenewal', args: ['n1'] }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/worker/funds?tab=mine&open=new-req'))
  })
  it('offers the reminder button to Finance only', async () => {
    state.renewals = [renewal()]
    const { unmount } = office$('?tab=renewals')
    await screen.findByText('Due in 7 days')
    expect(screen.queryByRole('button', { name: /Send due reminders/ })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance')]
    office$('?tab=renewals')
    await userEvent.click(await screen.findByRole('button', { name: /Send due reminders/ }))
    await waitFor(() => expect(calls.at(-1)?.fn).toBe('sendRenewalReminders'))
  })
  it('lets a department admin add one for their own department only, with sorted reminder days', async () => {
    state.myDepts = [dept('frontend-development', 'Frontend Development', 'admin'), dept('devops', 'DevOps')]
    office$('?tab=renewals')
    await userEvent.click(await screen.findByRole('button', { name: /Add a renewal/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('option').filter((o) => ['Frontend Development', 'DevOps'].includes(o.textContent ?? '')).map((o) => o.textContent)).toEqual(['Frontend Development'])
    await userEvent.type(within(dialog).getByLabelText(/What renews/), 'Hosting plan')
    await userEvent.type(within(dialog).getByLabelText(/Amount per cycle/), '12000')
    await userEvent.type(within(dialog).getByLabelText(/Next due/), iso(30))
    const reminders = within(dialog).getByLabelText(/Remind me/)
    await userEvent.clear(reminders); await userEvent.type(reminders, '400')
    const add = within(dialog).getByRole('button', { name: 'Add renewal' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)   // 400 days is out of range
    await userEvent.clear(reminders); await userEvent.type(reminders, '1, 14, 7')
    await userEvent.click(add)
    await waitFor(() => expect(calls.at(-1)?.fn).toBe('createRenewal'))
    expect(calls.at(-1)?.args[0]).toMatchObject({ department_id: 'd-frontend-development', title: 'Hosting plan', amount: 12000, frequency: 'yearly', critical: false, remind_days: [14, 7, 1] })
  })
  it('hides "Mark as renewed" from department admins and proposes the next cycle to Finance', async () => {
    state.renewals = [renewal({ frequency: 'monthly', next_due: '2026-01-31', department_id: 'd-frontend-development' })]
    state.myDepts = [dept('frontend-development', 'Frontend Development', 'admin')]
    const { unmount } = office$('?tab=renewals')
    await userEvent.click(await screen.findByText('codextechfoundation.com domain'))
    await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Edit' })
    expect(screen.queryByRole('button', { name: 'Mark as renewed' })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=renewals')
    await userEvent.click(await screen.findByText('codextechfoundation.com domain'))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as renewed' }))
    expect((screen.getByLabelText('Next due date') as HTMLInputElement).value).toBe(addCycle('2026-01-31', 'monthly'))
    expect(addCycle('2026-01-31', 'monthly')).toBe('2026-02-28')
  })
})

describe('Vendors and missing receipts', () => {
  it('lets Finance managers add vendors, refuses a website that is not https, and hides the button from others', async () => {
    const { unmount } = office$('?tab=vendors')
    await screen.findByText('No vendors yet')
    expect(screen.queryByRole('button', { name: /Add a vendor/ })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=vendors')
    await userEvent.click(await screen.findByRole('button', { name: /Add a vendor/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Namecheap')
    await userEvent.type(within(dialog).getByLabelText('Website'), 'javascript:alert(1)')
    const add = within(dialog).getByRole('button', { name: 'Add vendor' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    await userEvent.clear(within(dialog).getByLabelText('Website')); await userEvent.type(within(dialog).getByLabelText('Website'), 'https://www.namecheap.com')
    await userEvent.click(add)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'saveVendor', args: [{ name: 'Namecheap', website: 'https://www.namecheap.com', status: 'active' }] }))
  })
  it('opens vendor websites safely', async () => {
    state.vendors = [{ id: 'v1', name: 'Namecheap', category: 'domain', website: 'https://www.namecheap.com', status: 'active' }]
    office$('?tab=vendors')
    const link = await screen.findByRole('link', { name: 'www.namecheap.com' })
    expect(link.getAttribute('rel')).toBe('noopener noreferrer'); expect(link.getAttribute('target')).toBe('_blank')
  })
  it('lists payments waiting for a receipt, linking to the request', async () => {
    state.myDepts = [dept('finance', 'Finance')]
    state.receipts = [{ request_id: 'f9', ref: 'FR-2026-00009', title: 'Hosting', department_name: 'DevOps', amount_paid: 50000, currency: 'NGN', paid_on: iso(-20), days_open: 20 }]
    office$('?tab=receipts')
    const link = await screen.findByRole('link', { name: 'Hosting' })
    expect(link.getAttribute('href')).toBe('/worker/funds?tab=all&open=f9')
    expect(screen.getByText('20 days')).toBeTruthy()
  })
})

describe('Fund request detail: budget, refunds and receipts', () => {
  const panelRow = (o: Any = {}): Any => ({ budget_id: 'b1', scope: 'department_category', period_kind: 'month', period_start: periodStart('month', iso()), period_end: iso(20), amount: 1000000, currency: 'NGN', pending: 0, approved_unpaid: 200000, paid: 250000, reconciled: 50000, refunded: 40000, this_request: 600000, remaining_after: -60000, over_budget: true, ...o })
  it('shows a Finance reviewer the budget check, and says when approving would exceed it', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr()]; state.panel = [panelRow()]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    const dialog = await screen.findByRole('dialog')
    const panel = await within(dialog).findByLabelText('Budget check')
    expect(within(panel).getByText('Would exceed it')).toBeTruthy()
    expect(panel.textContent).toContain('left if approved')
    expect(panel.textContent).toMatch(/-₦60,000\.00|₦-60,000\.00|−₦60,000\.00/)
    expect(calls.some((c) => c.fn === 'budgetPanelForRequest' && c.args[0] === 'f1')).toBe(true)
  })
  it('shows the budget check when the request is opened straight from a link, before departments have loaded', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr()]; state.panel = [panelRow()]; state.deptDelay = 60   // the request list arrives first
    funds$('?tab=all&open=f1')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Would exceed it')).toBeTruthy()
    expect(within(dialog).queryByText(/No budget covers/)).toBeNull()
  })
  it('says so when no budget covers the request', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr()]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    expect(await within(await screen.findByRole('dialog')).findByText(/No budget covers this department/)).toBeTruthy()
  })
  it('does not fetch or show budget figures for the requester', async () => {
    state.me = { id: 'maya', role: 'worker' }; state.funds = [fr()]
    funds$('?tab=mine')
    await userEvent.click(await screen.findByText('Renew the domain'))
    await screen.findByRole('dialog')
    expect(screen.queryByLabelText('Budget check')).toBeNull()
    expect(calls.some((c) => c.fn === 'budgetPanelForRequest')).toBe(false)
  })
  it('lets the Finance Manager record a refund with a reference, and only up to what is left', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    state.funds = [fr({ status: 'paid', amount_paid: 100000, paid_on: iso(-1), payment_reference: 'TRX-1' })]
    state.refunds = [{ id: 'r1', request_id: 'f1', kind: 'refund', amount: 30000, currency: 'NGN', reference: 'RFD-1', received_on: iso(), note: 'Vendor credit', created_at: new Date().toISOString() }]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/RFD-1/)).toBeTruthy()
    expect(within(dialog).getByText(/Net cost ₦70,000\.00/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a refund' }))
    expect(within(dialog).getByText(/up to ₦70,000\.00 more/)).toBeTruthy()
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '20000')
    await userEvent.type(within(dialog).getByLabelText(/Reference/), 'CB-77')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'chargeback')
    await userEvent.click(confirm)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'recordRefund', args: ['f1', 'chargeback', 20000, 'CB-77', iso(), ''] }))
  })
  it('offers no refund button to a Finance Officer, to the requester, or on a request that was never paid', async () => {
    state.funds = [fr({ status: 'paid', amount_paid: 100000, paid_on: iso(-1) })]
    state.myDepts = [dept('finance', 'Finance')]   // officer
    const { unmount } = funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    await within(await screen.findByRole('dialog')).findByText(/Refunds and chargebacks/)
    expect(screen.queryByRole('button', { name: 'Record a refund' })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance', 'admin')]; state.funds = [fr({ status: 'approved' })]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Record a refund' })).toBeNull()
    expect(screen.queryByText(/Refunds and chargebacks/)).toBeNull()
  })
  it('flags a payment with no receipt after three days, and not when a document is attached or it is recent', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    state.funds = [fr({ status: 'paid', amount_paid: 100000, paid_on: iso(-10) })]
    const { unmount } = funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    expect(await within(await screen.findByRole('dialog')).findByText(/No receipt or invoice is attached/)).toBeTruthy()
    unmount(); state.docs = [{ path: 'f1/receipt.pdf', name: '1-receipt.pdf' }]
    const second = funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    await within(await screen.findByRole('dialog')).findByText('receipt.pdf')
    expect(screen.queryByText(/No receipt or invoice is attached/)).toBeNull()
    second.unmount(); state.docs = []; state.funds = [fr({ status: 'paid', amount_paid: 100000, paid_on: iso(-1) })]
    funds$()
    await userEvent.click(await screen.findByText('Renew the domain'))
    await within(await screen.findByRole('dialog')).findByText(/Refunds and chargebacks/)
    expect(screen.queryByText(/No receipt or invoice is attached/)).toBeNull()
  })
})
