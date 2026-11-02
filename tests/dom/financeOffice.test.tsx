import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Any = Record<string, unknown>
const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = []
  const state: { me: Any; myDepts: { department: { id: string; name: string; slug: string }; role: string; isPrimary: boolean }[]; budgets: Any[]; renewals: Any[]; vendors: Any[]; receipts: Any[]; funds: Any[]; panel: Any[]; refunds: Any[]; docs: Any[]; deptDelay: number; report: Any | null; lines: Any[]; income: Any[] } =
    { me: { id: 'me', role: 'worker' }, myDepts: [], budgets: [], renewals: [], vendors: [], receipts: [], funds: [], panel: [], refunds: [], docs: [], deptDelay: 0, report: null, lines: [], income: [] }
  const downloads: { name: string; text: string }[] = []
  const rec = (fn: string, ret: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret }
  return { calls, state, rec, downloads }
})
const { calls, state, downloads } = h

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: h.state.me }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/financeReports', async (orig) => ({ ...(await orig<typeof import('../../src/lib/financeReports')>()), downloadText: (name: string, text: string) => { h.downloads.push({ name, text }) } }))
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
  financeReport: async (...args: unknown[]) => { h.calls.push({ fn: 'financeReport', args }); return h.state.report ? { data: h.state.report, error: null } : { data: null, error: new Error('Reports are for Finance.') } },
  financeReportLines: async (...args: unknown[]) => { h.calls.push({ fn: 'financeReportLines', args }); return { data: h.state.lines, error: null } },
  listIncome: async () => ({ data: h.state.income, error: null }), recordIncome: h.rec('recordIncome'), reverseIncome: h.rec('reverseIncome'),
}))

import { FinanceOffice } from '../../src/pages/finance/FinanceOffice'
import { FundRequests } from '../../src/pages/finance/FundRequests'
import { addCycle, periodStart } from '../../src/lib/financeRules'
import { presetRange } from '../../src/lib/financeReports'

const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
const dept = (slug: string, name: string, role = 'member') => ({ department: { id: `d-${slug}`, name, slug }, role, isPrimary: false })
const office$ = (tab = '') => render(<MemoryRouter initialEntries={[`/worker/finance${tab}`]}><FinanceOffice /></MemoryRouter>)
const funds$ = (tab = '?tab=all') => render(<MemoryRouter initialEntries={[`/worker/funds${tab}`]}><FundRequests /></MemoryRouter>)
const budget = (o: Any = {}): Any => ({ budget_id: 'b1', department_id: 'd-fe', department_name: 'Frontend Development', category: 'domain', period_kind: 'month', period_start: periodStart('month', iso()), period_end: iso(20), amount: 1000000, currency: 'NGN', note: '', version: 1, pending: 100000, approved_unpaid: 200000, paid: 250000, reconciled: 50000, refunded: 0, spent: 300000, committed: 500000, remaining: 500000, ...o })
const renewal = (o: Any = {}): Any => ({ id: 'n1', department_id: 'd-fe', title: 'codextechfoundation.com domain', category: 'domain', vendor: 'Namecheap', amount: 85000, currency: 'NGN', frequency: 'yearly', next_due: iso(7), critical: false, remind_days: [30, 14, 7, 1], status: 'active', notes: '', last_request_id: null, version: 1, ...o })
const fr = (o: Any = {}): Any => ({ id: 'f1', ref: 'FR-2026-00001', requester_id: 'maya', department_id: 'd-fe', category: 'domain', title: 'Renew the domain', description: '', justification: 'The domain expires soon.', amount: 100000, currency: 'NGN', vendor: 'Namecheap', required_by: null, project_id: null, recurrence: 'none', status: 'finance_review', version: 1, submitted_at: null, decided_at: null, payment_reference: null, amount_paid: null, paid_on: null, payment_recorded_by: null, payment_note: null, reconciled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), requester_name: 'Maya', department_name: 'Frontend Development', ...o })

