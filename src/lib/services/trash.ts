import { supabase } from '../supabase'
import { toError } from './shared'

/** The trash: rows deleted from blog, leads, careers, case studies, team, applications and resources, kept for 30 days. Main Admin only. */

export interface TrashItem {
  id: string
  table_name: string
  row_id: string
  label: string
  deleted_at: string
  expires_at: string
  deleted_by: string | null
  deleted_by_name: string | null
  storage_refs: Array<{ bucket: string; path: string }>
}

export const TRASH_KINDS: Record<string, string> = {
  blog_posts: 'Blog post', leads: 'Lead', careers: 'Role', case_studies: 'Case study', team_profiles: 'Team member', applications: 'Application', resources: 'File',
}

export async function listTrash() {
  const { data, error } = await supabase.from('trash_items').select('id, table_name, row_id, label, deleted_at, expires_at, deleted_by, storage_refs').order('deleted_at', { ascending: false }).limit(500)
  if (error) return { data: [] as TrashItem[], error: toError(error) }
  const rows = (data ?? []) as Array<Omit<TrashItem, 'deleted_by_name'>>
  const ids = [...new Set(rows.map((r) => r.deleted_by).filter((v): v is string => Boolean(v)))]
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]))
  return { data: rows.map((r) => ({ ...r, deleted_by_name: r.deleted_by ? names.get(r.deleted_by) ?? null : null })), error: null }
}

export async function restoreTrashItems(ids: string[]) {
  const { data, error, status } = await supabase.rpc('restore_trash_items', { p_ids: ids })
  return { restored: (data as number | null) ?? 0, error: toError(error, status) }
}

/** Permanently removes items: their uploaded files first (best effort), then the trash rows. */
export async function purgeTrashItems(items: TrashItem[]) {
  if (items.length === 0) return { error: null }
  const byBucket = new Map<string, string[]>()
  for (const item of items) for (const ref of item.storage_refs ?? []) byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) ?? []), ref.path])
  await Promise.all([...byBucket].map(([bucket, paths]) => supabase.storage.from(bucket).remove(paths).catch(() => undefined)))
  const { error, status } = await supabase.from('trash_items').delete().in('id', items.map((i) => i.id))
  return { error: toError(error, status) }
}

/** Housekeeping when the Main Admin opens the trash: anything past its 30 days goes for good. */
export async function purgeExpiredTrash() {
  const { data } = await supabase.from('trash_items').select('id, table_name, row_id, label, deleted_at, expires_at, deleted_by, storage_refs').lt('expires_at', new Date().toISOString()).limit(200)
  const expired = ((data ?? []) as Array<Omit<TrashItem, 'deleted_by_name'>>).map((r) => ({ ...r, deleted_by_name: null }))
  return purgeTrashItems(expired)
}
