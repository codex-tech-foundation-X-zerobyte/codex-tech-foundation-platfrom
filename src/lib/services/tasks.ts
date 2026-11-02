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
  // .select() so a row RLS silently filtered out (0 rows, no error) is reported rather than looking like success.
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('id')
  if (!error && (data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this task.") }
  return { error: toError(error) }
}

export async function createTask(input: Pick<Task, 'project_id' | 'title' | 'description' | 'priority' | 'due_date' | 'assignee_id'>) {
  const { data, error } = await supabase.from('tasks').insert(input).select('*').single()
  return { data: data as Task | null, error: toError(error) }
}

/** A department task's status follows its position in the department's workflow: first stage = to do, last = done, otherwise in progress. */
export function stageStatus(stages: string[], stage: string): TaskStatus {
  const i = stages.indexOf(stage)
  if (i <= 0) return 'todo'
  return i === stages.length - 1 ? 'done' : 'in_progress'
}

/** Tasks for one department. Row-level security limits what the viewer actually receives. */
export async function listDepartmentTasks(departmentId: string) {
  const { data, error } = await supabase.from('tasks').select('*').eq('department_id', departmentId).order('created_at', { ascending: false })
  if (error) return { data: [] as DepartmentTask[], error: toError(error) }
  const projectIds = Array.from(new Set((data ?? []).map((t) => t.project_id)))
  const assigneeIds = Array.from(new Set((data ?? []).map((t) => t.assignee_id).filter(Boolean) as string[]))
  const [projects, people] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id, name').in('id', projectIds) : Promise.resolve({ data: [] }),
    assigneeIds.length ? supabase.from('profiles').select('id, display_name').in('id', assigneeIds) : Promise.resolve({ data: [] }),
  ])
  const pn = new Map((projects.data ?? []).map((p) => [p.id, p.name]))
  const an = new Map((people.data ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((t) => ({ ...t, project_name: pn.get(t.project_id) ?? '', assignee_name: t.assignee_id ? an.get(t.assignee_id) || 'Unnamed' : null })) as DepartmentTask[], error: null }
}

export interface DepartmentTask extends Task { project_name: string; assignee_name: string | null }

export interface NewDepartmentTask {
  project_id: string
  department_id: string
  title: string
  description: string
  priority: Task['priority']
  due_date: string | null
  assignee_id: string | null
  stage: string
}

/** Department Admin breaks an accepted assignment into a task. The database checks the assignment is accepted and the assignee is in the department. */
export async function createDepartmentTask(input: NewDepartmentTask) {
  if (!input.title.trim()) return { error: new Error('Give the task a title.') }
  const { error, status } = await supabase.from('tasks').insert({ ...input, title: input.title.trim(), description: input.description.trim(), status: 'todo' })
  return { error: error ? toError(error, status) : null }
}

/** Move a department task to another stage of its workflow, keeping its status in step. */
export async function moveTaskToStage(taskId: string, stages: string[], stage: string) {
  const status = stageStatus(stages, stage)
  const patch: Record<string, unknown> = { stage, status, completed_at: status === 'done' ? new Date().toISOString() : null }
  const { data, error, status: http } = await supabase.from('tasks').update(patch).eq('id', taskId).select('id')
  if (error) return { error: toError(error, http) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to move this task.") }
  return { error: null }
}