beforeEach(() => {
  calls.length = 0; state.me = { id: 'me', role: 'worker' }; state.myDepts = [dept('frontend-development', 'Frontend Development')]
  state.budgets = []; state.renewals = []; state.vendors = []; state.receipts = []; state.funds = []; state.panel = []; state.refunds = []; state.docs = []; state.deptDelay = 0; state.report = null; state.lines = []; state.income = []; downloads.length = 0
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

const group = (label: string, o: Any = {}): Any => ({ key: label, label, requested: 600000, approved: 500000, paid: 250000, refunded: 40000, net: 210000, ...o })
const report = (o: Any = {}): Any => ({
  meta: { from: iso(-30), to: iso(), currency: 'NGN', department_id: null, scope: 'company', generated_at: new Date().toISOString(), generated_by: 'Ada Okafor', basis: ['Income is only money Codex itself earned and recorded.'] },
  submitted: { requested: 650000, approved: 550000 }, moved: { paid: 300000, refunded: 40000, net_spend: 260000, income: 650000, net_position: 390000 }, income_by_source: [{ source: 'client_work_fee', amount: 450000 }],
  pending_approvals: { count: 1, amount: 100000 }, approved_unpaid: { count: 2, amount: 200000 }, discrepancies: { count: 1, amount: 50000 }, missing_receipts: { count: 3, amount: 700000 },
  renewals: { due_within_30_days: 2, amount_due_within_30_days: 335000, overdue: 1 },
  by_department: [group('Frontend Development'), group('Backend Development', { paid: 50000, net: 50000, refunded: 0 })], by_category: [group('domain')], by_vendor: [group('Namecheap')], by_project: [group('(no project)')],
  by_month: [{ month: '2026-10', paid: 300000, refunded: 40000, income: 650000 }], ...o,
})

describe('Reports tab', () => {
  beforeEach(() => { state.myDepts = [dept('finance', 'Finance')] })
  it('is for Finance only', async () => {
    state.myDepts = [dept('frontend-development', 'Frontend Development', 'admin')]
    office$()
    await screen.findByRole('tab', { name: 'Renewals' })
    expect(screen.queryByRole('tab', { name: 'Reports' })).toBeNull(); expect(screen.queryByRole('tab', { name: 'Income' })).toBeNull()
  })
  it('starts empty, defaults to the monthly period, and does not generate (and log) anything until asked', async () => {
    office$('?tab=reports')
    expect(await screen.findByText('Choose a period and generate a report')).toBeTruthy()
    const { from, to } = presetRange('month', iso())
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(from); expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe(to)
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true')
    expect(calls.some((c) => c.fn === 'financeReport')).toBe(false)
  })
  it('changes the dates with the preset, and marks the period custom when a date is edited', async () => {
    office$('?tab=reports')
    await userEvent.click(await screen.findByRole('button', { name: 'Yearly' }))
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(presetRange('year', iso()).from)
    await userEvent.click(screen.getByRole('button', { name: 'Daily' }))
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(iso())
    const from = screen.getByLabelText('From')
    await userEvent.clear(from); await userEvent.type(from, iso(-3))
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('refuses an impossible range or currency before asking the database', async () => {
    office$('?tab=reports')
    const gen = await screen.findByRole('button', { name: 'Generate report' }) as HTMLButtonElement
    expect(gen.disabled).toBe(false)
    const cur = screen.getByLabelText(/Currency/); await userEvent.clear(cur); await userEvent.type(cur, 'NG')
    expect(gen.disabled).toBe(true); expect(screen.getByRole('alert').textContent).toMatch(/three-letter/)
    await userEvent.type(cur, 'N')
    const to = screen.getByLabelText('To'); await userEvent.clear(to); await userEvent.type(to, iso(-60))
    expect(gen.disabled).toBe(true); expect(screen.getByRole('alert').textContent).toMatch(/cannot be after/)
  })
  it('generates the company report and shows each kind of figure separately', async () => {
    state.report = report()
    office$('?tab=reports')
    await userEvent.click(await screen.findByRole('button', { name: 'Generate report' }))
    const view = await screen.findByLabelText('Finance report')
    const { from, to } = presetRange('month', iso())
    expect(calls.at(-1)).toMatchObject({ fn: 'financeReport', args: [from, to, 'NGN', null] })
    for (const t of ['Submitted in this period', 'Money moved in this period']) expect(within(view).getByText(t)).toBeTruthy()
    expect(within(view).getByText(/As of .* \(not limited to the period\)/)).toBeTruthy()
    expect(within(view).getByText('Net position')).toBeTruthy(); expect(within(view).getByText('₦390,000.00')).toBeTruthy()
    expect(within(view).getByText(/Fee for Codex.s own work ₦450,000\.00/)).toBeTruthy()
    expect(within(view).getByText('Paid differs by ₦50,000.00')).toBeTruthy()
    expect(within(view).getByText(/1 overdue/)).toBeTruthy()
    expect(within(view).getByText('Frontend Development')).toBeTruthy()
    expect(within(view).getByText(/generated .* by Ada Okafor/)).toBeTruthy()
    await userEvent.click(within(view).getByText('How these figures are counted'))
    expect(within(view).getByText('Income is only money Codex itself earned and recorded.')).toBeTruthy()
  })
  it('switches the breakdown, and shows months with income', async () => {
    state.report = report()
    office$('?tab=reports')
    await userEvent.click(await screen.findByRole('button', { name: 'Generate report' }))
    const view = await screen.findByLabelText('Finance report')
    await userEvent.click(within(view).getByRole('tab', { name: 'Category' }))
    expect(within(view).getByText('Domain')).toBeTruthy()   // category keys are shown with their names
    await userEvent.click(within(view).getByRole('tab', { name: 'Month' }))
    expect(within(view).getByText('2026-10')).toBeTruthy(); expect(within(view).getByRole('columnheader', { name: 'Income' })).toBeTruthy()
  })
  it('asks for one department and leaves company income out of its report', async () => {
    state.report = report({ meta: { ...report().meta, scope: 'department', department_id: 'd-fe' }, moved: { paid: 250000, refunded: 40000, net_spend: 210000, income: null, net_position: null }, income_by_source: null, by_month: [{ month: '2026-10', paid: 250000, refunded: 40000, income: null }] })
    office$('?tab=reports')
    await screen.findByRole('option', { name: 'Frontend Development' })   // the department list loads after the page
    await userEvent.selectOptions(screen.getByLabelText('Department'), 'd-fe')
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }))
    const view = await screen.findByLabelText('Finance report')
    expect(calls.at(-1)?.args[3]).toBe('d-fe')
    expect(within(view).queryByText('Income')).toBeNull(); expect(within(view).queryByText('Net position')).toBeNull()
    expect(within(view).getByText(/One department/)).toBeTruthy()
  })
  it('shows why a report could not be made', async () => {
    state.report = null
    office$('?tab=reports')
    await userEvent.click(await screen.findByRole('button', { name: 'Generate report' }))
    expect(await screen.findByText("The report couldn't be made")).toBeTruthy(); expect(screen.getByText('Reports are for Finance.')).toBeTruthy()
  })
  it('downloads a summary that stands alone, and a detail file fetched for exactly this report', async () => {
    state.report = report(); state.lines = [{ ref: 'FR-1', title: '=SUM(A1)', department: 'Frontend', category: 'domain', vendor: 'Namecheap', project: null, requester: 'Maya', status: 'paid', amount: 300000, amount_paid: 250000, refunded: 40000, currency: 'NGN', submitted_on: iso(-9), paid_on: iso(-5), payment_reference: 'TRX-1', has_receipt: false, discrepancy: true }]
    office$('?tab=reports')
    await userEvent.click(await screen.findByRole('button', { name: 'Generate report' }))
    await userEvent.click(await screen.findByRole('button', { name: /Summary CSV/ }))
    expect(downloads[0].name).toBe(`finance-summary-${iso(-30)}_to_${iso()}-NGN.csv`)
    expect(downloads[0].text).toContain('Generated by,Ada Okafor'); expect(downloads[0].text).toContain('Net position,390000')
    await userEvent.click(screen.getByRole('button', { name: /Detail CSV/ }))
    await waitFor(() => expect(downloads).toHaveLength(2))
    expect(calls.at(-1)).toMatchObject({ fn: 'financeReportLines', args: [iso(-30), iso(), 'NGN', null] })
    expect(downloads[1].name).toBe(`finance-detail-${iso(-30)}_to_${iso()}-NGN.csv`)
    expect(downloads[1].text).toContain("'=SUM(A1)")   // a title that looks like a formula is made safe
  })
})

describe('Income tab', () => {
  const entry = (o: Any = {}): Any => ({ id: 'i1', kind: 'income', reversal_of: null, source: 'client_work_fee', amount: 500000, currency: 'NGN', reference: 'INV-1', received_on: iso(-2), description: 'Fee for the Acme website', ...o })
  it('explains what counts as income, and lists entries with reversals as negatives', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    state.income = [entry(), entry({ id: 'i2', kind: 'reversal', reversal_of: 'i1', amount: 50000, reference: 'REV-1', description: 'Refunded to the client' })]
    office$('?tab=income')
    expect(await screen.findByText(/Money that passes through Codex for a client/)).toBeTruthy()
    expect(await screen.findByText('INV-1')).toBeTruthy(); expect(await screen.findByText('Reversal')).toBeTruthy(); expect(await screen.findByText(/−₦50,000\.00/)).toBeTruthy()
  })
  it('lets only the Finance Manager or Main Admin record or reverse income', async () => {
    state.myDepts = [dept('finance', 'Finance')]; state.income = [entry()]
    const { unmount } = office$('?tab=income')
    await screen.findByText('INV-1')
    expect(screen.queryByRole('button', { name: /Record income/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull()
    unmount(); state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=income')
    expect(await screen.findByRole('button', { name: /Record income/ })).toBeTruthy(); expect(await screen.findByRole('button', { name: 'Reverse' })).toBeTruthy()
  })
  it('records income with a reference, in capitals, and refuses an empty form', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    office$('?tab=income')
    await userEvent.click(await screen.findByRole('button', { name: /Record income/ }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Record income' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '120000')
    await userEvent.type(within(dialog).getByLabelText(/Reference/), 'INV-77')
    await userEvent.selectOptions(within(dialog).getByLabelText('What it is'), 'retainer')
    await userEvent.click(save)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'recordIncome', args: [120000, 'NGN', 'retainer', 'INV-77', iso(), ''] }))
  })
  it('caps a reversal at what is left of the entry and needs a reason', async () => {
    state.myDepts = [dept('finance', 'Finance', 'admin')]
    state.income = [entry(), entry({ id: 'i2', kind: 'reversal', reversal_of: 'i1', amount: 50000, reference: 'REV-1' })]
    office$('?tab=income')
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/Amount/) as HTMLInputElement).value).toBe('450000')   // 500,000 less the 50,000 already reversed
    const go = within(dialog).getByRole('button', { name: 'Record reversal' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(/Reference for the reversal/), 'REV-2')
    await userEvent.type(within(dialog).getByLabelText(/Why/), 'Client was charged twice')
    expect(go.disabled).toBe(false)
    await userEvent.clear(within(dialog).getByLabelText(/Amount/)); await userEvent.type(within(dialog).getByLabelText(/Amount/), '450001')
    expect(go.disabled).toBe(true)
    await userEvent.clear(within(dialog).getByLabelText(/Amount/)); await userEvent.type(within(dialog).getByLabelText(/Amount/), '100000')
    await userEvent.click(go)
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ fn: 'reverseIncome', args: ['i1', 100000, 'REV-2', 'Client was charged twice'] }))
  })
})
