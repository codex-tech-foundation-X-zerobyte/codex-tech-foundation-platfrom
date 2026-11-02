import { useState, type FormEvent } from 'react'
import { Download, FileSpreadsheet, Plus, Printer } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, Table, Tabs, Textarea, useToast } from '../../components/ui'
import { financeReport, financeReportLines, listIncome, recordIncome, reverseIncome, type IncomeEntry } from '../../lib/services'
import { categoryLabel, money } from '../../lib/fundWorkflow'
import { PRESETS, SOURCE_LABEL, downloadText, linesCsv, presetRange, rangeProblem, reportFileName, reversibleLeft, share, summaryCsv, sumBy, type FinanceReport, type GroupRow, type PresetId } from '../../lib/financeReports'
import { useAsyncData } from '../../hooks/useAsyncData'

const today = () => new Date().toISOString().slice(0, 10)
type Dim = 'by_department' | 'by_category' | 'by_vendor' | 'by_project' | 'by_month'
const DIMS: { id: Dim; label: string }[] = [{ id: 'by_department', label: 'Department' }, { id: 'by_category', label: 'Category' }, { id: 'by_vendor', label: 'Vendor' }, { id: 'by_project', label: 'Project' }, { id: 'by_month', label: 'Month' }]

/* ───────────────────────────── reports ───────────────────────────── */
export function ReportsTab({ departments }: { departments: { id: string; name: string }[] }) {
  const { push } = useToast()
  const [preset, setPreset] = useState<PresetId>('month')
  const [range, setRange] = useState(() => presetRange('month', today()))
  const [currency, setCurrency] = useState('NGN')
  const [department, setDepartment] = useState('')
  const [dim, setDim] = useState<Dim>('by_department')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FinanceReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const problem = rangeProblem(range.from, range.to) ?? (/^[A-Za-z]{3}$/.test(currency) ? null : 'Use a three-letter currency code, like NGN.')

  const choose = (id: PresetId) => { setPreset(id); if (id !== 'custom') setRange(presetRange(id, today())) }
  const generate = async (e?: FormEvent) => {
    e?.preventDefault()
    if (problem) return
    setBusy(true); setError(null)
    const r = await financeReport(range.from, range.to, currency.toUpperCase(), department || null)
    setBusy(false)
    if (r.error || !r.data) { setError(r.error?.message ?? 'The report could not be made.'); return }
    setResult(r.data)
  }
  const download = async (kind: 'summary' | 'detail') => {
    if (!result) return
    const m = result.meta
    if (kind === 'summary') { downloadText(reportFileName('summary', m), summaryCsv(result)); return }
    setBusy(true); const r = await financeReportLines(m.from, m.to, m.currency, m.department_id); setBusy(false)
    if (r.error) { push(r.error.message, 'error'); return }
    downloadText(reportFileName('detail', m), linesCsv(r.data))
    if (r.data.length >= 5000) push('The detail file stops at 5,000 lines. Choose a shorter period for the rest.', 'error')
  }

  return (
    <>
      <form className="ctf-fin__filters ctf-fin__noprint" onSubmit={(e) => void generate(e)}>
        <div className="ctf-fin__presets" role="group" aria-label="Report period">
          {PRESETS.map((p) => <button key={p.id} type="button" className={`ctf-fin__preset${preset === p.id ? ' is-on' : ''}`} aria-pressed={preset === p.id} onClick={() => choose(p.id)}>{p.label}</button>)}
        </div>
        <div className="ctf-fform__row">
          <FieldWrap label="From" htmlFor="rp-from"><Input id="rp-from" type="date" value={range.from} max={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }) }} /></FieldWrap>
          <FieldWrap label="To" htmlFor="rp-to"><Input id="rp-to" type="date" value={range.to} min={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }) }} /></FieldWrap>
        </div>
        <div className="ctf-fform__row">
          <FieldWrap label="Currency" htmlFor="rp-cur" hint="One currency per report; nothing is converted."><Input id="rp-cur" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></FieldWrap>
          <FieldWrap label="Department" htmlFor="rp-dept"><Select id="rp-dept" value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">All departments (company-wide)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FieldWrap>
        </div>
        {problem && <p className="ctf-fin__error" role="alert">{problem}</p>}
        <div className="ctf-fform__actions"><Button type="submit" variant="primary" loading={busy} disabled={!!problem}>Generate report</Button></div>
      </form>
      {error && <ErrorState title="The report couldn't be made" description={error} onRetry={() => void generate()} />}
      {!result && !error && <EmptyState icon={FileSpreadsheet} title="Choose a period and generate a report" description="Reports are built from recorded requests, payments, refunds and income. Each report you generate is logged." />}
      {result && <ReportView r={result} dim={dim} setDim={setDim} onDownload={(k) => void download(k)} busy={busy} />}
    </>
  )
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return <div className="ctf-kpi"><span>{label}</span><strong className={tone === 'bad' ? 'ctf-fin__neg' : undefined}>{value}</strong>{note && <small>{note}</small>}</div>
}

