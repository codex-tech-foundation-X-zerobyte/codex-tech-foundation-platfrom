import { supabase } from '../supabase'
import { toError } from './shared'
import type { RecordLike } from '../../workspaces/records'

export interface DepartmentRecord extends RecordLike {
  id: string
  department_id: string
  title: string
  fields: Record<string, unknown>
  assignee_id: string | null
  assignee_name: string | null
  project_id: string | null
  due_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface NewRecord { department_id: string; kind: string; title: string; stage: string; fields: Record<string, unknown>; assignee_id?: string | null; due_date?: string | null }

/** Records of one kind in a department. Row-level security limits them to the viewer's own department (or a Main Admin). */
export async function listRecords(departmentId: string, kind: string) {
  const { data, error } = await supabase.from('department_records').select('*').eq('department_id', departmentId).eq('kind', kind).order('created_at', { ascending: false }).limit(500)
  if (error) return { data: [] as DepartmentRecord[], error: toError(error) }
  const ids = Array.from(new Set((data ?? []).map((r) => r.assignee_id).filter(Boolean) as string[]))
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((r) => ({ ...r, assignee_name: r.assignee_id ? names.get(r.assignee_id) || 'Unnamed' : null })) as DepartmentRecord[], error: null }
}

export async function createRecord(input: NewRecord) {
  const { error, status } = await supabase.from('department_records').insert({ ...input, title: input.title.trim() })
  return { error: error ? toError(error, status) : null }
}

export async function updateRecord(id: string, patch: Partial<Pick<NewRecord, 'title' | 'stage' | 'fields' | 'assignee_id' | 'due_date'>>) {
  // .select() so an update that row-level security filtered to zero rows is reported, not mistaken for success.
  const { data, error, status } = await supabase.from('department_records').update(patch).eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this.") }
  return { error: null }
}

export async function deleteRecord(id: string) {
  const { data, error, status } = await supabase.from('department_records').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only a Department Admin can delete this.') }
  return { error: null }
}
