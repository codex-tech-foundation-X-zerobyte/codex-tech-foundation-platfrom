import { supabase } from '../supabase'
import { storageKey } from '../storagePath'
import type { FundStatus, ReviewStage } from '../fundWorkflow'
import { storage, toError } from './shared'

export interface FundRequest {
  id: string; ref: string; requester_id: string; department_id: string; category: string; title: string; description: string; justification: string
  amount: number; currency: string; vendor: string; required_by: string | null; project_id: string | null; recurrence: string; status: FundStatus; version: number
  submitted_at: string | null; decided_at: string | null; payment_reference: string | null; amount_paid: number | null; paid_on: string | null
  payment_recorded_by: string | null; payment_note: string | null; reconciled_at: string | null; created_at: string; updated_at: string
}
export interface FundRequestRow extends FundRequest { requester_name: string; department_name: string }
export interface FundDecision { id: string; version: number; stage: string; decision: string; reason: string; actor_id: string; actor_name: string; acted_as: string; created_at: string }

const COLUMNS = 'id, ref, requester_id, department_id, category, title, description, justification, amount, currency, vendor, required_by, project_id, recurrence, status, version, submitted_at, decided_at, payment_reference, amount_paid, paid_on, payment_recorded_by, payment_note, reconciled_at, created_at, updated_at'
const BUCKET = 'finance-docs'
const num = (v: unknown) => Number(v)

/** Every request the viewer is allowed to see (row-level security decides), newest activity first. */
export async function listFundRequests() {
  const { data, error } = await supabase.from('fund_requests').select(COLUMNS).order('updated_at', { ascending: false }).limit(500)
  if (error) return { data: [] as FundRequestRow[], error: toError(error) }
  const rows = data as unknown as FundRequest[]
  const people = [...new Set(rows.map((r) => r.requester_id))], depts = [...new Set(rows.map((r) => r.department_id))]
  const [p, d] = await Promise.all([
    people.length ? supabase.from('profiles').select('id, display_name').in('id', people) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    depts.length ? supabase.from('departments').select('id, name').in('id', depts) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const pn = new Map((p.data ?? []).map((x) => [x.id, x.display_name])), dn = new Map((d.data ?? []).map((x) => [x.id, x.name]))
  return { data: rows.map((r) => ({ ...r, amount: num(r.amount), amount_paid: r.amount_paid === null ? null : num(r.amount_paid), requester_name: pn.get(r.requester_id) || 'Unknown', department_name: dn.get(r.department_id) || 'Department' })), error: null }
}

export async function listFundDecisions(requestId: string) {
  const { data, error } = await supabase.from('fund_request_decisions').select('id, version, stage, decision, reason, actor_id, acted_as, created_at').eq('request_id', requestId).order('created_at')
  if (error) return { data: [] as FundDecision[], error: toError(error) }
  const ids = [...new Set((data ?? []).map((d) => d.actor_id))]
  const { data: ps } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] as { id: string; display_name: string }[] }
  const names = new Map((ps ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((d) => ({ ...d, actor_name: names.get(d.actor_id) || 'Unknown' })) as FundDecision[], error: null }
}

export interface FundInput { department_id: string; category: string; title: string; description: string; justification: string; amount: number; currency: string; vendor: string; required_by: string | null; recurrence: string }

const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error, status } = await supabase.rpc(fn, args); return { data, error: error ? toError(error, status) : null } }

export async function createFundRequest(input: FundInput, submit: boolean, idempotencyKey: string) {
  const { data, error } = await rpc('create_fund_request', { p_data: input, p_submit: submit, p_idem: idempotencyKey })
  return { id: (data as string | null) ?? null, error }
}
export const updateFundRequest = async (id: string, input: Partial<FundInput>) => ({ error: (await rpc('update_fund_request', { p_id: id, p_data: input })).error })
export const submitFundRequest = async (id: string) => ({ error: (await rpc('submit_fund_request', { p_id: id })).error })
export const reviewFundRequest = async (id: string, version: number, stage: ReviewStage, decision: 'approved' | 'rejected' | 'returned', reason: string) =>
  ({ error: (await rpc('review_fund_request', { p_id: id, p_version: version, p_stage: stage, p_decision: decision, p_reason: reason })).error })
export const cancelFundRequest = async (id: string, reason: string) => ({ error: (await rpc('cancel_fund_request', { p_id: id, p_reason: reason })).error })
export const beginFundPayment = async (id: string, version: number) => ({ error: (await rpc('begin_fund_payment', { p_id: id, p_version: version })).error })
export const recordFundPayment = async (id: string, reference: string, amountPaid: number, paidOn: string, note: string) =>
  ({ error: (await rpc('record_fund_payment', { p_id: id, p_reference: reference, p_amount_paid: amountPaid, p_paid_on: paidOn || null, p_note: note })).error })
export const failFundPayment = async (id: string, reason: string) => ({ error: (await rpc('fail_fund_payment', { p_id: id, p_reason: reason })).error })
export const reconcileFundRequest = async (id: string, note: string) => ({ error: (await rpc('reconcile_fund_request', { p_id: id, p_note: note })).error })
export const reverseFundPayment = async (id: string, reason: string) => ({ error: (await rpc('reverse_fund_payment', { p_id: id, p_reason: reason })).error })

export interface SpendingRow { ref: string; title: string; department_name: string; category: string; amount: number; currency: string; status: string; decided_at: string | null; paid_on: string | null; amount_paid: number | null }
/** What the company has approved and spent. Safe for every active team member: no justification, vendor or requester. */
export async function listCompanySpending() {
  const { data, error } = await supabase.rpc('list_company_spending')
  if (error) return { data: [] as SpendingRow[], error: toError(error) }
  return { data: ((data ?? []) as SpendingRow[]).map((r) => ({ ...r, amount: num(r.amount), amount_paid: r.amount_paid === null ? null : num(r.amount_paid) })), error: null }
}

export async function uploadFundDoc(requestId: string, file: File) {
  const path = storageKey([requestId], file.name)
  const { error } = await storage.upload(BUCKET, path, file)
  return { error: error ?? null }
}
export async function listFundDocs(requestId: string) {
  const { data, error } = await supabase.storage.from(BUCKET).list(requestId, { limit: 50 })
  return { data: (data ?? []).map((f) => ({ name: f.name, path: `${requestId}/${f.name}` })), error: error ? toError(error) : null }
}
export const fundDocUrl = (path: string) => storage.getSignedUrl(BUCKET, path, 600)