function ReportView({ r, dim, setDim, onDownload, busy }: { r: FinanceReport; dim: Dim; setDim: (d: Dim) => void; onDownload: (k: 'summary' | 'detail') => void; busy: boolean }) {
  const c = r.meta.currency
  const m = (n: number) => money(n, c)
  const groups: GroupRow[] = dim === 'by_month' ? [] : r[dim]
  const totalPaid = sumBy(groups, 'paid')
  return (
    <section className="ctf-fin__report" aria-label="Finance report">
      <header className="ctf-fin__reporthead">
        <div>
          <h3>Finance report · {r.meta.from} to {r.meta.to}</h3>
          <p className="ctf-funds__sub">{r.meta.scope === 'company' ? 'Company-wide' : 'One department'} · {c} · generated {new Date(r.meta.generated_at).toLocaleString()}{r.meta.generated_by ? ` by ${r.meta.generated_by}` : ''}</p>
        </div>
        <div className="ctf-fin__actions ctf-fin__noprint">
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => onDownload('summary')}>Summary CSV</Button>
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => onDownload('detail')} loading={busy}>Detail CSV</Button>
          <Button size="sm" variant="ghost" icon={<Printer size={14} />} onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </header>

      <h4 className="ctf-fin__h">Submitted in this period</h4>
      <div className="ctf-funds__totals">
        <Kpi label="Requested" value={m(r.submitted.requested)} note="Every request submitted (drafts excluded)" />
        <Kpi label="Approved" value={m(r.submitted.approved)} note="Of those, approved" />
      </div>
      <h4 className="ctf-fin__h">Money moved in this period</h4>
      <div className="ctf-funds__totals">
        <Kpi label="Paid" value={m(r.moved.paid)} note="By the day it was paid" />
        <Kpi label="Refunded" value={m(r.moved.refunded)} note="Refunds and chargebacks received" />
        <Kpi label="Net spend" value={m(r.moved.net_spend)} note="Paid minus refunded" />
        {r.moved.income !== null && <Kpi label="Income" value={m(r.moved.income)} note="Codex's own, net of reversals" />}
        {r.moved.net_position !== null && <Kpi label="Net position" value={m(r.moved.net_position)} note="Income minus net spend" tone={r.moved.net_position < 0 ? 'bad' : 'good'} />}
      </div>
      {r.income_by_source && r.income_by_source.length > 0 && <p className="ctf-funds__note">Income by source: {r.income_by_source.map((s) => `${SOURCE_LABEL[s.source] ?? s.source} ${m(s.amount)}`).join(' · ')}</p>}

      <h4 className="ctf-fin__h">As of {new Date(r.meta.generated_at).toLocaleDateString()} (not limited to the period)</h4>
      <div className="ctf-funds__totals">
        <Kpi label="Pending approvals" value={String(r.pending_approvals.count)} note={m(r.pending_approvals.amount)} />
        <Kpi label="Approved, not yet paid" value={String(r.approved_unpaid.count)} note={m(r.approved_unpaid.amount)} />
        <Kpi label="Discrepancies" value={String(r.discrepancies.count)} note={r.discrepancies.count ? `Paid differs by ${m(r.discrepancies.amount)}` : 'None'} tone={r.discrepancies.count ? 'bad' : undefined} />
        <Kpi label="Missing receipts" value={String(r.missing_receipts.count)} note={r.missing_receipts.count ? m(r.missing_receipts.amount) : 'None'} tone={r.missing_receipts.count ? 'bad' : undefined} />
        <Kpi label="Renewals due in 30 days" value={String(r.renewals.due_within_30_days)} note={`${m(r.renewals.amount_due_within_30_days)}${r.renewals.overdue ? ` · ${r.renewals.overdue} overdue` : ''}`} tone={r.renewals.overdue ? 'bad' : undefined} />
      </div>

      <h4 className="ctf-fin__h ctf-fin__noprint">Breakdown</h4>
      <div className="ctf-fin__noprint"><Tabs tabs={DIMS.map((d) => ({ id: d.id, label: d.label }))} active={dim} onChange={(id) => setDim(id as Dim)} label="Report breakdown" /></div>
      {dim === 'by_month' ? (
        <Table rows={r.by_month} rowKey={(x) => x.month} emptyState={<EmptyState title="Nothing in this period" description="No payments, refunds or income were recorded." />}
          columns={[
            { key: 'month', header: 'Month', render: (x) => x.month },
            { key: 'paid', header: 'Paid', render: (x) => <span className="ctf-funds__amount">{m(x.paid)}</span> },
            { key: 'ref', header: 'Refunded', render: (x) => <span className="ctf-funds__amount">{m(x.refunded)}</span> },
            ...(r.meta.scope === 'company' ? [{ key: 'inc', header: 'Income', render: (x: FinanceReport['by_month'][number]) => <span className="ctf-funds__amount">{x.income === null ? '—' : m(x.income)}</span> }] : []),
          ]} />
      ) : (
        <Table rows={groups} rowKey={(x) => x.key || x.label} emptyState={<EmptyState title="Nothing in this period" description="No requests or payments fall in this period for this currency." />}
          columns={[
            { key: 'label', header: DIMS.find((d) => d.id === dim)?.label ?? '', render: (x) => <strong>{dim === 'by_category' ? categoryLabel(x.label) : x.label}</strong> },
            { key: 'req', header: 'Requested', render: (x) => <span className="ctf-funds__amount">{m(x.requested)}</span> },
            { key: 'app', header: 'Approved', render: (x) => <span className="ctf-funds__amount">{m(x.approved)}</span> },
            { key: 'paid', header: 'Paid', render: (x) => <><span className="ctf-funds__amount">{m(x.paid)}</span><div className="ctf-meter__bar ctf-meter__bar--ok" aria-hidden="true"><span style={{ width: `${share(x.paid, totalPaid)}%` }} /></div></> },
            { key: 'ref', header: 'Refunded', render: (x) => <span className="ctf-funds__amount">{m(x.refunded)}</span> },
            { key: 'net', header: 'Net', render: (x) => <span className="ctf-funds__amount">{m(x.net)}</span> },
          ]} />
      )}
      <details className="ctf-fin__basis"><summary>How these figures are counted</summary><ul>{r.meta.basis.map((b) => <li key={b}>{b}</li>)}</ul></details>
    </section>
  )
}

