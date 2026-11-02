import { supabase } from '../supabase'
import { toError } from './shared'

/**
 * Permanent deletes. Two rules apply to every one:
 *  1. `.select()` + a row check — RLS answers a forbidden delete with "success, 0 rows", which would otherwise look like it worked.
 *  2. Only the Main Admin may delete (enforced by RLS / the RPCs / the edge function; the UI also hides the buttons for others).
 */

/** Tables whose deletes are captured by the database into the trash (see migration 20260930000002) and can be restored. */
export type TrashTable = 'blog_posts' | 'leads' | 'careers' | 'case_studies' | 'applications' | 'team_profiles' | 'resources'
type Table = TrashTable

async function deleteOne(table: Table, id: string, what: string) {
  const { data, error, status } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error(`You don't have permission to delete this ${what}, or it was already removed.`) }
  return { error: null }
}

export const deleteBlogPost = (id: string) => deleteOne('blog_posts', id, 'post')
export const deleteLead = (id: string) => deleteOne('leads', id, 'lead')
export const deleteCaseStudy = (id: string) => deleteOne('case_studies', id, 'case study')

// Uploaded files (résumés, photos, resources) are deliberately NOT removed here: the row goes to the trash and its files
// stay until it is purged, so a restore brings back a complete record. trash.ts removes them when an item is purged.
export const deleteApplication = (id: string) => deleteOne('applications', id, 'application')

/** Deleting a role also deletes its applications (the database cascades and the trash keeps them with it). */
export const deleteCareer = (id: string) => deleteOne('careers', id, 'role')
export const deleteResourceRow = (id: string) => deleteOne('resources', id, 'file')
export const deleteTeamMember = (id: string) => deleteOne('team_profiles', id, 'team member')

export async function countCareerApplications(id: string) {
  const { count } = await supabase.from('applications').select('id', { count: 'exact', head: true }).eq('career_id', id)
  return count ?? 0
}

/** Projects keep history that blocks a plain delete; the RPC clears it and is Main-Admin-only. */
export async function deleteProject(id: string) {
  const { error, status } = await supabase.rpc('admin_delete_project', { p_project: id })
  return { error: toError(error, status) }
}

export async function deleteClientOrg(id: string) {
  const { error, status } = await supabase.rpc('admin_delete_client_org', { p_client: id })
  return { error: toError(error, status) }
}

// ─── accounts (the edge function owns auth.users) ───────────────────────────────────────────────────────────────────

export interface AccountDetails { email: string | null; last_sign_in_at: string | null; created_at: string; email_confirmed: boolean }

async function manageAccount<T>(action: 'details' | 'reset_password' | 'delete', userId: string, fallback: string): Promise<{ data: T | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke('manage-account', { body: { action, user_id: userId } })
  if (error || data?.error) return { data: null, error: new Error(data?.error ?? fallback) }
  return { data: data as T, error: null }
}

export const getAccountDetails = (userId: string) => manageAccount<AccountDetails>('details', userId, 'Could not load this account\'s sign-in details.')
export const resetAccountPassword = (userId: string) => manageAccount<{ temp_password: string }>('reset_password', userId, 'Could not reset this password right now.')
export const deleteAccount = (userId: string) => manageAccount<{ ok: true }>('delete', userId, 'Could not delete this account right now.')

/** A client organisation's portal login, if it has one. */
export async function getClientLogin(clientId: string) {
  const { data, error } = await supabase.from('client_users').select('user_id, client_code').eq('client_id', clientId).limit(1).maybeSingle()
  return { data: data as { user_id: string; client_code: string } | null, error: toError(error) }
}

/**
 * Deletes a client completely: every portal login, then the organisation. Their projects are NOT deleted — only the link
 * to this client — because the work belongs to the company. Delete the project separately if that is what's wanted.
 */
export async function deleteClient(clientId: string) {
  const { data: logins, error } = await supabase.from('client_users').select('user_id').eq('client_id', clientId)
  if (error) return { error: toError(error) }
  for (const login of logins ?? []) {
    const removed = await deleteAccount(login.user_id as string)
    if (removed.error) return { error: removed.error }
  }
  return deleteClientOrg(clientId)
}

// ─── many at once, and undo ─────────────────────────────────────────────────────────────────────────────────────────

const CHUNK = 100

/** Deletes several rows of one table. Stops at the first database error and says how many had already gone. */
export async function deleteMany(table: TrashTable, ids: string[]) {
  let removed = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error, status } = await supabase.from(table).delete().in('id', ids.slice(i, i + CHUNK)).select('id')
    if (error) return { removed, error: toError(error, status) }
    removed += data?.length ?? 0
  }
  if (removed === 0) return { removed, error: new Error('None of those could be deleted — you may not have permission, or they were already removed.') }
  return { removed, error: null }
}

/** "Undo": brings back the most recent trash copy of each of these rows. Allowed for the Main Admin, or whoever deleted them in the last 5 minutes. */
export async function restoreDeleted(table: TrashTable, ids: string[]) {
  const { data, error, status } = await supabase.rpc('restore_deleted', { p_table: table, p_ids: ids })
  return { restored: (data as number | null) ?? 0, error: toError(error, status) }
}
