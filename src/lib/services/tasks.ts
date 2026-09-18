import { supabase } from '../supabase'
import type { Task, TaskStatus } from '../types'
import { toError } from './shared'

export async function listTasks(filters?: { projectId?: string; assigneeId?: string }) {
  let query = supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false })
  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  if (filters?.assigneeId) query = query.eq('assignee_id', filters.assigneeId)
  const { data, error } = await query
  return { data: (data ?? []) as Task[], error: toError(error) }
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  const patch: Record<string, unknown> = { status }
  if (status === 'done') patch.completed_at = new Date().toISOString()
  const { error } = await supabase.from('tasks').update(patch).eq('id', id)
  return { error: toError(error) }
}

export async function createTask(input: Pick<Task, 'project_id' | 'title' | 'description' | 'priority' | 'due_date' | 'assignee_id'>) {
  const { data, error } = await supabase.from('tasks').insert(input).select('*').single()
  return { data: data as Task | null, error: toError(error) }
}
