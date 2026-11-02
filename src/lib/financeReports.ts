/**
 * Finance reports: pure helpers for choosing a period and for building a CSV. The DATABASE produces every figure (it counts recorded data
 * only); nothing here calculates money except adding up a column for a table footer.
 */
export type PresetId = 'today' | 'week' | 'month' | 'year' | 'last_month' | 'custom'
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'year', label: 'Yearly' }, { id: 'last_month', label: 'Last month' }, { id: 'custom', label: 'Custom' },
]
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const utc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const fromDate = (d: Date) => iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())

/** The date range a preset means on `today` (YYYY-MM-DD). Weeks run Monday to Sunday and stop at today; the month and year run from their first day to today. */
export function presetRange(preset: Exclude<PresetId, 'custom'>, today: string): { from: string; to: string } {
  const t = utc(today)
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') { const back = (t.getUTCDay() + 6) % 7; return { from: fromDate(new Date(t.getTime() - back * 86400000)), to: today } }
  if (preset === 'month') return { from: iso(t.getUTCFullYear(), t.getUTCMonth() + 1, 1), to: today }
  if (preset === 'year') return { from: iso(t.getUTCFullYear(), 1, 1), to: today }
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))
  return { from: fromDate(first), to: fromDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))) }
}

/** null when the range is acceptable, otherwise what to tell the person (the database checks the same rules). */
export function rangeProblem(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose both dates.'
  if (to < from) return 'The start date cannot be after the end date.'
  if ((utc(to).getTime() - utc(from).getTime()) / 86400000 > 800) return 'A report can cover about two years at most.'
  return null
}

/**
 * One CSV cell. Quotes and commas are handled, and a cell that starts with = + - @ (or a tab or return) is prefixed with an apostrophe so a
 * spreadsheet never runs it as a formula (CSV injection): vendor names and request titles come from people. Real numbers stay numbers.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export interface GroupRow { key: string; label: string; requested: number; approved: number; paid: number; refunded: number; net: number }
export const sumBy = (rows: GroupRow[], k: keyof Omit<GroupRow, 'key' | 'label'>) => rows.reduce((s, r) => s + r[k], 0)
/** Share of `part` in `whole` as a whole percentage (0 when there is nothing to share). */
export const share = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0)

export interface ReportMeta { from: string; to: string; currency: string; department_id: string | null; scope: 'company' | 'department'; generated_at: string; generated_by: string | null; basis: string[] }
export interface FinanceReport {
  meta: ReportMeta
  submitted: { requested: number; approved: number }
  moved: { paid: number; refunded: number; net_spend: number; income: number | null; net_position: number | null }
  income_by_source: { source: string; amount: number }[] | null
  pending_approvals: { count: number; amount: number }; approved_unpaid: { count: number; amount: number }; discrepancies: { count: number; amount: number }; missing_receipts: { count: number; amount: number }
  renewals: { due_within_30_days: number; amount_due_within_30_days: number; overdue: number }
  by_department: GroupRow[]; by_category: GroupRow[]; by_vendor: GroupRow[]; by_project: GroupRow[]
  by_month: { month: string; paid: number; refunded: number; income: number | null }[]
}
export const SOURCE_LABEL: Record<string, string> = { client_work_fee: 'Fee for Codex\u2019s own work', retainer: 'Retainer', product_sale: 'Own product sale', grant: 'Grant', other: 'Other' }

export interface ReportLine {
  ref: string; title: string; department: string; category: string; vendor: string; project: string | null; requester: string; status: string; amount: number; amount_paid: number | null; refunded: number
  currency: string; submitted_on: string; paid_on: string | null; payment_reference: string | null; has_receipt: boolean; discrepancy: boolean
}
/** The detail CSV: one row per request that took part in the period. */
export function linesCsv(lines: ReportLine[]): string {
  return toCsv(['Reference', 'Title', 'Department', 'Category', 'Vendor', 'Project', 'Requested by', 'Status', 'Currency', 'Amount requested', 'Amount paid', 'Refunded', 'Submitted on', 'Paid on', 'Payment reference', 'Receipt attached', 'Paid differs from approved'],
    lines.map((l) => [l.ref, l.title, l.department, l.category, l.vendor, l.project ?? '', l.requester, l.status, l.currency, l.amount, l.amount_paid, l.refunded, l.submitted_on, l.paid_on ?? '', l.payment_reference ?? '', l.has_receipt, l.discrepancy]))
}
/** The summary CSV: the report's metadata, headline figures and every breakdown, in one file that makes sense without the screen. */
export function summaryCsv(r: FinanceReport): string {
  const rows: unknown[][] = [
    ['Report', 'Finance report'], ['Period', `${r.meta.from} to ${r.meta.to}`], ['Currency', r.meta.currency], ['Scope', r.meta.scope === 'company' ? 'Company-wide' : 'Department'],
    ['Generated at', r.meta.generated_at], ['Generated by', r.meta.generated_by ?? ''], [], ['Submitted in the period', ''],
    ['Requested', r.submitted.requested], ['Approved', r.submitted.approved], [], ['Money moved in the period', ''],
    ['Paid', r.moved.paid], ['Refunded', r.moved.refunded], ['Net spend', r.moved.net_spend], ['Income (Codex\u2019s own)', r.moved.income ?? ''], ['Net position', r.moved.net_position ?? ''], [], ['As of the moment the report was generated', ''],
    ['Pending approvals (count)', r.pending_approvals.count], ['Pending approvals (amount)', r.pending_approvals.amount], ['Approved, unpaid (count)', r.approved_unpaid.count], ['Approved, unpaid (amount)', r.approved_unpaid.amount],
    ['Discrepancies (count)', r.discrepancies.count], ['Missing receipts (count)', r.missing_receipts.count], ['Renewals due in 30 days', r.renewals.due_within_30_days], ['Renewals overdue', r.renewals.overdue], [],
  ]
  const group = (title: string, g: GroupRow[]) => { rows.push([title, 'Requested', 'Approved', 'Paid', 'Refunded', 'Net']); for (const x of g) rows.push([x.label, x.requested, x.approved, x.paid, x.refunded, x.net]); rows.push([]) }
  group('By department', r.by_department); group('By category', r.by_category); group('By vendor', r.by_vendor); group('By project', r.by_project)
  rows.push(['By month', 'Paid', 'Refunded', 'Income'])
  for (const m of r.by_month) rows.push([m.month, m.paid, m.refunded, m.income ?? ''])
  rows.push([], ['How the figures are counted', ''])
  for (const b of r.meta.basis) rows.push([b])
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** How much of an income entry can still be reversed (reversals are recorded as separate entries pointing at the original). */
export function reversibleLeft(id: string, amount: number, entries: { kind: string; reversal_of: string | null; amount: number }[]): number {
  const done = entries.filter((e) => e.kind === 'reversal' && e.reversal_of === id).reduce((s, e) => s + e.amount, 0)
  return Math.max(0, Math.round((amount - done) * 100) / 100)
}
/** Starts a download of text in the browser. A byte-order mark makes Excel read accented characters correctly. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const reportFileName = (kind: 'summary' | 'detail', m: { from: string; to: string; currency: string; scope: string }) => `finance-${kind}-${m.from}_to_${m.to}-${m.currency}${m.scope === 'department' ? '-department' : ''}.csv`
