import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Check, FilePlus2, FileText, Landmark, Paperclip, Plus, TriangleAlert, Undo2, X } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, PageHeader, Select, SkeletonRows, Table, Tabs, Textarea, useToast } from '../../components/ui'
import {
  beginFundPayment, budgetPanelForRequest, cancelFundRequest, createFundRequest, failFundPayment, fundDocUrl, getMyDepartments, listCompanySpending, listDepartmentSummaries, listFundDecisions,
  listFundDocs, listFundRequests, listRefunds, reconcileFundRequest, recordFundPayment, recordRefund, reverseFundPayment, reviewFundRequest, submitFundRequest, updateFundRequest, uploadFundDoc,
  type FundRequestRow, type SpendingRow,
} from '../../lib/services'
import { BUDGET_STATE_LABEL, budgetState, canRecordRefund, periodLabel, receiptMissing, refundableLeft, scopeLabel } from '../../lib/financeRules'
import { CATEGORIES, STAGE_HELP, STATUS_LABEL, STATUS_TONE, actionsFor, categoryLabel, isOpen, money, type FundStatus, type Viewer } from '../../lib/fundWorkflow'
import { timeAgo } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './FundRequests.css'
import './FinanceOffice.css'

const today = () => new Date().toISOString().slice(0, 10)

