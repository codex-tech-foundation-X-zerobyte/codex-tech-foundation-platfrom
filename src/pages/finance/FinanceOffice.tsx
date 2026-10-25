import { useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { BellRing, CalendarClock, Plus, ReceiptText, Wallet } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, PageHeader, Select, SkeletonRows, Table, Tabs, Textarea, useToast } from '../../components/ui'
import {
  archiveBudget, changeBudget, changeRenewal, createBudget, createRenewal, listBudgetStatus, listDepartmentSummaries, listMissingReceipts, listRenewals, listVendors, markRenewalRenewed,
  requestFromRenewal, saveVendor, sendRenewalReminders, setRenewalStatus, type BudgetStatus, type Renewal, type Vendor,
} from '../../lib/services'
import { CATEGORIES, categoryLabel, money } from '../../lib/fundWorkflow'
import {
  BUDGET_STATE_LABEL, FREQUENCY_LABEL, PERIOD_LABEL, addCycle, budgetState, daysUntil, dueText, parseRemindDays, percentUsed, periodLabel, periodStart, renewalUrgency, scopeLabel, type PeriodKind,
} from '../../lib/financeRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useFinanceViewer } from './useFinanceViewer'
import './FundRequests.css'
import './FinanceOffice.css'

const today = () => new Date().toISOString().slice(0, 10)
const TONE = { ok: 'success', near: 'warning', over: 'danger', none: 'neutral' } as const

