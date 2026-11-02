import { supabase } from '../supabase'
import type { AuditLogEntry } from '../types'
import { toError } from './shared'

export async function listAuditLogs(limit = 100) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: (data ?? []) as AuditLogEntry[], error: toError(error) }
}
