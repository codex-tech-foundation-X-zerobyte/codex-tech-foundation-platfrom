import { supabase } from '../supabase'
import { toError } from './shared'

export interface Announcement {
  id: string
  department_id: string | null
  title: string
  body: string
  pinned: boolean
  author_id: string
  author_name: string
  created_at: string
}

export const ANNOUNCEMENT_TITLE_MAX = 140
export const ANNOUNCEMENT_BODY_MAX = 5000

/** Pinned first, then newest. Visibility (company-wide vs your department) is decided by row-level security. */
export async function listAnnouncements(limit = 20) {
  const { data, error } = await supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) return { data: [] as Announcement[], error: toError(error) }
  const ids = Array.from(new Set((data ?? []).map((a) => a.author_id)))
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((a) => ({ ...a, author_name: names.get(a.author_id) || 'Codex' })) as Announcement[], error: null }
}

export async function createAnnouncement(input: { title: string; body: string; departmentId: string | null; pinned: boolean }) {
  const title = input.title.trim()
  if (!title) return { error: new Error('Give the announcement a title.') }
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return { error: new Error(`Keep the title under ${ANNOUNCEMENT_TITLE_MAX} characters.`) }
  if (input.body.length > ANNOUNCEMENT_BODY_MAX) return { error: new Error(`Keep the message under ${ANNOUNCEMENT_BODY_MAX} characters.`) }
  const { error, status } = await supabase.from('announcements').insert({ title, body: input.body.trim(), department_id: input.departmentId, pinned: input.pinned })
  return { error: error ? toError(error, status) : null }
}

export async function deleteAnnouncement(id: string) {
  const { data, error, status } = await supabase.from('announcements').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to remove this announcement.") }
  return { error: null }
}