/* ───────────────────────────── income ───────────────────────────── */
export function IncomeTab({ manage }: { manage: boolean }) {
  const data = useAsyncData('finance-income', listIncome)
  const [adding, setAdding] = useState(false)
  const [reversing, setReversing] = useState<IncomeEntry | null>(null)
  const rows = data.data ?? []
  return (
    <>
      <div className="ctf-fin__bar">
        <p className="ctf-funds__note">Record only money <strong>Codex itself earned</strong>: fees for its own work, retainers, its own product sales, grants. Money that passes through Codex for a client, and a client project&apos;s own payment volume, is not income and does not belong here. Entries cannot be edited or deleted; a mistake is fixed with a reversal.</p>
        {manage && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Record income</Button>}
      </div>
      {data.error ? <ErrorState title="Income couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table loading={data.loading} rows={rows} rowKey={(r: IncomeEntry) => r.id}
          emptyState={<EmptyState icon={FileSpreadsheet} title="No income recorded yet" description="Income appears here, and in the company report, once Finance records it." />}
          columns={[
            { key: 'on', header: 'Received', render: (r: IncomeEntry) => r.received_on },
            { key: 'ref', header: 'Reference', render: (r: IncomeEntry) => <><strong>{r.reference}</strong>{r.description && <div className="ctf-funds__sub">{r.description}</div>}</> },
            { key: 'src', header: 'Source', render: (r: IncomeEntry) => <>{SOURCE_LABEL[r.source] ?? r.source}{r.kind === 'reversal' && <> <Badge tone="warning">Reversal</Badge></>}</> },
            { key: 'amt', header: 'Amount', render: (r: IncomeEntry) => <span className={`ctf-funds__amount${r.kind === 'reversal' ? ' ctf-fin__neg' : ''}`}>{r.kind === 'reversal' ? '−' : ''}{money(r.amount, r.currency)}</span> },
            ...(manage ? [{ key: 'act', header: '', render: (r: IncomeEntry) => (r.kind === 'income' && reversibleLeft(r.id, r.amount, rows) > 0 ? <Button size="sm" variant="ghost" onClick={() => setReversing(r)}>Reverse</Button> : null) }] : []),
          ]} />
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Record income" description="Money Codex itself has received.">
        {adding && <IncomeForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); data.reload() }} />}
      </Modal>
      <Modal open={!!reversing} onClose={() => setReversing(null)} title="Reverse income" description="Use this when income was recorded wrongly or money had to be given back.">
        {reversing && <ReverseForm entry={reversing} left={reversibleLeft(reversing.id, reversing.amount, rows)} onClose={() => setReversing(null)} onDone={() => { setReversing(null); data.reload() }} />}
      </Modal>
    </>
  )
}

function IncomeForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ amount: '', currency: 'NGN', source: 'client_work_fee', reference: '', on: today(), description: '' })
  const [busy, setBusy] = useState(false)
  const valid = Number(f.amount) > 0 && /^[A-Za-z]{3}$/.test(f.currency) && f.reference.trim().length >= 3 && !!f.on
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!valid) return
    setBusy(true); const { error } = await recordIncome(Number(f.amount), f.currency.toUpperCase(), f.source, f.reference.trim(), f.on, f.description.trim()); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push('Income recorded.'); onDone()
  }
  return (
    <form className="ctf-fform" onSubmit={(e) => void submit(e)}>
      <div className="ctf-fform__row">
        <FieldWrap label="Amount" htmlFor="in-amt" required><Input id="in-amt" type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></FieldWrap>
        <FieldWrap label="Currency" htmlFor="in-cur"><Input id="in-cur" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></FieldWrap>
      </div>
      <div className="ctf-fform__row">
        <FieldWrap label="What it is" htmlFor="in-src"><Select id="in-src" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
        <FieldWrap label="Received on" htmlFor="in-on"><Input id="in-on" type="date" max={today()} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></FieldWrap>
      </div>
      <FieldWrap label="Reference" htmlFor="in-ref" required hint="Invoice or bank reference. It cannot be used twice."><Input id="in-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></FieldWrap>
      <FieldWrap label="Note" htmlFor="in-note"><Textarea id="in-note" rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FieldWrap>
      <div className="ctf-fform__actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>Record income</Button></div>
    </form>
  )
}

function ReverseForm({ entry, left, onClose, onDone }: { entry: IncomeEntry; left: number; onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ amount: String(left), reference: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const amount = Number(f.amount)
  const valid = amount > 0 && amount <= left && f.reference.trim().length >= 3 && f.reason.trim().length >= 3
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!valid) return
    setBusy(true); const { error } = await reverseIncome(entry.id, amount, f.reference.trim(), f.reason.trim()); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push('Reversal recorded.'); onDone()
  }
  return (
    <form className="ctf-fform" onSubmit={(e) => void submit(e)}>
      <p className="ctf-funds__note">{entry.reference} · {money(entry.amount, entry.currency)} · up to {money(left, entry.currency)} can still be reversed.</p>
      <div className="ctf-fform__row">
        <FieldWrap label={`Amount (${entry.currency})`} htmlFor="rv-amt" required error={amount > left ? 'More than can be reversed.' : undefined}><Input id="rv-amt" type="number" step="0.01" min="0" max={left} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></FieldWrap>
        <FieldWrap label="Reference for the reversal" htmlFor="rv-ref" required><Input id="rv-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></FieldWrap>
      </div>
      <FieldWrap label="Why" htmlFor="rv-why" required><Textarea id="rv-why" rows={2} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FieldWrap>
      <div className="ctf-fform__actions"><Button variant="ghost" onClick={onClose}>Back</Button><Button type="submit" variant="danger" loading={busy} disabled={!valid}>Record reversal</Button></div>
    </form>
  )
}

