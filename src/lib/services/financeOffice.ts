import { supabase } from '../supabase'
import { toError } from './shared'
import type { PeriodKind } from '../financeRules'

const num = (v: unknown) => Number(v)
const rpc = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => {
  const { data, error, status } = await supabase.rpc(fn, args)
  return { data: data as T | null, error: error ? toError(error, status) : null }
}

export interface BudgetStatus {
  budget_id: string; department_id: string | null; department_name: string | null; category: string | null; period_kind: PeriodKind; period_start: string; period_end: string
  amount: number; currency: string; note: string; version: number
  pending: number; approved_unpaid: number; paid: number; reconciled: number; refunded: number; spent: number; committed: number; remaining: number
}
const BUDGET_NUMBERS = ['amount', 'pending', 'approved_unpaid', 'paid', 'reconciled', 'refunded', 'spent', 'committed', 'remaining'] as const

/** Budgets covering `on` (default today) with what has been spent against each. The database decides which ones this person may see. */
export async function listBudgetStatus(on?: string) {
  const { data, error } = await rpc<BudgetStatus[]>('list_budget_status', on ? { p_on: on } : {})
  const rows = (data ?? []).map((r) => { const o = { ...r } as Record<string, unknown>; for (const k of BUDGET_NUMBERS) o[k] = num(o[k]); return o as unknown as BudgetStatus })
  return { data: rows, error }
}
export interface BudgetInput { department_id: string | null; category: string | null; period_kind: PeriodKind; period_start: string; amount: number; currency: string; note: string }
export const createBudget = async (input: BudgetInput) => ({ error: (await rpc('save_finance_budget', { p_id: null, p_data: input })).error })
export const changeBudget = async (id: string, change: { amount?: number; note?: string }) => ({ error: (await rpc('save_finance_budget', { p_id: id, p_data: change })).error })
export const archiveBudget = async (id: string, reason: string) => ({ error: (await rpc('archive_finance_budget', { p_id: id, p_reason: reason })).error })

export interface BudgetPanelRow {
  budget_id: string; scope: 'department_category' | 'department' | 'category' | 'company'; period_kind: PeriodKind; period_start: string; period_end: string; amount: number; currency: string
  pending: number; approved_unpaid: number; paid: number; reconciled: number; refunded: number; this_request: number; remaining_after: number; over_budget: boolean
}
/** For a Finance reviewer: every budget that covers this request, and what would be left if it were approved. */
export async function budgetPanelForRequest(requestId: string) {
  const { data, error } = await rpc<BudgetPanelRow[]>('budget_utilisation_for_request', { p_request: requestId })
  return { data: (data ?? []).map((r) => ({ ...r, amount: num(r.amount), pending: num(r.pending), approved_unpaid: num(r.approved_unpaid), paid: num(r.paid), reconciled: num(r.reconciled), refunded: num(r.refunded), this_request: num(r.this_request), remaining_after: num(r.remaining_after) })), error }
}

export interface Vendor { id: string; name: string; category: string | null; website: string | null; status: 'active' | 'inactive' }
export async function listVendors() {
  const { data, error } = await supabase.from('finance_vendors').select('id, name, category, website, status').order('name')
  return { data: (data ?? []) as Vendor[], error: error ? toError(error) : null }
}
export const saveVendor = async (v: { id?: string | null; name: string; category: string | null; website: string | null; status: 'active' | 'inactive' }) =>
  ({ error: (await rpc('save_finance_vendor', { p_id: v.id ?? null, p_name: v.name, p_category: v.category, p_website: v.website, p_status: v.status })).error })

export interface Refund { id: string; request_id: string; kind: 'refund' | 'chargeback'; amount: number; currency: string; reference: string; received_on: string; note: string; created_at: string }
export async function listRefunds(requestId: string) {
  const { data, error } = await supabase.from('finance_refunds').select('id, request_id, kind, amount, currency, reference, received_on, note, created_at').eq('request_id', requestId).order('created_at')
  return { data: (data ?? []).map((r) => ({ ...r, amount: num(r.amount) })) as Refund[], error: error ? toError(error) : null }
}
export const recordRefund = async (requestId: string, kind: 'refund' | 'chargeback', amount: number, reference: string, receivedOn: string, note: string) =>
  ({ error: (await rpc('record_fund_refund', { p_request: requestId, p_kind: kind, p_amount: amount, p_reference: reference, p_received_on: receivedOn, p_note: note })).error })

export interface Renewal {
  id: string; department_id: string; title: string; category: string; vendor: string; amount: number; currency: string; frequency: 'monthly' | 'quarterly' | 'yearly'; next_due: string
  critical: boolean; remind_days: number[]; status: 'active' | 'paused' | 'cancelled'; notes: string; last_request_id: string | null; version: number
}
export async function listRenewals() {
  const { data, error } = await supabase.from('finance_renewals').select('id, department_id, title, category, vendor, amount, currency, frequency, next_due, critical, remind_days, status, notes, last_request_id, version').order('next_due')
  return { data: (data ?? []).map((r) => ({ ...r, amount: num(r.amount) })) as Renewal[], error: error ? toError(error) : null }
}
export interface RenewalInput { department_id: string; title: string; category: string; vendor: string; amount: number; currency: string; frequency: string; next_due: string; critical: boolean; remind_days: number[]; notes: string }
export const createRenewal = async (input: RenewalInput) => ({ error: (await rpc('save_finance_renewal', { p_id: null, p_data: input })).error })
export const changeRenewal = async (id: string, change: Partial<Omit<RenewalInput, 'department_id' | 'currency'>>) => ({ error: (await rpc('save_finance_renewal', { p_id: id, p_data: change })).error })
export const setRenewalStatus = async (id: string, status: 'active' | 'paused' | 'cancelled', reason = '') => ({ error: (await rpc('set_finance_renewal_status', { p_id: id, p_status: status, p_reason: reason })).error })
export const markRenewalRenewed = async (id: string, nextDue: string) => ({ error: (await rpc('mark_finance_renewal_renewed', { p_id: id, p_next_due: nextDue })).error })
/** Makes an ordinary DRAFT fund request from a renewal. It never pays or approves anything. */
export async function requestFromRenewal(id: string) {
  const { data, error } = await rpc<string>('create_fund_request_from_renewal', { p_id: id, p_submit: false })
  return { id: data, error }
}
export async function sendRenewalReminders() {
  const { data, error } = await rpc<number>('send_due_renewal_reminders')
  return { sent: data === null ? 0 : num(data), error }
}

export interface MissingReceipt { request_id: string; ref: string; title: string; department_name: string; amount_paid: number; currency: string; paid_on: string; days_open: number }
export async function listMissingReceipts() {
  const { data, error } = await rpc<MissingReceipt[]>('list_missing_receipts')
  return { data: (data ?? []).map((r) => ({ ...r, amount_paid: num(r.amount_paid) })), error }
}
