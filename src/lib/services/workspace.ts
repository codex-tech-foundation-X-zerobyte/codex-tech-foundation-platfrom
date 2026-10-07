import { supabase } from '../supabase'
import type { Client, Notification, ProjectRequest, Resource } from '../types'
import { toError } from './shared'

export async function listNotifications() {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
  return { data: (data ?? []) as Notification[], error: toError(error) }
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

export async function listClients() {
  const { data, error } = await supabase.from('clients').select('*').is('archived_at', null).order('created_at', { ascending: false })
  return { data: (data ?? []) as Client[], error: toError(error) }
}

export async function listProjectRequests(filters?: { projectId?: string }) {
  let query = supabase.from('project_requests').select('*').order('created_at', { ascending: false })
  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  const { data, error } = await query
  return { data: (data ?? []) as ProjectRequest[], error: toError(error) }
}

export async function updateProjectRequestStatus(id: string, status: ProjectRequest['status']) {
  // .select() so a row RLS silently filtered out (0 rows updated, no error) is reported instead of looking like success.
  const { data, error } = await supabase.from('project_requests').update({ status }).eq('id', id).select('id')
  if (!error && (data?.length ?? 0) === 0) return { error: new Error("You don't have permission to update this request.") }
  return { error: toError(error) }
}

export async function createProjectRequest(input: {
  project_id: string
  title: string
  body: string
  kind?: ProjectRequest['kind']
  priority?: ProjectRequest['priority']
}) {
  // requester_id and the initial status are set server-side by a trigger — a client can't spoof either.
  const { data, error } = await supabase
    .from('project_requests')
    .insert({ kind: 'request', priority: 'normal', ...input })
    .select('*')
    .single()
  return { data: data as ProjectRequest | null, error: toError(error) }
}

export async function listResources() {
  const { data, error } = await supabase.from('resources').select('*').is('archived_at', null).order('created_at', { ascending: false })
  return { data: (data ?? []) as Resource[], error: toError(error) }
}

/** Simple counts used by dashboards. Each is a real, permission-scoped Supabase query — never mocked. */
export async function countRows(table: string, filters?: Record<string, string | boolean | null>, idColumn = 'id') {
  let query = supabase.from(table).select(idColumn, { count: 'exact', head: true })
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = value === null ? query.is(key, null) : query.eq(key, value as string | boolean)
    }
  }
  const { count, error } = await query
  return { count: count ?? 0, error: toError(error) }
}
