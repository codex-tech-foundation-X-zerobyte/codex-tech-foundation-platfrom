import { supabase } from '../supabase'
import type { AuditLogEntry } from '../types'
import { toError } from './shared'

// Reads from the one canonical audit table, `audit_logs` (see
// /docs/DATABASE-SCHEMA.md — the older `audit_log`, singular, from the
// initial migration is superseded and unused by the app; nothing in the
// frontend queries it). RLS on audit_logs is gated by
// has_permission('audit_logs.view'), which only superadmin has by default.
export async function listAuditLogs(filters?: { severity?: string; limit?: number }) {
  let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(filters?.limit ?? 100)
  if (filters?.severity) query = query.eq('severity', filters.severity)
  const { data, error } = await query
  return { data: (data ?? []) as AuditLogEntry[], error: toError(error) }
}
