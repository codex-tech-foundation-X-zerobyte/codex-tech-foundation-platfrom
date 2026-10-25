/**
 * Finance office: pure helpers for budgets, renewals and receipts. The DATABASE does the calculating and enforces who may do what; this only
 * decides how to label things and which warnings to show.
 */
export type PeriodKind = 'month' | 'quarter' | 'year'
export const PERIOD_LABEL: Record<PeriodKind, string> = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' }
export const FREQUENCY_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** The first day of the period that contains `on` (YYYY-MM-DD). Budgets must start on exactly this day. */
export function periodStart(kind: PeriodKind, on: string): string {
  const [y, m] = on.split('-').map(Number)
  if (kind === 'month') return iso(y, m, 1)
  if (kind === 'quarter') return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1)
  return iso(y, 1, 1)
}
/** The first day of the period after the one starting at `start`. */
export function nextPeriodStart(kind: PeriodKind, start: string): string {
  const [y, m] = start.split('-').map(Number)
  const add = kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12
  const t = m - 1 + add
  return iso(y + Math.floor(t / 12), (t % 12) + 1, 1)
}
export function periodLabel(kind: PeriodKind, start: string): string {
  const [y, m] = start.split('-').map(Number)
  if (kind === 'year') return String(y)
  if (kind === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
}

export type BudgetState = 'ok' | 'near' | 'over' | 'none'
/** committed = approved-but-unpaid + paid + reconciled - refunded (pending requests are shown separately, never added in silently). */
export function budgetState(amount: number, committed: number, nearAt = 0.8): BudgetState {
  if (!(amount > 0)) return 'none'
  if (committed > amount) return 'over'
  return committed >= amount * nearAt ? 'near' : 'ok'
}
export const percentUsed = (amount: number, committed: number) => (amount > 0 ? Math.max(0, Math.round((committed / amount) * 100)) : 0)
export const BUDGET_STATE_LABEL: Record<BudgetState, string> = { ok: 'Within budget', near: 'Nearly used', over: 'Over budget', none: 'No budget' }

export function scopeLabel(departmentName: string | null | undefined, categoryLabel: string | null | undefined): string {
  if (departmentName && categoryLabel) return `${departmentName} · ${categoryLabel}`
  if (departmentName) return `${departmentName} · all categories`
  if (categoryLabel) return `Company · ${categoryLabel}`
  return 'Company-wide'
}

/** Whole days from `today` to `due` (both YYYY-MM-DD). Negative = overdue. */
export function daysUntil(due: string, today: string): number {
  const a = Date.UTC(...(due.split('-').map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number])
  const b = Date.UTC(...(today.split('-').map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number])
  return Math.round((a - b) / 86400000)
}
export type Urgency = 'overdue' | 'soon' | 'upcoming' | 'inactive'
export function renewalUrgency(days: number, status: string, soonWithin = 14): Urgency {
  if (status !== 'active') return 'inactive'
  if (days < 0) return 'overdue'
  return days <= soonWithin ? 'soon' : 'upcoming'
}
export function dueText(days: number): string {
  if (days < -1) return `${-days} days overdue`
  if (days === -1) return '1 day overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/** Parses "30, 14, 7, 1" into a clean, descending, unique list of 0-365 day offsets; null when it is not usable. */
export function parseRemindDays(text: string): number[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 8) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => Number.isNaN(n) || n > 365)) return null
  return [...new Set(nums)].sort((a, b) => b - a)
}

/** A paid request with no document attached after a grace period (the database uses the same 3 days for the Receipts list). */
export function receiptMissing(status: string, paidOn: string | null, documentCount: number, today: string, graceDays = 3): boolean {
  return ['paid', 'reconciled', 'reconciliation_required'].includes(status) && !!paidOn && documentCount === 0 && daysUntil(today, paidOn) >= graceDays
}

/** How much more can be refunded against a payment. */
export const refundableLeft = (amountPaid: number, alreadyRefunded: number) => Math.max(0, Math.round((amountPaid - alreadyRefunded) * 100) / 100)
export const canRecordRefund = (status: string, v: { isFinanceManager: boolean; isMainAdmin: boolean }) =>
  (v.isFinanceManager || v.isMainAdmin) && ['paid', 'reconciled', 'reconciliation_required'].includes(status)

/** The due date one cycle after `due` (YYYY-MM-DD), clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addCycle(due: string, frequency: string): string {
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12
  const [y, m, d] = due.split('-').map(Number)
  const t = m - 1 + months
  const ny = y + Math.floor(t / 12), nm = (t % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return iso(ny, nm, Math.min(d, last))
}