/** The Fund Request Centre: ask for money, review what is waiting for you, record payments and reconcile, and see what the company has spent. */
export function FundRequests() {
  useDocumentTitle('Fund requests')
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'mine'
  const list = useAsyncData('fund-requests', listFundRequests)
  const mine = useAsyncData(`fund-depts:${profile?.id}`, async () => (profile && profile.role !== 'superadmin' ? getMyDepartments(profile.id) : { data: [], error: null }))
  const allDepts = useAsyncData('fund-all-depts', async () => (profile?.role === 'superadmin' ? listDepartmentSummaries() : { data: { departments: [], unassigned: 0 }, error: null }))
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(params.get('open'))

  const viewer: Viewer = useMemo(() => {
    const m = mine.data ?? []
    return {
      id: profile?.id, isMainAdmin: profile?.role === 'superadmin',
      isFinanceManager: m.some((x) => x.department.slug === 'finance' && x.role === 'admin'),
      adminOf: m.filter((x) => x.role === 'admin').map((x) => x.department.id),
    }
  }, [profile, mine.data])
  const isFinance = (mine.data ?? []).some((x) => x.department.slug === 'finance') || viewer.isMainAdmin
  const departments = viewer.isMainAdmin ? (allDepts.data?.departments ?? []).map((d) => ({ id: d.id, name: d.name })) : (mine.data ?? []).map((x) => ({ id: x.department.id, name: x.department.name }))

  const rows = list.data ?? []
  const myRows = rows.filter((r) => r.requester_id === profile?.id)
  const queue = rows.filter((r) => { const a = actionsFor(r, viewer); return a.review || a.beginPayment || a.recordPayment || a.reconcile })
  const open = rows.find((r) => r.id === openId) ?? null

  const tabs = [
    { id: 'mine', label: 'My requests', count: myRows.filter((r) => isOpen(r.status)).length },
    ...(queue.length > 0 || viewer.isFinanceManager || viewer.adminOf.length > 0 || viewer.isMainAdmin ? [{ id: 'queue', label: 'Needs my action', count: queue.length }] : []),
    ...(isFinance ? [{ id: 'all', label: 'All requests' }] : []),
    { id: 'spending', label: 'Company spending' },
  ]

  return (
    <div className="ctf-funds">
      <PageHeader title="Fund requests" description="Ask for money the company needs to spend. Finance and your department review it first; the Main Admin decides. Approval is not payment: payments are recorded and reconciled separately."
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)} disabled={departments.length === 0}>New request</Button>} />
      <Tabs tabs={tabs} active={tabs.some((t) => t.id === tab) ? tab : 'mine'} onChange={(id) => setParams({ tab: id })} label="Fund request views" />
      {list.error ? <ErrorState title="Requests couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} /> : (
        <div className="ctf-funds__body">
          {tab === 'spending' ? <Spending /> :
            <RequestTable loading={list.loading} rows={tab === 'queue' ? queue : tab === 'all' ? rows : myRows} onOpen={setOpenId}
              showPerson={tab !== 'mine'} empty={tab === 'queue' ? 'Nothing is waiting for you.' : tab === 'mine' ? 'You have not made a request yet.' : 'No requests yet.'} />}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New fund request" description="Say what you need, why, and how much. You can save a draft and submit later.">
        {creating && <RequestForm departments={departments} onCancel={() => setCreating(false)} onDone={(id) => { setCreating(false); list.reload(); if (id) setOpenId(id) }} />}
      </Modal>
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.ref} · ${open.title}` : ''} size="lg">
        {open && <RequestDetail key={`${open.id}:${open.version}:${open.status}`} request={open} viewer={viewer} departments={departments} showBudget={isFinance || viewer.adminOf.includes(open.department_id)} onChanged={() => list.reload()} onClose={() => setOpenId(null)} />}
      </Modal>
    </div>
  )
}

function RequestTable({ rows, loading, onOpen, showPerson, empty }: { rows: FundRequestRow[]; loading: boolean; onOpen: (id: string) => void; showPerson: boolean; empty: string }) {
  return (
    <Table loading={loading} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)}
      emptyState={<EmptyState icon={Landmark} title={empty} description="Requests you can see appear here." />}
      columns={[
        { key: 'ref', header: 'Request', render: (r) => <><strong>{r.title}</strong><div className="ctf-funds__sub">{r.ref} · {categoryLabel(r.category)}{showPerson ? ` · ${r.requester_name}` : ''}</div></> },
        { key: 'dept', header: 'Department', render: (r) => r.department_name },
        { key: 'amount', header: 'Amount', render: (r) => <span className="ctf-funds__amount">{money(r.amount, r.currency)}</span> },
        { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
        { key: 'when', header: 'Updated', render: (r) => timeAgo(r.updated_at) },
      ]} />
  )
}

function Spending() {
  const data = useAsyncData('company-spending', listCompanySpending)
  const rows = data.data ?? []
  const byCurrency = useMemo(() => {
    const m = new Map<string, { approved: number; paid: number }>()
    for (const r of rows) {
      const cur = m.get(r.currency) ?? { approved: 0, paid: 0 }
      cur.approved += r.amount
      if (r.amount_paid !== null && ['paid', 'reconciled', 'reconciliation_required'].includes(r.status)) cur.paid += r.amount_paid
      m.set(r.currency, cur)
    }
    return [...m]
  }, [rows])
  if (data.loading) return <SkeletonRows rows={4} />
  if (data.error) return <ErrorState title="Spending couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} />
  return (
    <>
      <p className="ctf-funds__note">What the company has approved and paid, open to every active team member. It shows no justification, vendor or requester. Amounts are exactly as recorded: approved is what was agreed, paid is what was actually sent.</p>
      {byCurrency.length > 0 && <div className="ctf-funds__totals">{byCurrency.map(([cur, t]) => <div key={cur} className="ctf-kpi"><span>Approved ({cur})</span><strong>{money(t.approved, cur)}</strong><small>Paid so far {money(t.paid, cur)}</small></div>)}</div>}
      <Table rows={rows} rowKey={(r: SpendingRow) => r.ref} emptyState={<EmptyState icon={Landmark} title="Nothing approved yet" description="Approved and paid requests will appear here." />}
        columns={[
          { key: 'ref', header: 'Request', render: (r: SpendingRow) => <><strong>{r.title}</strong><div className="ctf-funds__sub">{r.ref} · {categoryLabel(r.category)}</div></> },
          { key: 'dept', header: 'Department', render: (r: SpendingRow) => r.department_name },
          { key: 'approved', header: 'Approved', render: (r: SpendingRow) => money(r.amount, r.currency) },
          { key: 'paid', header: 'Paid', render: (r: SpendingRow) => (r.amount_paid === null ? '—' : money(r.amount_paid, r.currency)) },
          { key: 'status', header: 'Status', render: (r: SpendingRow) => <Badge tone={STATUS_TONE[r.status as FundStatus] ?? 'neutral'}>{STATUS_LABEL[r.status as FundStatus] ?? r.status}</Badge> },
        ]} />
    </>
  )
}

interface FormProps { departments: { id: string; name: string }[]; existing?: FundRequestRow; onCancel: () => void; onDone: (id: string | null) => void }
function RequestForm({ departments, existing, onCancel, onDone }: FormProps) {
  const { push } = useToast()
  const key = useRef(crypto.randomUUID())   // one key per form: a double-click or a retry cannot create two requests
  const [f, setF] = useState({
    department_id: existing?.department_id ?? departments[0]?.id ?? '', category: existing?.category ?? 'other', title: existing?.title ?? '', description: existing?.description ?? '',
    justification: existing?.justification ?? '', amount: existing ? String(existing.amount) : '', currency: existing?.currency ?? 'NGN', vendor: existing?.vendor ?? '',
    required_by: existing?.required_by ?? '', recurrence: existing?.recurrence ?? 'none',
  })
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const amount = Number(f.amount)
  const valid = f.title.trim().length >= 3 && amount > 0 && /^[A-Za-z]{3}$/.test(f.currency) && !!f.department_id

  const save = async (submit: boolean) => {
    if (!valid) return
    setBusy(submit ? 'submit' : 'draft')
    const input = { department_id: f.department_id, category: f.category, title: f.title.trim(), description: f.description.trim(), justification: f.justification.trim(), amount, currency: f.currency.toUpperCase(), vendor: f.vendor.trim(), required_by: f.required_by || null, recurrence: f.recurrence }
    let id: string | null = existing?.id ?? null
    let error: Error | null = null
    if (existing) {
      error = (await updateFundRequest(existing.id, input)).error
      if (!error && submit) error = (await submitFundRequest(existing.id)).error
    } else {
      const r = await createFundRequest(input, submit, key.current)
      id = r.id; error = r.error
    }
    setBusy(null)
    if (error) { push(error.message, 'error'); return }
    push(submit ? 'Submitted for review.' : 'Draft saved.')
    onDone(id)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void save(true) }
  return (
    <form className="ctf-fform" onSubmit={submit}>
      <FieldWrap label="What do you need?" htmlFor="fr-title" required><Input id="fr-title" value={f.title} onChange={set('title')} maxLength={140} placeholder="Renew the company domain" autoFocus /></FieldWrap>
      <div className="ctf-fform__row">
        <FieldWrap label="Department" htmlFor="fr-dept" hint="Its admin reviews that this is a real need."><Select id="fr-dept" value={f.department_id} onChange={set('department_id')}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FieldWrap>
        <FieldWrap label="Category" htmlFor="fr-cat"><Select id="fr-cat" value={f.category} onChange={set('category')}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
      </div>
      <div className="ctf-fform__row">
        <FieldWrap label="Amount" htmlFor="fr-amount" required><Input id="fr-amount" type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={set('amount')} placeholder="100000" /></FieldWrap>
        <FieldWrap label="Currency" htmlFor="fr-cur"><Input id="fr-cur" value={f.currency} onChange={set('currency')} maxLength={3} /></FieldWrap>
      </div>
      <FieldWrap label="Why is it needed?" htmlFor="fr-why" hint="Reviewers read this. What breaks or slows down if it is not paid?"><Textarea id="fr-why" rows={3} value={f.justification} onChange={set('justification')} maxLength={4000} /></FieldWrap>
      <FieldWrap label="Details" htmlFor="fr-desc"><Textarea id="fr-desc" rows={2} value={f.description} onChange={set('description')} maxLength={4000} /></FieldWrap>
      <div className="ctf-fform__row">
        <FieldWrap label="Vendor / supplier" htmlFor="fr-vendor"><Input id="fr-vendor" value={f.vendor} onChange={set('vendor')} maxLength={200} /></FieldWrap>
        <FieldWrap label="Needed by" htmlFor="fr-by"><Input id="fr-by" type="date" min={today()} value={f.required_by} onChange={set('required_by')} /></FieldWrap>
      </div>
      <FieldWrap label="Repeats" htmlFor="fr-rec" hint="A recurring cost is still approved one request at a time."><Select id="fr-rec" value={f.recurrence} onChange={set('recurrence')}><option value="none">One-off</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select></FieldWrap>
      <p className="ctf-funds__note">After you submit, you can attach the quote or invoice. Once it is under review you can no longer change it; a reviewer can return it to you.</p>
      <div className="ctf-fform__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="secondary" onClick={() => void save(false)} loading={busy === 'draft'} disabled={!valid || !!busy}>Save draft</Button>
        <Button type="submit" variant="primary" loading={busy === 'submit'} disabled={!valid || !!busy || f.justification.trim().length < 10}>Submit for review</Button>
      </div>
    </form>
  )
}

type Pending = null | { kind: 'refund' } | { kind: 'review'; decision: 'approved' | 'rejected' | 'returned' } | { kind: 'cancel' } | { kind: 'pay' } | { kind: 'fail' } | { kind: 'reconcile' } | { kind: 'reverse' }

function RequestDetail({ request: r, viewer, departments, showBudget, onChanged, onClose }: { request: FundRequestRow; viewer: Viewer; departments: { id: string; name: string }[]; showBudget: boolean; onChanged: () => void; onClose: () => void }) {
  const { push } = useToast()
  const a = actionsFor(r, viewer)
  const history = useAsyncData(`fund-history:${r.id}:${r.status}`, () => listFundDecisions(r.id))
  const docs = useAsyncData(`fund-docs:${r.id}`, () => listFundDocs(r.id))
  const paidType = ['paid', 'reconciled', 'reconciliation_required'].includes(r.status)
  const inReview = ['finance_review', 'department_review', 'awaiting_super_admin'].includes(r.status)
  const budget = useAsyncData(`fund-budget:${r.id}:${r.version}:${r.status}:${showBudget}`, () => (showBudget && inReview ? budgetPanelForRequest(r.id) : Promise.resolve({ data: [], error: null })))
  const refunds = useAsyncData(`fund-refunds:${r.id}:${r.status}`, () => (paidType ? listRefunds(r.id) : Promise.resolve({ data: [], error: null })))
  const [rf, setRf] = useState({ kind: 'refund' as 'refund' | 'chargeback', amount: '', reference: '', receivedOn: today(), note: '' })
  const [pending, setPending] = useState<Pending>(null)
  const [reason, setReason] = useState('')
  const [pay, setPay] = useState({ reference: '', amount: String(r.amount), paidOn: today(), note: '' })
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = useCallback(async (fn: () => Promise<{ error: Error | null }>, done: string) => {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(done); setPending(null); setReason(''); onChanged(); onClose()
  }, [push, onChanged, onClose])

  useEffect(() => { setReason('') }, [pending])
  const attach = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    const { error } = await uploadFundDoc(r.id, f)
    setBusy(false)
    if (error) push(error.message, 'error'); else { push('Attached.'); docs.reload() }
  }
  const openDoc = async (path: string) => { const { url } = await fundDocUrl(path); if (url) window.open(url, '_blank', 'noopener'); else push('Could not open that file.', 'error') }

  if (editing) return <RequestForm departments={departments} existing={r} onCancel={() => setEditing(false)} onDone={() => { onChanged(); onClose() }} />

  const stage = a.review
  const reasonNeeded = pending?.kind === 'review' ? pending.decision !== 'approved' : pending?.kind === 'cancel' ? false : ['fail', 'reverse', 'reconcile'].includes(pending?.kind ?? '')
  const confirm = () => {
    if (!pending) return
    switch (pending.kind) {
      case 'review': return void run(() => reviewFundRequest(r.id, r.version, stage!, pending.decision, reason), pending.decision === 'approved' ? 'Approved.' : pending.decision === 'rejected' ? 'Rejected.' : 'Returned to the requester.')
      case 'cancel': return void run(() => cancelFundRequest(r.id, reason), 'Request cancelled.')
      case 'fail': return void run(() => failFundPayment(r.id, reason), 'Payment marked as failed.')
      case 'reconcile': return void run(() => reconcileFundRequest(r.id, reason), 'Reconciliation recorded.')
      case 'reverse': return void run(() => reverseFundPayment(r.id, reason), 'Payment marked as reversed.')
      case 'refund': return void run(() => recordRefund(r.id, rf.kind, Number(rf.amount), rf.reference, rf.receivedOn, rf.note), rf.kind === 'refund' ? 'Refund recorded.' : 'Chargeback recorded.')
      case 'pay': return void run(() => recordFundPayment(r.id, pay.reference, Number(pay.amount), pay.paidOn, pay.note), 'Payment recorded.')
    }
  }

  return (
    <div className="ctf-fdetail">
      <div className="ctf-fdetail__head">
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        <span className="ctf-funds__amount ctf-fdetail__amount">{money(r.amount, r.currency)}</span>
        {r.version > 1 && <Badge tone="neutral">Version {r.version}</Badge>}
      </div>
      <dl className="ctf-fdetail__grid">
        <div><dt>Requested by</dt><dd>{r.requester_name}</dd></div><div><dt>Department</dt><dd>{r.department_name}</dd></div>
        <div><dt>Category</dt><dd>{categoryLabel(r.category)}</dd></div><div><dt>Vendor</dt><dd>{r.vendor || '—'}</dd></div>
        <div><dt>Needed by</dt><dd>{r.required_by ?? '—'}</dd></div><div><dt>Repeats</dt><dd>{r.recurrence === 'none' ? 'One-off' : r.recurrence}</dd></div>
      </dl>
      {r.justification && <><h4>Why it is needed</h4><p className="ctf-fdetail__text">{r.justification}</p></>}
      {r.description && <><h4>Details</h4><p className="ctf-fdetail__text">{r.description}</p></>}
      {(r.payment_reference || r.amount_paid !== null) && (
        <div className="ctf-fdetail__pay">
          <strong>Payment</strong>
          <span>Reference {r.payment_reference} · {r.amount_paid !== null ? money(r.amount_paid, r.currency) : ''} on {r.paid_on}</span>
          {r.amount_paid !== null && r.amount_paid !== r.amount && <Badge tone="warning">Differs from the approved {money(r.amount, r.currency)}</Badge>}
          {r.payment_note && <small>{r.payment_note}</small>}
        </div>
      )}
      {showBudget && inReview && !budget.loading && (
        <div className="ctf-fin__panel" aria-label="Budget check">
          <h4>Budget check</h4>
          {(budget.data ?? []).length === 0 ? <small>No budget covers this department, category and date, so there is nothing to compare against.</small> : (
            <ul>
              {(budget.data ?? []).map((b) => {
                const state = b.over_budget ? 'over' : budgetState(b.amount, b.amount - b.remaining_after)
                return (
                  <li key={b.budget_id}>
                    <span><strong>{scopeLabel(b.scope === 'company' || b.scope === 'category' ? null : r.department_name, b.scope === 'department' || b.scope === 'company' ? null : categoryLabel(r.category))}</strong> · {periodLabel(b.period_kind, b.period_start)} <Badge tone={state === 'over' ? 'danger' : state === 'near' ? 'warning' : 'success'}>{b.over_budget ? 'Would exceed it' : BUDGET_STATE_LABEL[state]}</Badge></span>
                    <span>Budget {money(b.amount, b.currency)} · committed already {money(b.amount - b.remaining_after - b.this_request, b.currency)} · this request {money(b.this_request, b.currency)} · <strong className={b.remaining_after < 0 ? 'ctf-fin__neg' : undefined}>left if approved {money(b.remaining_after, b.currency)}</strong></span>
                    <small>Pending elsewhere {money(b.pending, b.currency)} · approved, unpaid {money(b.approved_unpaid, b.currency)} · paid {money(b.paid, b.currency)} · reconciled {money(b.reconciled, b.currency)} · refunded {money(b.refunded, b.currency)}</small>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      <h4>Documents</h4>
      <ul className="ctf-fdetail__docs">
        {(docs.data ?? []).map((d) => <li key={d.path}><button type="button" onClick={() => void openDoc(d.path)}><FileText size={14} /> {d.name.replace(/^\d+-/, '')}</button></li>)}
        {docs.data?.length === 0 && <li className="ctf-funds__sub">No quote or invoice attached.</li>}
      </ul>
      {paidType && docs.data !== null && receiptMissing(r.status, r.paid_on, docs.data.length, today()) && (
        <p className="ctf-funds__note" role="alert"><TriangleAlert size={14} aria-hidden="true" /> <strong>No receipt or invoice is attached</strong> to a payment made on {r.paid_on}.{a.attach ? ' Attach it below.' : ' Finance has been flagged.'}</p>
      )}
      {a.attach && <><input ref={fileRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = '' }} />
        <Button size="sm" variant="secondary" icon={<Paperclip size={14} />} onClick={() => fileRef.current?.click()} disabled={busy}>Attach a quote or invoice</Button></>}
      {paidType && (
        <>
          <h4>Refunds and chargebacks</h4>
          <ul className="ctf-fdetail__history">
            {(refunds.data ?? []).map((x) => <li key={x.id}><strong>{x.kind === 'refund' ? 'Refund' : 'Chargeback'} {money(x.amount, x.currency)}</strong><span> · reference {x.reference} · received {x.received_on}</span>{x.note && <p>{x.note}</p>}</li>)}
            {refunds.data?.length === 0 && <li className="ctf-funds__sub">None recorded.</li>}
          </ul>
          {refunds.data && refunds.data.length > 0 && <p className="ctf-funds__note">Refunded so far {money(refunds.data.reduce((s, x) => s + x.amount, 0), r.currency)}. Net cost {money((r.amount_paid ?? r.amount) - refunds.data.reduce((s, x) => s + x.amount, 0), r.currency)}.</p>}
        </>
      )}
      <h4>History</h4>
      <ol className="ctf-fdetail__history">
        {(history.data ?? []).map((d) => (
          <li key={d.id}><strong>{d.stage === 'requester' ? d.decision === 'submitted' ? 'Submitted' : 'Cancelled' : `${d.stage.replace('_', ' ')}: ${d.decision.replace('_', ' ')}`}</strong>
            <span> · {d.actor_name}{d.acted_as === 'superadmin_fallback' ? ' (covering: no other reviewer available)' : ''} · v{d.version} · {new Date(d.created_at).toLocaleString()}</span>
            {d.reason && <p>{d.reason}</p>}</li>
        ))}
        {history.data?.length === 0 && <li className="ctf-funds__sub">Not submitted yet.</li>}
      </ol>

      {pending === null ? (
        <div className="ctf-fdetail__actions">
          {stage && <p className="ctf-funds__note">{STAGE_HELP[stage]}</p>}
          {stage && <>
            <Button variant="primary" icon={<Check size={15} />} onClick={() => setPending({ kind: 'review', decision: 'approved' })}>Approve</Button>
            <Button variant="secondary" icon={<Undo2 size={15} />} onClick={() => setPending({ kind: 'review', decision: 'returned' })}>Return for changes</Button>
            <Button variant="danger" icon={<X size={15} />} onClick={() => setPending({ kind: 'review', decision: 'rejected' })}>Reject</Button>
          </>}
          {a.edit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {a.submit && <Button variant="primary" onClick={() => void run(() => submitFundRequest(r.id), 'Submitted for review.')} loading={busy}>Submit for review</Button>}
          {a.beginPayment && <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => void run(() => beginFundPayment(r.id, r.version), 'Payment started. Record it once it is made.')} loading={busy}>Start payment</Button>}
          {a.recordPayment && <Button variant="primary" onClick={() => setPending({ kind: 'pay' })}>Record payment</Button>}
          {a.failPayment && <Button variant="danger" onClick={() => setPending({ kind: 'fail' })}>Payment failed</Button>}
          {a.reconcile && <Button variant="secondary" onClick={() => setPending({ kind: 'reconcile' })}>{r.status === 'reconciliation_required' ? 'Resolve difference' : 'Reconcile'}</Button>}
          {canRecordRefund(r.status, viewer) && <Button variant="secondary" onClick={() => setPending({ kind: 'refund' })}>Record a refund</Button>}
          {a.reverse && <Button variant="ghost" onClick={() => setPending({ kind: 'reverse' })}>Reverse payment</Button>}
          {a.cancel && <Button variant="ghost" onClick={() => setPending({ kind: 'cancel' })}>Cancel request</Button>}
        </div>
      ) : (
        <form className="ctf-fdetail__confirm" onSubmit={(e) => { e.preventDefault(); confirm() }}>
          {pending.kind === 'refund' ? (
            <>
              <p className="ctf-funds__note">Record money that came back from the vendor or the card issuer. It reduces what this request cost and cannot be edited afterwards. You can record up to {money(refundableLeft(r.amount_paid ?? r.amount, (refunds.data ?? []).reduce((s, x) => s + x.amount, 0)), r.currency)} more.</p>
              <div className="ctf-fform__row">
                <FieldWrap label="Type" htmlFor="rf-kind"><Select id="rf-kind" value={rf.kind} onChange={(e) => setRf({ ...rf, kind: e.target.value as 'refund' | 'chargeback' })}><option value="refund">Refund from the vendor</option><option value="chargeback">Chargeback</option></Select></FieldWrap>
                <FieldWrap label={`Amount (${r.currency})`} htmlFor="rf-amt" required><Input id="rf-amt" type="number" step="0.01" min="0" value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} autoFocus /></FieldWrap>
              </div>
              <div className="ctf-fform__row">
                <FieldWrap label="Reference" htmlFor="rf-ref" required hint="The bank or vendor reference. It cannot be reused."><Input id="rf-ref" value={rf.reference} onChange={(e) => setRf({ ...rf, reference: e.target.value })} /></FieldWrap>
                <FieldWrap label="Received on" htmlFor="rf-on"><Input id="rf-on" type="date" max={today()} value={rf.receivedOn} onChange={(e) => setRf({ ...rf, receivedOn: e.target.value })} /></FieldWrap>
              </div>
              <FieldWrap label="Note" htmlFor="rf-note"><Input id="rf-note" value={rf.note} onChange={(e) => setRf({ ...rf, note: e.target.value })} /></FieldWrap>
            </>
          ) : pending.kind === 'pay' ? (
            <>
              <p className="ctf-funds__note">Record a payment that has actually been made. It needs the bank or provider&apos;s transaction reference, and cannot reuse one already recorded. Someone else then reconciles it.</p>
              <div className="ctf-fform__row">
                <FieldWrap label="Transaction reference" htmlFor="pay-ref" required><Input id="pay-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} autoFocus /></FieldWrap>
                <FieldWrap label={`Amount actually paid (${r.currency})`} htmlFor="pay-amt" required><Input id="pay-amt" type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></FieldWrap>
              </div>
              <div className="ctf-fform__row">
                <FieldWrap label="Paid on" htmlFor="pay-on"><Input id="pay-on" type="date" max={today()} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></FieldWrap>
                <FieldWrap label="Note" htmlFor="pay-note"><Input id="pay-note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></FieldWrap>
              </div>
            </>
          ) : (
            <FieldWrap label={reasonNeeded ? 'Reason (required)' : 'Reason (optional)'} htmlFor="fr-reason"><Textarea id="fr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></FieldWrap>
          )}
          <div className="ctf-fform__actions">
            <Button variant="ghost" onClick={() => setPending(null)}>Back</Button>
            <Button type="submit" variant={pending.kind === 'review' && pending.decision === 'approved' ? 'primary' : pending.kind === 'review' && pending.decision === 'returned' ? 'secondary' : 'danger'} loading={busy}
              disabled={pending.kind === 'refund' ? rf.reference.trim().length < 3 || !(Number(rf.amount) > 0) : pending.kind === 'pay' ? pay.reference.trim().length < 4 || !(Number(pay.amount) > 0) : reasonNeeded && reason.trim().length < 3}>Confirm</Button>
          </div>
        </form>
      )}
    </div>
  )
}
