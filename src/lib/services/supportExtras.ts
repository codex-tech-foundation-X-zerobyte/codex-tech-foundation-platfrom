import { supabase } from '../supabase'
import { storageKey } from '../storagePath'
import { checkAttachment } from '../supportRules'
import { toError } from './shared'

export type AttachmentVisibility = 'internal' | 'public'

export interface AttachmentRow { id: string; ticket_id: string; path: string; file_name: string; mime_type: string; size_bytes: number; visibility: AttachmentVisibility; created_at: string }
export interface IncidentLink { id: string; ref: string; status: string; severity: string; project: string; linked_at: string }
export interface WorkloadPerson { user_id: string; name: string; open: number; overdue: number; waiting_for_customer: number; resolved_7d: number; avg_first_response_minutes_7d: number | null; avg_rating_30d: number | null; on_shift: boolean }
export interface Workload { unassigned: number; people: WorkloadPerson[] }
export interface ShiftRow { id: string; user_id: string; name: string; starts_at: string; ends_at: string; note: string | null; on_now: boolean }
export interface CallbackSummary { source_id: string; name: string; configured: boolean; enabled: boolean; host: string; pending: number; dead: number; delivered_24h: number; last_delivery_at: string | null; last_error: string | null }
export interface CallbackEvent { id: string; event: string; ticket_ref: string; status: 'pending' | 'delivering' | 'delivered' | 'dead'; attempts: number; last_http: number | null; last_error: string | null; created_at: string; delivered_at: string | null }

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => {
  const { data, error, status } = await supabase.rpc(fn, args)
  return { data: data as T | null, error: error ? toError(error, status) : null }
}

export async function listAttachments(ticketId: string) {
  const { data, error } = await supabase.from('support_attachments').select('id, ticket_id, path, file_name, mime_type, size_bytes, visibility, created_at').eq('ticket_id', ticketId).order('created_at')
  return { data: (data ?? []) as AttachmentRow[], error: error ? toError(error) : null }
}
/** Upload, then register. If registering fails the uploaded file stays private and unlisted (nobody can delete evidence), and the message says so. */
export async function addAttachment(ticketId: string, file: File, visibility: AttachmentVisibility) {
  const problem = checkAttachment(file)
  if (problem) return { error: new Error(problem) }
  const path = storageKey([ticketId], file.name)
  const up = await supabase.storage.from('support-attachments').upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) return { error: new Error('The file could not be uploaded. Check your connection and try again.') }
  const r = await rpc('support_add_attachment', { p_ticket: ticketId, p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size, p_visibility: visibility })
  return { error: r.error ? new Error(`${r.error.message} The file was uploaded but not attached.`) : null }
}
/** A link that works for one minute. */
export async function attachmentLink(path: string) {
  const { data, error } = await supabase.storage.from('support-attachments').createSignedUrl(path, 60)
  return { url: data?.signedUrl ?? null, error: error ? new Error('The link could not be made.') : null }
}

export async function listIncidentLinks(ticketId: string) { const r = await rpc<IncidentLink[]>('support_ticket_incident_links', { p_ticket: ticketId }); return { data: r.data ?? [], error: r.error } }
export const linkIncident = async (ticketId: string, ref: string) => ({ error: (await rpc('support_link_incident', { p_ticket: ticketId, p_incident_ref: ref })).error })
export const unlinkIncident = async (ticketId: string, incidentId: string) => ({ error: (await rpc('support_unlink_incident', { p_ticket: ticketId, p_incident: incidentId })).error })

export async function getWorkload() { const r = await rpc<Workload>('support_workload'); return { data: r.data, error: r.error } }
export async function getRoster() { const r = await rpc<ShiftRow[]>('support_roster'); return { data: r.data ?? [], error: r.error } }
export const addShift = async (userId: string, startsAt: string, endsAt: string, note: string) => ({ error: (await rpc('support_add_shift', { p_user: userId, p_starts: startsAt, p_ends: endsAt, p_note: note || null })).error })
export const deleteShift = async (id: string) => ({ error: (await rpc('support_delete_shift', { p_id: id })).error })

export async function getCallbacks() { const r = await rpc<CallbackSummary[]>('support_callbacks_overview'); return { data: r.data ?? [], error: r.error } }
/** Returns the new signing secret. It is shown once and cannot be read again. */
export async function setCallback(sourceId: string, url: string) { const r = await rpc<string>('support_set_callback', { p_source: sourceId, p_url: url }); return { secret: r.data, error: r.error } }
export const clearCallback = async (sourceId: string) => ({ error: (await rpc('support_clear_callback', { p_source: sourceId })).error })
export async function listCallbackEvents(sourceId: string) { const r = await rpc<CallbackEvent[]>('support_callback_events_list', { p_source: sourceId, p_limit: 25 }); return { data: r.data ?? [], error: r.error } }
export const retryCallback = async (eventId: string) => ({ error: (await rpc('support_callback_retry', { p_event: eventId })).error })
