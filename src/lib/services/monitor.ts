import { supabase } from '../supabase'
import { newMonitorKey, type Health, type IncidentStatus, type Severity } from '../monitorRules'
import { sha256Hex } from '../supportRules'
import { toError } from './shared'

export interface MonitorProject {
  id: string; name: string; slug: string; kind: string; active: boolean; owner_department: string | null; health: Health; heartbeat_seconds: number
  last_heartbeat_at: string | null; last_event_at: string | null; sdk_name: string | null; sdk_version: string | null; release: string | null
  open_incidents: number; worst_severity: Severity | null; events_24h: number; errors_24h: number; p95_ms_24h: number | null
}
export interface SeriesPoint { bucket: string; events: number; errors: number; fatals: number; heartbeats: number; avg_ms: number | null; p95_ms: number | null; max_ms: number | null }
export interface TopError { fingerprint: string; message: string; level: string; occurrences: number; first_seen: string; last_seen: string; release: string | null; incident_ref: string | null }
export interface Occurrence { occurred_at: string; level: string; message: string; stack: string; route: string | null; release: string | null; environment: string; sdk_version: string | null }
export interface IncidentRow {
  id: string; ref: string; title: string; severity: Severity; status: IncidentStatus; source: string; project_id: string; project_name: string
  assignee_id: string | null; assignee_name: string | null; opened_at: string; acknowledged_at: string | null; resolved_at: string | null; ack_due_at: string | null
  escalation_level: number; reopen_count: number; duplicate_of_ref: string | null
}
export interface IncidentNote { id: string; kind: string; body: string; created_at: string; author_name: string | null }
export interface IncidentDetail { incident: IncidentRow & { fingerprint: string | null; root_cause: string | null }; duplicates: string[]; notes: IncidentNote[] }
export interface MonitorKeyRow { id: string; project_id: string; label: string; key_prefix: string; scopes: string[]; active: boolean; expires_at: string | null; created_at: string; revoked_at: string | null; last_used_at: string | null }
export interface Assignable { id: string; name: string }

export interface MoneyLine { currency: string; amount: number; count?: number; basis: 'actual' | 'reconciled' | 'pending' | 'estimated' }
export interface SuperDashboardData {
  generated_at: string
  sections: ('monitoring' | 'support' | 'finance' | 'renewals' | 'audit')[]
  monitoring?: { projects: Record<'total' | 'healthy' | 'degraded' | 'down' | 'unknown' | 'paused', number>; incidents: { open: number; critical: number; high: number; unacknowledged: number; oldest_unacknowledged_minutes: number | null }; errors_24h: number }
  support?: { open: number; overdue: number; unassigned: number; urgent: number }
  finance?: { needs_attention: number; pending_decision: MoneyLine[]; approved_unpaid: MoneyLine[]; paid_30d: MoneyLine[]; reconciled_30d: MoneyLine[] }
  renewals?: { due_30d_count: number; critical_due_30d: number; overdue: number; due_30d_amount: MoneyLine[] }
  audit?: { events_24h: number; warnings_24h: number; critical_24h: number; failed_24h: number; recent: { action: string; severity: string; created_at: string }[] }
}

const rpc = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => {
  const { data, error, status } = await supabase.rpc(fn, args)
  return { data: data as T | null, error: error ? toError(error, status) : null }
}
const fail = <T,>(fallback: T, error: Error | null) => ({ data: fallback, error })

