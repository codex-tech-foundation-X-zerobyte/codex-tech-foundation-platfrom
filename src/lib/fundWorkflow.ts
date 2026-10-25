/**
 * Fund requests: labels and "what can I do next" rules for the interface. The DATABASE enforces every rule (who may review which stage,
 * version checks, immutability); this only decides which buttons to show, so people are not offered actions that would be refused.
 */
export type FundStatus = 'draft' | 'finance_review' | 'department_review' | 'awaiting_super_admin' | 'approved' | 'payment_processing' | 'paid' | 'reconciled'
  | 'rejected' | 'returned' | 'payment_failed' | 'payment_reversed' | 'reconciliation_required' | 'cancelled'
export type ReviewStage = 'finance' | 'department' | 'super_admin'

export const STATUS_LABEL: Record<FundStatus, string> = {
  draft: 'Draft', finance_review: 'Finance review', department_review: 'Department review', awaiting_super_admin: 'Awaiting Main Admin', approved: 'Approved',
  payment_processing: 'Payment in progress', paid: 'Paid', reconciled: 'Reconciled', rejected: 'Rejected', returned: 'Returned for changes', payment_failed: 'Payment failed',
  payment_reversed: 'Payment reversed', reconciliation_required: 'Reconciliation required', cancelled: 'Cancelled',
}
export type StatusTone = 'neutral' | 'accent' | 'warning' | 'success' | 'danger'
export const STATUS_TONE: Record<FundStatus, StatusTone> = {
  draft: 'neutral', finance_review: 'accent', department_review: 'accent', awaiting_super_admin: 'warning', approved: 'success', payment_processing: 'warning', paid: 'success', reconciled: 'success',
  rejected: 'danger', returned: 'warning', payment_failed: 'danger', payment_reversed: 'danger', reconciliation_required: 'warning', cancelled: 'neutral',
}
export const CATEGORIES = [
  ['domain', 'Domain'], ['hosting', 'Hosting'], ['api_credits', 'API credits'], ['cloud', 'Cloud services'], ['software', 'Software subscription'],
  ['equipment', 'Equipment'], ['training', 'Training'], ['marketing', 'Marketing'], ['contractor', 'Contractor'], ['other', 'Other'],
] as const
export const categoryLabel = (c: string) => CATEGORIES.find(([k]) => k === c)?.[1] ?? c

/** The review stage a status is waiting on, if any. */
export const stageOf = (status: FundStatus): ReviewStage | null =>
  status === 'finance_review' ? 'finance' : status === 'department_review' ? 'department' : status === 'awaiting_super_admin' ? 'super_admin' : null

export const isFinal = (s: FundStatus) => ['rejected', 'cancelled', 'reconciled', 'payment_reversed'].includes(s)
/** Open = still moving: a request someone may still need to act on. */
export const isOpen = (s: FundStatus) => !isFinal(s)

export interface Viewer {
  id: string | undefined
  isMainAdmin: boolean
  /** Admin of the Finance department. */
  isFinanceManager: boolean
  /** Departments this person administers. */
  adminOf: string[]
}
export interface RequestLike { requester_id: string; department_id: string; status: FundStatus; payment_recorded_by?: string | null }

/** Which review stage (if any) this person is expected to act on for this request. Nobody reviews their own. */
export function reviewStageFor(r: RequestLike, v: Viewer): ReviewStage | null {
  const stage = stageOf(r.status)
  if (!stage || !v.id) return null
  if (stage === 'super_admin') return v.isMainAdmin ? stage : null
  if (r.requester_id === v.id) return null
  if (stage === 'finance') return v.isFinanceManager ? stage : null
  return v.adminOf.includes(r.department_id) ? stage : null
}

export interface Actions { edit: boolean; submit: boolean; cancel: boolean; review: ReviewStage | null; beginPayment: boolean; recordPayment: boolean; failPayment: boolean; reconcile: boolean; reverse: boolean; attach: boolean }

export function actionsFor(r: RequestLike, v: Viewer): Actions {
  const mine = !!v.id && r.requester_id === v.id
  const treasurer = (v.isFinanceManager || v.isMainAdmin) && !mine
  const none: Actions = { edit: false, submit: false, cancel: false, review: null, beginPayment: false, recordPayment: false, failPayment: false, reconcile: false, reverse: false, attach: false }
  return {
    ...none,
    edit: mine && (r.status === 'draft' || r.status === 'returned'),
    submit: mine && (r.status === 'draft' || r.status === 'returned'),
    cancel: (mine && ['draft', 'finance_review', 'department_review', 'awaiting_super_admin', 'returned'].includes(r.status)) || (v.isMainAdmin && ['approved', 'payment_failed', 'finance_review', 'department_review', 'awaiting_super_admin'].includes(r.status)),
    review: reviewStageFor(r, v),
    beginPayment: treasurer && (r.status === 'approved' || r.status === 'payment_failed'),
    recordPayment: treasurer && r.status === 'payment_processing',
    failPayment: treasurer && r.status === 'payment_processing',
    reconcile: treasurer && (r.status === 'paid' || r.status === 'reconciliation_required') && r.payment_recorded_by !== v.id,
    reverse: v.isMainAdmin && ['paid', 'reconciled', 'reconciliation_required'].includes(r.status),
    attach: (mine && (r.status === 'draft' || r.status === 'returned')) || v.isFinanceManager || v.isMainAdmin,
  }
}

/** What a reviewer is told about the stage in front of them. */
export const STAGE_HELP: Record<ReviewStage, string> = {
  finance: 'Check the amount, the evidence, the vendor and whether this has been paid before. Your approval sends it to the requesting department; it does not authorise payment.',
  department: 'Confirm this is a genuine, necessary expense for your department or project. Your approval sends it to the Main Admin; it does not authorise payment.',
  super_admin: 'Both reviews are done. Your decision is final. Approval does not pay: payment is recorded separately and then reconciled.',
}

export const money = (amount: number | string, currency: string) => {
  const n = Number(amount)
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n) } catch { return `${currency} ${n.toLocaleString('en')}` }
}
