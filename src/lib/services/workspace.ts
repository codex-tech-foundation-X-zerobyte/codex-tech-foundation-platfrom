import { supabase } from '../supabase'
import type { Notification, ProjectRequest } from '../types'
import { toError } from './shared'

export async function listNotifications() {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
  return { data: (data ?? []) as Notification[], error: toError(error) }
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
=======
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
export async function getUnreadNotificationCount() {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  return { count: count ?? 0, error: toError(error) }
}

<<<<<<< HEAD
=======
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
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

<<<<<<< HEAD
/** Simple counts used by dashboards. Each is a real, permission-scoped Supabase query — never mocked.
 *  idColumn defaults to 'id', which is every table's PK except worker_profiles (PK is user_id, since
 *  it's a 1:1 extension of profiles) — this generic default previously broke that one table's count
 *  with a real PostgREST 400 ("column worker_profiles.id does not exist"), not a live-database issue. */
export async function countRows(table: string, filters?: Record<string, string | boolean | null>, idColumn = 'id') {
  let query = supabase.from(table).select(idColumn, { count: 'exact', head: true })
=======
/** Simple counts used by dashboards. Each is a real, permission-scoped Supabase query — never mocked. */
export async function countRows(table: string, filters?: Record<string, string | boolean | null>) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = value === null ? query.is(key, null) : query.eq(key, value as string | boolean)
    }
  }
  const { count, error } = await query
  return { count: count ?? 0, error: toError(error) }
}