export async function listMonitorProjects() { const r = await rpc<MonitorProject[]>('monitor_overview'); return r.error ? fail([] as MonitorProject[], r.error) : { data: r.data ?? [], error: null } }
export async function getSeries(project: string, hours = 24) { const r = await rpc<SeriesPoint[]>('monitor_series', { p_project: project, p_hours: hours }); return r.error ? fail([] as SeriesPoint[], r.error) : { data: r.data ?? [], error: null } }
export async function getTopErrors(project: string) { const r = await rpc<TopError[]>('monitor_top_errors', { p_project: project, p_limit: 10 }); return r.error ? fail([] as TopError[], r.error) : { data: r.data ?? [], error: null } }
export async function getOccurrences(project: string, fingerprint: string) { const r = await rpc<Occurrence[]>('monitor_recent_occurrences', { p_project: project, p_fingerprint: fingerprint, p_limit: 5 }); return r.error ? fail([] as Occurrence[], r.error) : { data: r.data ?? [], error: null } }
export async function listIncidents(scope: 'live' | 'resolved' | 'all', project: string | null = null) { const r = await rpc<IncidentRow[]>('monitor_incidents_list', { p_scope: scope, p_project: project, p_limit: 200 }); return r.error ? fail([] as IncidentRow[], r.error) : { data: r.data ?? [], error: null } }
export async function getIncident(id: string) { const r = await rpc<IncidentDetail>('monitor_incident_detail', { p_id: id }); return { data: r.data, error: r.error } }
export async function listAssignable(project: string) { const r = await rpc<Assignable[]>('monitor_assignable', { p_project: project }); return r.error ? fail([] as Assignable[], r.error) : { data: r.data ?? [], error: null } }

export async function openIncident(project: string, title: string, severity: Severity, note: string) { const r = await rpc<string>('monitor_open_incident', { p_project: project, p_title: title, p_severity: severity, p_note: note || null }); return { id: r.data, error: r.error } }
export const setIncidentStatus = async (id: string, status: IncidentStatus, rootCause?: string) => ({ error: (await rpc('monitor_set_incident_status', { p_id: id, p_status: status, p_root_cause: rootCause?.trim() || null })).error })
export const assignIncident = async (id: string, assignee: string | null) => ({ error: (await rpc('monitor_assign_incident', { p_id: id, p_assignee: assignee })).error })
export const setRootCause = async (id: string, text: string) => ({ error: (await rpc('monitor_set_root_cause', { p_id: id, p_text: text })).error })
export const addIncidentNote = async (id: string, body: string) => ({ error: (await rpc('monitor_add_note', { p_id: id, p_body: body })).error })
export const setIncidentSeverity = async (id: string, severity: Severity) => ({ error: (await rpc('monitor_set_severity', { p_id: id, p_severity: severity })).error })
export const markDuplicate = async (id: string, of: string) => ({ error: (await rpc('monitor_mark_duplicate', { p_id: id, p_of: of })).error })

// Main Admin controls
export async function registerMonitorProject(input: { name: string; slug: string; kind: string; department: string; heartbeatSeconds: number; burst: number; quota: number }) {
  const r = await rpc<string>('monitor_register_project', { p_name: input.name, p_slug: input.slug, p_kind: input.kind, p_owner_department_slug: input.department || null, p_workspace_project: null, p_heartbeat_seconds: input.heartbeatSeconds, p_error_burst_threshold: input.burst, p_event_quota_per_minute: input.quota })
  return { id: r.data, error: r.error }
}
export const setMonitorProjectActive = async (id: string, active: boolean) => ({ error: (await rpc('monitor_set_project_active', { p_id: id, p_active: active })).error })
export async function listMonitorKeys() {
  const { data, error } = await supabase.from('monitor_keys').select('id, project_id, label, key_prefix, scopes, active, expires_at, created_at, revoked_at, last_used_at').order('created_at', { ascending: false })
  return { data: (data ?? []) as MonitorKeyRow[], error: error ? toError(error) : null }
}
/** The key is made here and only its hash is sent; it is shown once and cannot be recovered. */
export async function createMonitorKey(project: string, label: string, scopes: string[], expiresAt: string | null) {
  const { key, prefix } = newMonitorKey()
  const r = await rpc('monitor_create_key', { p_project: project, p_label: label, p_key_hash: await sha256Hex(key), p_key_prefix: prefix, p_scopes: scopes, p_expires_at: expiresAt })
  return r.error ? { key: null, error: r.error } : { key, error: null }
}
export const revokeMonitorKey = async (id: string) => ({ error: (await rpc('monitor_revoke_key', { p_key: id })).error })
export async function runMonitorChecks() { const r = await rpc<{ silent_projects_opened: number; escalated: number; events_deleted: number; hourly_deleted: number }>('monitor_sweep'); return { data: r.data, error: r.error } }
export async function getSuperDashboard() { const r = await rpc<SuperDashboardData>('super_dashboard'); return { data: r.data, error: r.error } }
