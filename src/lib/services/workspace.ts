import { supabase } from '../supabase'
import type { Notification, ProjectRequest } from '../types'
import { toError } from './shared'

export async function listNotifications() {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
  return { data: (data ?? []) as Notification[], error: toError(error) }
}

<<<<<<< HEAD
=======
export async function getUnreadNotificationCount() {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  return { count: count ?? 0, error: toError(error) }
}

>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

// Note: client listing lives in clients.ts (Pass 4's createClientAccount
// module) now, not here — this avoided a duplicate `listClients` export
// ambiguity between the two files. clients.ts's version returns every
// client including archived ones (AdminClients.tsx's status badge and
// "Archive" action both depend on archived clients staying visible, not
// disappearing from the list once archived).

export async function listProjectRequests(filters?: { projectId?: string }) {
  let query = supabase.from('project_requests').select('*').order('created_at', { ascending: false })
  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  const { data, error } = await query
  return { data: (data ?? []) as ProjectRequest[], error: toError(error) }
}

export async function updateProjectRequestStatus(id: string, status: ProjectRequest['status']) {
  const { error } = await supabase.from('project_requests').update({ status }).eq('id', id)
  return { error: toError(error) }
}

export async function createProjectRequest(input: { project_id: string; title: string; body: string }) {
  const { error } = await supabase.from('project_requests').insert({ ...input, status: 'open' })
  return { error: toError(error) }
}

// Note: file listing/upload/trash/versioning now lives in resourceFiles.ts
// (Team Files, Pass 4) — this file no longer defines listResources() to
// avoid two competing implementations of the same query.

/** Simple counts used by dashboards. Each is a real, permission-scoped Supabase query — never mocked. */
export async function countRows(table: string, filters?: Record<string, string | boolean | null>) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = value === null ? query.is(key, null) : query.eq(key, value as string | boolean)
    }
  }
  const { count, error } = await query
  return { count: count ?? 0, error: toError(error) }
}