/** Finance office: budgets, recurring expenses (renewals), vendors, and receipts that are missing. Nothing here moves money. */
export function FinanceOffice() {
  useDocumentTitle('Finance office')
  const { viewer, isFinance, departments, loading } = useFinanceViewer()
  const [params, setParams] = useSearchParams()
  const canSeeBudgets = isFinance || viewer.adminOf.length > 0
  const tabs = [
    ...(canSeeBudgets ? [{ id: 'budgets', label: 'Budgets' }] : []),
    { id: 'renewals', label: 'Renewals' },
    { id: 'vendors', label: 'Vendors' },
    ...(isFinance ? [{ id: 'receipts', label: 'Missing receipts' }] : []),
  ]
  const wanted = params.get('tab')
  const tab = tabs.some((t) => t.id === wanted) ? (wanted as string) : tabs[0].id
  const manage = viewer.isFinanceManager || viewer.isMainAdmin
  return (
    <div className="ctf-fin">
      <PageHeader title="Finance office" description="Budgets, recurring expenses and vendors. Budgets and reminders inform decisions; they never pay anything. Payments still need an approved fund request." />
      <Tabs tabs={tabs} active={tab} onChange={(id) => setParams({ tab: id })} label="Finance office views" />
      {loading ? <SkeletonRows rows={4} /> : (
        <div className="ctf-fin__body">
          {tab === 'budgets' && <BudgetsTab manage={manage} departments={departments} />}
          {tab === 'renewals' && <RenewalsTab viewer={viewer} isFinance={isFinance} manage={manage} departments={departments} />}
          {tab === 'vendors' && <VendorsTab manage={manage} />}
          {tab === 'receipts' && <ReceiptsTab />}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── budgets ───────────────────────────── */
function Meter({ b }: { b: BudgetStatus }) {
  const state = budgetState(b.amount, b.committed)
  const pct = percentUsed(b.amount, b.committed)
  return (
    <div className="ctf-meter">
      <div className={`ctf-meter__bar ctf-meter__bar--${state}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label={`${pct}% of the budget is committed`}>
        <span style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="ctf-meter__row"><span>{pct}% committed</span><Badge tone={TONE[state]}>{BUDGET_STATE_LABEL[state]}</Badge></div>
    </div>
  )
}

function BudgetsTab({ manage, departments }: { manage: boolean; departments: { id: string; name: string }[] }) {
  const [on, setOn] = useState(today())
  const data = useAsyncData(`budgets:${on}`, () => listBudgetStatus(on))
  const [form, setForm] = useState<null | 'new' | BudgetStatus>(null)
  const rows = data.data ?? []
  return (
    <>
      <div className="ctf-fin__bar">
        <FieldWrap label="Budgets in force on" htmlFor="bud-on"><Input id="bud-on" type="date" value={on} onChange={(e) => e.target.value && setOn(e.target.value)} /></FieldWrap>
        {manage && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setForm('new')}>Set a budget</Button>}
      </div>
      <p className="ctf-funds__note">Committed = approved but unpaid + paid + reconciled − refunds. Requests still in review are shown as pending and are not counted until approved. A request counts toward the period of its needed-by date. Rejected, cancelled and reversed requests count for nothing.</p>
      {data.error ? <ErrorState title="Budgets couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table loading={data.loading} rows={rows} rowKey={(r: BudgetStatus) => r.budget_id} onRowClick={manage ? (r: BudgetStatus) => setForm(r) : undefined}
          emptyState={<EmptyState icon={Wallet} title="No budget covers this date" description={manage ? 'Set one to see how much of it has been used.' : 'When Finance sets a budget for your department it appears here.'} />}
          columns={[
            { key: 'scope', header: 'Budget', render: (r: BudgetStatus) => <><strong>{scopeLabel(r.department_name, r.category ? categoryLabel(r.category) : null)}</strong><div className="ctf-funds__sub">{PERIOD_LABEL[r.period_kind]} · {periodLabel(r.period_kind, r.period_start)}{r.note ? ` · ${r.note}` : ''}</div></> },
            { key: 'amount', header: 'Amount', render: (r: BudgetStatus) => <span className="ctf-funds__amount">{money(r.amount, r.currency)}</span> },
            { key: 'used', header: 'Used', render: (r: BudgetStatus) => <Meter b={r} /> },
            { key: 'left', header: 'Remaining', render: (r: BudgetStatus) => <span className={`ctf-funds__amount${r.remaining < 0 ? ' ctf-fin__neg' : ''}`}>{money(r.remaining, r.currency)}</span> },
            { key: 'buckets', header: 'Breakdown', render: (r: BudgetStatus) => <div className="ctf-fin__buckets"><span>Pending {money(r.pending, r.currency)}</span><span>Approved, unpaid {money(r.approved_unpaid, r.currency)}</span><span>Paid {money(r.paid, r.currency)}</span><span>Reconciled {money(r.reconciled, r.currency)}</span><span>Refunded {money(r.refunded, r.currency)}</span></div> },
          ]} />
      )}
      <Modal open={form !== null} onClose={() => setForm(null)} title={form === 'new' ? 'Set a budget' : 'Change budget'} description={form === 'new' ? 'One active budget per department, category and period.' : 'Only the amount and note can change. For a different scope or period, archive this one and set a new budget.'}>
        {form !== null && <BudgetForm existing={form === 'new' ? null : form} departments={departments} defaultOn={on} onClose={() => setForm(null)} onDone={() => { setForm(null); data.reload() }} />}
      </Modal>
    </>
  )
}

function BudgetForm({ existing, departments, defaultOn, onClose, onDone }: { existing: BudgetStatus | null; departments: { id: string; name: string }[]; defaultOn: string; onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ department_id: existing?.department_id ?? '', category: existing?.category ?? '', kind: (existing?.period_kind ?? 'month') as PeriodKind, on: existing?.period_start ?? defaultOn, amount: existing ? String(existing.amount) : '', currency: existing?.currency ?? 'NGN', note: existing?.note ?? '' })
  const [busy, setBusy] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const start = periodStart(f.kind, f.on || today())
  const amount = Number(f.amount)
  const valid = amount > 0 && /^[A-Za-z]{3}$/.test(f.currency)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    const { error } = existing ? await changeBudget(existing.budget_id, { amount, note: f.note.trim() }) : await createBudget({ department_id: f.department_id || null, category: f.category || null, period_kind: f.kind, period_start: start, amount, currency: f.currency.toUpperCase(), note: f.note.trim() })
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(existing ? 'Budget updated.' : 'Budget set.'); onDone()
  }
  const archive = async () => {
    if (!existing) return
    setBusy(true); const { error } = await archiveBudget(existing.budget_id, 'Archived from the Finance office'); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push('Budget archived.'); onDone()
  }
  return (
    <form className="ctf-fform" onSubmit={(e) => void submit(e)}>
      {!existing && <>
        <div className="ctf-fform__row">
          <FieldWrap label="Department" htmlFor="bf-dept"><Select id="bf-dept" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">Company-wide</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FieldWrap>
          <FieldWrap label="Category" htmlFor="bf-cat"><Select id="bf-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
        </div>
        <div className="ctf-fform__row">
          <FieldWrap label="Period" htmlFor="bf-kind"><Select id="bf-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PeriodKind })}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Yearly</option></Select></FieldWrap>
          <FieldWrap label="Period containing" htmlFor="bf-on" hint={`This budget covers ${periodLabel(f.kind, start)}.`}><Input id="bf-on" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></FieldWrap>
        </div>
      </>}
      <div className="ctf-fform__row">
        <FieldWrap label="Amount" htmlFor="bf-amt" required><Input id="bf-amt" type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></FieldWrap>
        <FieldWrap label="Currency" htmlFor="bf-cur" hint="Budgets only count requests in the same currency."><Input id="bf-cur" value={f.currency} maxLength={3} disabled={!!existing} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></FieldWrap>
      </div>
      <FieldWrap label="Note" htmlFor="bf-note"><Textarea id="bf-note" rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FieldWrap>
      <div className="ctf-fform__actions">
        {existing && !confirmArchive && <Button variant="ghost" onClick={() => setConfirmArchive(true)}>Archive</Button>}
        {existing && confirmArchive && <Button variant="danger" onClick={() => void archive()} loading={busy}>Confirm archive</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!valid}>{existing ? 'Save' : 'Set budget'}</Button>
      </div>
    </form>
  )
}

/* ───────────────────────────── renewals ───────────────────────────── */
function RenewalsTab({ viewer, isFinance, manage, departments }: { viewer: { adminOf: string[] }; isFinance: boolean; manage: boolean; departments: { id: string; name: string }[] }) {
  const { push } = useToast()
  const data = useAsyncData('renewals', listRenewals)
  const allDepts = useAsyncData('renewal-dept-names', async () => listDepartmentSummaries())
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const names = useMemo(() => new Map((allDepts.data?.departments ?? []).map((d) => [d.id, d.name])), [allDepts.data])
  const rows = data.data ?? []
  const open = rows.find((r) => r.id === openId) ?? null
  const canAdd = manage || viewer.adminOf.length > 0
  const addable = manage ? departments.length ? departments : (allDepts.data?.departments ?? []).map((d) => ({ id: d.id, name: d.name })) : departments.filter((d) => viewer.adminOf.includes(d.id))
  const remind = async () => {
    setBusy(true); const { sent, error } = await sendRenewalReminders(); setBusy(false)
    if (error) push(error.message, 'error'); else push(sent === 0 ? 'No reminders were due.' : `Sent ${sent} reminder${sent === 1 ? '' : 's'}.`)
  }
  return (
    <>
      <div className="ctf-fin__bar">
        <p className="ctf-funds__note">Domains, hosting, API credits and subscriptions that come round again. Reminders go to the owning department, Finance and the Main Admin; a critical renewal that is not approved yet is escalated. Reminders never include amounts, and nothing is ever paid automatically.</p>
        <div className="ctf-fin__actions">
          {isFinance && <Button variant="secondary" icon={<BellRing size={15} />} onClick={() => void remind()} loading={busy}>Send due reminders</Button>}
          {canAdd && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)} disabled={addable.length === 0}>Add a renewal</Button>}
        </div>
      </div>
      {data.error ? <ErrorState title="Renewals couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table loading={data.loading} rows={rows} rowKey={(r: Renewal) => r.id} onRowClick={(r: Renewal) => setOpenId(r.id)}
          emptyState={<EmptyState icon={CalendarClock} title="No renewals yet" description="Add the domains, hosting and subscriptions that need paying again so nobody is surprised when they lapse." />}
          columns={[
            { key: 'title', header: 'Renewal', render: (r: Renewal) => <><strong>{r.title}</strong>{r.critical && <> <Badge tone="danger">Critical</Badge></>}<div className="ctf-funds__sub">{categoryLabel(r.category)}{r.vendor ? ` · ${r.vendor}` : ''} · {names.get(r.department_id) ?? ''}</div></> },
            { key: 'amount', header: 'Amount', render: (r: Renewal) => <><span className="ctf-funds__amount">{money(r.amount, r.currency)}</span><div className="ctf-funds__sub">{FREQUENCY_LABEL[r.frequency]}</div></> },
            { key: 'due', header: 'Next due', render: (r: Renewal) => { const d = daysUntil(r.next_due, today()); const u = renewalUrgency(d, r.status); return <><div>{r.next_due}</div><Badge tone={u === 'overdue' ? 'danger' : u === 'soon' ? 'warning' : 'neutral'}>{u === 'inactive' ? r.status[0].toUpperCase() + r.status.slice(1) : dueText(d)}</Badge></> } },
            { key: 'remind', header: 'Reminders', render: (r: Renewal) => <span className="ctf-funds__sub">{r.remind_days.join(', ')} days before</span> },
          ]} />
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a renewal" description="A recurring cost. Each cycle still needs its own approved fund request.">
        {adding && <RenewalForm departments={addable} onClose={() => setAdding(false)} onDone={() => { setAdding(false); data.reload() }} />}
      </Modal>
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ''} size="lg">
        {open && <RenewalDetail key={`${open.id}:${open.version}:${open.status}:${open.next_due}`} r={open} departmentName={names.get(open.department_id) ?? ''} canEdit={manage || viewer.adminOf.includes(open.department_id)} manage={manage} onClose={() => setOpenId(null)} onChanged={() => data.reload()} />}
      </Modal>
    </>
  )
}

function RenewalForm({ existing, departments, onClose, onDone }: { existing?: Renewal; departments: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ department_id: existing?.department_id ?? departments[0]?.id ?? '', title: existing?.title ?? '', category: existing?.category ?? 'domain', vendor: existing?.vendor ?? '', amount: existing ? String(existing.amount) : '', currency: existing?.currency ?? 'NGN', frequency: existing?.frequency ?? 'yearly', next_due: existing?.next_due ?? '', critical: existing?.critical ?? false, remind: (existing?.remind_days ?? [30, 14, 7, 1]).join(', '), notes: existing?.notes ?? '' })
  const [busy, setBusy] = useState(false)
  const remind = parseRemindDays(f.remind)
  const amount = Number(f.amount)
  const valid = f.title.trim().length >= 3 && amount > 0 && !!remind && (!!existing || (!!f.next_due && !!f.department_id)) && /^[A-Za-z]{3}$/.test(f.currency)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || !remind) return
    setBusy(true)
    const body = { title: f.title.trim(), category: f.category, vendor: f.vendor.trim(), amount, frequency: f.frequency, critical: f.critical, remind_days: remind, notes: f.notes.trim() }
    const { error } = existing ? await changeRenewal(existing.id, body) : await createRenewal({ ...body, department_id: f.department_id, currency: f.currency.toUpperCase(), next_due: f.next_due })
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(existing ? 'Renewal updated.' : 'Renewal added.'); onDone()
  }
  return (
    <form className="ctf-fform" onSubmit={(e) => void submit(e)}>
      {!existing && <FieldWrap label="Owning department" htmlFor="rf-dept" hint="Its admins and Finance are reminded."><Select id="rf-dept" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FieldWrap>}
      <FieldWrap label="What renews" htmlFor="rf-title" required><Input id="rf-title" value={f.title} maxLength={140} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="codextechfoundation.com domain" autoFocus /></FieldWrap>
      <div className="ctf-fform__row">
        <FieldWrap label="Category" htmlFor="rf-cat"><Select id="rf-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
        <FieldWrap label="Vendor" htmlFor="rf-vendor"><Input id="rf-vendor" value={f.vendor} maxLength={200} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></FieldWrap>
      </div>
      <div className="ctf-fform__row">
        <FieldWrap label="Amount per cycle" htmlFor="rf-amt" required><Input id="rf-amt" type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FieldWrap>
        <FieldWrap label="Currency" htmlFor="rf-cur"><Input id="rf-cur" value={f.currency} maxLength={3} disabled={!!existing} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></FieldWrap>
      </div>
      <div className="ctf-fform__row">
        <FieldWrap label="Repeats" htmlFor="rf-freq"><Select id="rf-freq" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Renewal['frequency'] })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select></FieldWrap>
        {!existing && <FieldWrap label="Next due" htmlFor="rf-due" required><Input id="rf-due" type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></FieldWrap>}
      </div>
      <FieldWrap label="Remind me (days before)" htmlFor="rf-remind" hint={remind ? `Reminders ${remind.join(', ')} days before it is due.` : 'Numbers from 0 to 365, up to eight, separated by commas.'} error={remind ? undefined : 'Enter days like 30, 14, 7, 1.'}><Input id="rf-remind" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })} /></FieldWrap>
      <label className="ctf-form-check"><input type="checkbox" checked={f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} /> Critical: the service stops if this lapses (escalate to the Main Admin and Finance if it is not approved in time)</label>
      <FieldWrap label="Notes" htmlFor="rf-notes"><Textarea id="rf-notes" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FieldWrap>
      <div className="ctf-fform__actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>{existing ? 'Save' : 'Add renewal'}</Button></div>
    </form>
  )
}

function RenewalDetail({ r, departmentName, canEdit, manage, onClose, onChanged }: { r: Renewal; departmentName: string; canEdit: boolean; manage: boolean; onClose: () => void; onChanged: () => void }) {
  const { push } = useToast()
  const base = useLocation().pathname.startsWith('/admin') ? '/admin' : '/worker'
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | 'renew' | 'cancel'>('view')
  const [next, setNext] = useState(addCycle(r.next_due, r.frequency))
  const d = daysUntil(r.next_due, today())
  const run = async (fn: () => Promise<{ error: Error | null }>, done: string) => {
    setBusy(true); const { error } = await fn(); setBusy(false)
    if (error) { push(error.message, 'error'); return false }
    push(done); onChanged(); return true
  }
  const makeRequest = async () => {
    setBusy(true); const { id, error } = await requestFromRenewal(r.id); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push('Draft request created. Review it and submit when ready.'); onChanged(); onClose()
    if (id) window.location.assign(`${base}/funds?tab=mine&open=${id}`)
  }
  if (mode === 'edit') return <RenewalForm existing={r} departments={[]} onClose={() => setMode('view')} onDone={() => { onChanged(); onClose() }} />
  return (
    <div className="ctf-fdetail">
      <div className="ctf-fdetail__head">
        <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
        {r.critical && <Badge tone="danger">Critical</Badge>}
        <span className="ctf-funds__amount ctf-fdetail__amount">{money(r.amount, r.currency)}</span><span className="ctf-funds__sub">{FREQUENCY_LABEL[r.frequency]}</span>
      </div>
      <dl className="ctf-fdetail__grid">
        <div><dt>Department</dt><dd>{departmentName || '—'}</dd></div><div><dt>Category</dt><dd>{categoryLabel(r.category)}</dd></div>
        <div><dt>Vendor</dt><dd>{r.vendor || '—'}</dd></div><div><dt>Next due</dt><dd>{r.next_due} · {dueText(d)}</dd></div>
        <div><dt>Reminders</dt><dd>{r.remind_days.join(', ')} days before</dd></div><div><dt>Fund request</dt><dd>{r.last_request_id ? 'Created for this due date' : 'None yet'}</dd></div>
      </dl>
      {r.notes && <p className="ctf-fdetail__text">{r.notes}</p>}
      {mode === 'view' && (
        <div className="ctf-fdetail__actions">
          {r.status === 'active' && <Button variant="primary" onClick={() => void makeRequest()} loading={busy}>{r.last_request_id ? 'Open or recreate the request' : 'Create a fund request'}</Button>}
          {canEdit && <Button variant="secondary" onClick={() => setMode('edit')}>Edit</Button>}
          {manage && r.status === 'active' && <Button variant="secondary" onClick={() => setMode('renew')}>Mark as renewed</Button>}
          {canEdit && r.status === 'active' && <Button variant="ghost" onClick={() => void run(() => setRenewalStatus(r.id, 'paused'), 'Renewal paused.').then((ok) => ok && onClose())}>Pause</Button>}
          {canEdit && r.status === 'paused' && <Button variant="secondary" onClick={() => void run(() => setRenewalStatus(r.id, 'active'), 'Renewal resumed.').then((ok) => ok && onClose())}>Resume</Button>}
          {canEdit && r.status !== 'cancelled' && <Button variant="ghost" onClick={() => setMode('cancel')}>Cancel renewal</Button>}
          {r.status === 'active' && <p className="ctf-funds__note">Creating a request makes an ordinary draft. It still needs Finance, department and Main Admin approval, and nothing is paid until a payment is recorded.</p>}
        </div>
      )}
      {mode === 'renew' && (
        <form className="ctf-fdetail__confirm" onSubmit={(e) => { e.preventDefault(); void run(() => markRenewalRenewed(r.id, next), 'Moved to the next cycle.').then((ok) => ok && onClose()) }}>
          <p className="ctf-funds__note">Use this after the renewal has been paid. It moves the due date forward and starts reminders for the next cycle. Nothing advances on its own.</p>
          <FieldWrap label="Next due date" htmlFor="rn-next"><Input id="rn-next" type="date" min={r.next_due} value={next} onChange={(e) => setNext(e.target.value)} /></FieldWrap>
          <div className="ctf-fform__actions"><Button variant="ghost" onClick={() => setMode('view')}>Back</Button><Button type="submit" variant="primary" loading={busy} disabled={!next || next <= r.next_due}>Confirm</Button></div>
        </form>
      )}
      {mode === 'cancel' && (
        <div className="ctf-fdetail__confirm">
          <p className="ctf-funds__note">A cancelled renewal stays cancelled and stops all reminders. To bring it back, add it again.</p>
          <div className="ctf-fform__actions"><Button variant="ghost" onClick={() => setMode('view')}>Back</Button><Button variant="danger" loading={busy} onClick={() => void run(() => setRenewalStatus(r.id, 'cancelled'), 'Renewal cancelled.').then((ok) => ok && onClose())}>Cancel this renewal</Button></div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── vendors ───────────────────────────── */
function VendorsTab({ manage }: { manage: boolean }) {
  const data = useAsyncData('vendors', listVendors)
  const [editing, setEditing] = useState<null | 'new' | Vendor>(null)
  const rows = data.data ?? []
  return (
    <>
      <div className="ctf-fin__bar">
        <p className="ctf-funds__note">Companies the company pays. Keep contact details and account numbers out of here: this list is visible to every active team member.</p>
        {manage && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Add a vendor</Button>}
      </div>
      {data.error ? <ErrorState title="Vendors couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table loading={data.loading} rows={rows} rowKey={(v: Vendor) => v.id} onRowClick={manage ? (v: Vendor) => setEditing(v) : undefined}
          emptyState={<EmptyState icon={Wallet} title="No vendors yet" description="Finance adds the companies the company buys from." />}
          columns={[
            { key: 'name', header: 'Vendor', render: (v: Vendor) => <strong>{v.name}</strong> },
            { key: 'cat', header: 'Usually', render: (v: Vendor) => (v.category ? categoryLabel(v.category) : '—') },
            { key: 'web', header: 'Website', render: (v: Vendor) => (v.website ? <a href={v.website} target="_blank" rel="noopener noreferrer">{v.website.replace(/^https:\/\//, '')}</a> : '—') },
            { key: 'status', header: 'Status', render: (v: Vendor) => <Badge tone={v.status === 'active' ? 'success' : 'neutral'}>{v.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
          ]} />
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a vendor' : 'Edit vendor'}>
        {editing !== null && <VendorForm existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); data.reload() }} />}
      </Modal>
    </>
  )
}
function VendorForm({ existing, onClose, onDone }: { existing: Vendor | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ name: existing?.name ?? '', category: existing?.category ?? '', website: existing?.website ?? '', status: existing?.status ?? 'active' })
  const [busy, setBusy] = useState(false)
  const web = f.website.trim()
  const webOk = web === '' || /^https:\/\/\S+$/.test(web)
  const valid = f.name.trim().length >= 2 && webOk
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!valid) return
    setBusy(true); const { error } = await saveVendor({ id: existing?.id, name: f.name.trim(), category: f.category || null, website: web || null, status: f.status as 'active' | 'inactive' }); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(existing ? 'Vendor updated.' : 'Vendor added.'); onDone()
  }
  return (
    <form className="ctf-fform" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Name" htmlFor="vf-name" required><Input id="vf-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></FieldWrap>
      <div className="ctf-fform__row">
        <FieldWrap label="Usually supplies" htmlFor="vf-cat"><Select id="vf-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Not set</option>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
        <FieldWrap label="Status" htmlFor="vf-status"><Select id="vf-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></Select></FieldWrap>
      </div>
      <FieldWrap label="Website" htmlFor="vf-web" error={webOk ? undefined : 'Use a full https:// address.'}><Input id="vf-web" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></FieldWrap>
      <div className="ctf-fform__actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>{existing ? 'Save' : 'Add vendor'}</Button></div>
    </form>
  )
}

/* ───────────────────────────── missing receipts ───────────────────────────── */
function ReceiptsTab() {
  const data = useAsyncData('missing-receipts', listMissingReceipts)
  const base = useLocation().pathname.startsWith('/admin') ? '/admin' : '/worker'
  const rows = data.data ?? []
  return (
    <>
      <p className="ctf-funds__note">Payments that were recorded more than three days ago but have no receipt or invoice attached. Open the request and attach the document; the flag clears by itself.</p>
      {data.error ? <ErrorState title="The list couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table loading={data.loading} rows={rows} rowKey={(r) => r.request_id}
          emptyState={<EmptyState icon={ReceiptText} title="Every payment has its document" description="Nothing older than three days is missing a receipt." />}
          columns={[
            { key: 'req', header: 'Request', render: (r) => <><Link to={`${base}/funds?tab=all&open=${r.request_id}`}><strong>{r.title}</strong></Link><div className="ctf-funds__sub">{r.ref} · {r.department_name}</div></> },
            { key: 'amt', header: 'Paid', render: (r) => <span className="ctf-funds__amount">{money(r.amount_paid, r.currency)}</span> },
            { key: 'on', header: 'Paid on', render: (r) => r.paid_on },
            { key: 'days', header: 'Waiting', render: (r) => <Badge tone={r.days_open > 14 ? 'danger' : 'warning'}>{r.days_open} days</Badge> },
          ]} />
      )}
    </>
  )
}
