import { supabase } from '../supabase'
import { newProjectKey, sha256Hex, type TicketPriority, type TicketStatus } from '../supportRules'
import { toError } from './shared'

export interface Ticket {
  id: string; ref: string; source_id: string | null; external_ref: string | null; customer_ref: string; customer_name: string; subject: string; description: string
  category: string; priority: TicketPriority; status: TicketStatus; assignee_id: string | null; escalated_department_id: string | null; created_by: string | null
  due_at: string; first_response_at: string | null; resolved_at: string | null; rating: number | null; rating_note: string | null; created_at: string; updated_at: string
}
export interface TicketRow extends Ticket { assignee_name: string | null; source_name: string | null }
export interface TicketMessage { id: string; author_id: string | null; author_kind: 'agent' | 'customer' | 'system'; visibility: 'public' | 'internal'; body: string; created_at: string; author_name: string }
export interface SupportSource { id: string; name: string; key_prefix: string; active: boolean; created_at: string; last_used_at: string | null }

const COLUMNS = 'id, ref, source_id, external_ref, customer_ref, customer_name, subject, description, category, priority, status, assignee_id, escalated_department_id, created_by, due_at, first_response_at, resolved_at, rating, rating_note, created_at, updated_at'
const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error, status } = await supabase.rpc(fn, args); return { data, error: error ? toError(error, status) : null } }

export async function listTickets() {
  const { data, error } = await supabase.from('support_tickets').select(COLUMNS).order('created_at', { ascending: false }).limit(1000)
  if (error) return { data: [] as TicketRow[], error: toError(error) }
  const rows = data as unknown as Ticket[]
  const people = [...new Set(rows.map((r) => r.assignee_id).filter((x): x is string => !!x))], srcs = [...new Set(rows.map((r) => r.source_id).filter((x): x is string => !!x))]
  const [p, s] = await Promise.all([
    people.length ? supabase.from('profiles').select('id, display_name').in('id', people) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    srcs.length ? supabase.from('support_sources').select('id, name').in('id', srcs) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const pn = new Map((p.data ?? []).map((x) => [x.id, x.display_name])), sn = new Map((s.data ?? []).map((x) => [x.id, x.name]))
  return { data: rows.map((r) => ({ ...r, assignee_name: r.assignee_id ? pn.get(r.assignee_id) ?? 'Unknown' : null, source_name: r.source_id ? sn.get(r.source_id) ?? null : null })) as TicketRow[], error: null }
}

export async function listTicketMessages(ticketId: string) {
  const { data, error } = await supabase.from('support_messages').select('id, author_id, author_kind, visibility, body, created_at').eq('ticket_id', ticketId).order('created_at')
  if (error) return { data: [] as TicketMessage[], error: toError(error) }
  const ids = [...new Set((data ?? []).map((m) => m.author_id).filter((x): x is string => !!x))]
  const { data: ps } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] as { id: string; display_name: string }[] }
  const names = new Map((ps ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((m) => ({ ...m, author_name: m.author_id ? names.get(m.author_id) || 'Teammate' : m.author_kind === 'customer' ? 'Customer' : 'System' })) as TicketMessage[], error: null }
}

export interface NewTicket { customer_ref: string; customer_name: string; subject: string; description: string; category: string; priority: string }
export async function createSupportTicket(input: NewTicket) { const r = await rpc('create_support_ticket', { p_data: input }); return { id: r.data as string | null, error: r.error } }
export const assignTicket = async (id: string, assignee: string | null) => ({ error: (await rpc('assign_ticket', { p_id: id, p_assignee: assignee })).error })
export const setTicketStatus = async (id: string, status: TicketStatus) => ({ error: (await rpc('set_ticket_status', { p_id: id, p_status: status })).error })
export const replyToTicket = async (id: string, body: string, visibility: 'public' | 'internal') => ({ error: (await rpc('reply_to_ticket', { p_id: id, p_body: body, p_visibility: visibility })).error })
export const escalateTicket = async (id: string, departmentSlug: string, note: string) => ({ error: (await rpc('escalate_ticket', { p_id: id, p_department_slug: departmentSlug, p_note: note })).error })

export async function listSupportSources() {
  const { data, error } = await supabase.from('support_sources').select('id, name, key_prefix, active, created_at, last_used_at').order('created_at', { ascending: false })
  return { data: (data ?? []) as SupportSource[], error: error ? toError(error) : null }
}
/** Connects a project. The key is made in the browser and only its hash is sent; the key is shown once and cannot be recovered. */
export async function connectSupportProject(name: string) {
  const { key, prefix } = newProjectKey()
  const r = await rpc('register_support_source', { p_name: name, p_key_hash: await sha256Hex(key), p_key_prefix: prefix, p_project: null })
  return r.error ? { key: null, error: r.error } : { key, error: null }
}
export const setSupportProjectActive = async (id: string, active: boolean) => ({ error: (await rpc('set_support_source_active', { p_id: id, p_active: active })).error })

/** The Customer Service team, for assignment. */
export async function listSupportAgents() {
  const { data: dept } = await supabase.from('departments').select('id').eq('slug', 'customer-service').maybeSingle()
  if (!dept) return { data: [] as { id: string; name: string }[], error: null }
  const { data, error } = await supabase.from('worker_departments').select('user_id').eq('department_id', dept.id)
  if (error) return { data: [], error: toError(error) }
  const ids = (data ?? []).map((r) => r.user_id)
  const { data: ps } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] as { id: string; display_name: string }[] }
  return { data: (ps ?? []).map((p) => ({ id: p.id, name: p.display_name || 'Unnamed' })), error: null }
}
