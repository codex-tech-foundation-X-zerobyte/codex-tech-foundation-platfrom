import { supabase } from '../supabase'
import type { Project } from '../types'
import { toError } from './shared'
import { createProject, type CreateProjectInput } from './projects'

export type AssignmentStatus = 'assigned' | 'accepted' | 'in_review' | 'changes_requested' | 'completed'

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  assigned: 'Awaiting acceptance',
  accepted: 'In progress',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  completed: 'Completed',
}

export interface ProjectAssignment {
  id: string
  project_id: string
  project_name: string
  department_id: string
  objective: string
  deliverables: string[]
  deadline: string | null
  status: AssignmentStatus
  accepted_at: string | null
  created_at: string
}

export interface DepartmentBrief { departmentId: string; objective: string; deliverables: string[]; deadline: string | null }

/** Assignments for one department. Row-level security decides what the viewer may see; nothing is filtered here for access. */
export async function listDepartmentAssignments(departmentId: string) {
  const { data, error } = await supabase.from('project_departments').select('*').eq('department_id', departmentId).order('created_at', { ascending: false })
  if (error) return { data: [] as ProjectAssignment[], error: toError(error) }
  const ids = Array.from(new Set((data ?? []).map((a) => a.project_id)))
  const { data: projects } = ids.length ? await supabase.from('projects').select('id, name').in('id', ids) : { data: [] }
  const names = new Map((projects ?? []).map((p) => [p.id, p.name]))
  return { data: (data ?? []).map((a) => ({ ...a, project_name: names.get(a.project_id) ?? 'Unknown project' })) as ProjectAssignment[], error: null }
}

export interface DistributeResult { project: Project | null; error: Error | null; assigned: string[] }

/**
 * Main Admin: create ONE project and hand it to several departments. There is no multi-statement transaction from the
 * browser, so if the assignments fail the project is removed again rather than left half-distributed.
 */
export async function distributeProject(input: CreateProjectInput, briefs: DepartmentBrief[]): Promise<DistributeResult> {
  if (briefs.length === 0) return { project: null, error: new Error('Choose at least one department.'), assigned: [] }
  const { data: project, error } = await createProject(input)
  if (error || !project) return { project: null, error: error ?? new Error('Could not create the project.'), assigned: [] }

  const { data: { user } } = await supabase.auth.getUser()
  const { error: assignError } = await supabase.from('project_departments').insert(
    briefs.map((b) => ({
      project_id: project.id,
      department_id: b.departmentId,
      objective: b.objective.trim(),
      deliverables: b.deliverables.map((d) => d.trim()).filter(Boolean),
      deadline: b.deadline || null,
      assigned_by: user?.id ?? null,
    })),
  )
  if (assignError) {
    await supabase.from('projects').delete().eq('id', project.id)
    return { project: null, error: new Error(`The project wasn't created because it couldn't be assigned to the departments: ${assignError.message}`), assigned: [] }
  }
  return { project, error: null, assigned: briefs.map((b) => b.departmentId) }
}

/** Department Admin accepts, submits for review, or (Main Admin) requests changes / completes. The database enforces who may. */
export async function setAssignmentStatus(id: string, status: AssignmentStatus) {
  const { data, error, status: http } = await supabase.from('project_departments').update({ status }).eq('id', id).select('id')
  if (error) return { error: toError(error, http) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this assignment.") }
  return { error: null }
}

export interface Deadline { kind: 'project' | 'task'; id: string; label: string; context: string; date: string }

/** The viewer's upcoming deadlines (assignments and tasks), nearest first. Only what row-level security lets them see. */
export async function listUpcomingDeadlines(limit = 8) {
  const [assignments, tasks] = await Promise.all([
    supabase.from('project_departments').select('id, project_id, department_id, objective, deadline').neq('status', 'completed').not('deadline', 'is', null).order('deadline').limit(limit),
    supabase.from('tasks').select('id, title, due_date, project_id, department_id').neq('status', 'done').not('due_date', 'is', null).order('due_date').limit(limit),
  ])
  const error = assignments.error ?? tasks.error
  if (error) return { data: [] as Deadline[], error: toError(error) }
  const projectIds = Array.from(new Set([...(assignments.data ?? []).map((a) => a.project_id), ...(tasks.data ?? []).map((t) => t.project_id)]))
  const departmentIds = Array.from(new Set((assignments.data ?? []).map((a) => a.department_id)))
  const [projects, departments] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id, name').in('id', projectIds) : Promise.resolve({ data: [] }),
    departmentIds.length ? supabase.from('departments').select('id, name').in('id', departmentIds) : Promise.resolve({ data: [] }),
  ])
  const pn = new Map((projects.data ?? []).map((p) => [p.id, p.name]))
  const dn = new Map((departments.data ?? []).map((d) => [d.id, d.name]))
  const items: Deadline[] = [
    ...(assignments.data ?? []).map((a) => ({ kind: 'project' as const, id: a.id, label: pn.get(a.project_id) ?? 'Project', context: `${dn.get(a.department_id) ?? 'Department'}: ${a.objective}`, date: a.deadline as string })),
    ...(tasks.data ?? []).map((t) => ({ kind: 'task' as const, id: t.id, label: t.title, context: pn.get(t.project_id) ?? '', date: t.due_date as string })),
  ]
  // The queries already exclude undated rows; this keeps one malformed row from breaking the whole list.
  const dated = items.filter((i) => !!i.date)
  dated.sort((a, b) => a.date.localeCompare(b.date))
  return { data: dated.slice(0, limit), error: null }
}
