import { supabase } from '../supabase'
import type { WorkerProfile } from '../types'
import { toError } from './shared'
export interface WorkerRow extends WorkerProfile {
  display_name: string
}

export async function listWorkers() {
  const { data: workers, error } = await supabase.from('worker_profiles').select('*').order('join_date', { ascending: false })
  if (error) return { data: [] as WorkerRow[], error: toError(error) }

  const userIds = (workers ?? []).map((w) => w.user_id)
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
    : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

  const rows = (workers ?? []).map((w) => ({ ...w, display_name: nameById.get(w.user_id) ?? 'Unnamed worker' }))
  return { data: rows as WorkerRow[], error: null }
}

export const WORKER_STATUSES: WorkerProfile['status'][] = ['active', 'suspended', 'banned', 'inactive']

export async function updateWorkerStatus(userId: string, status: WorkerProfile['status']) {
  // Validate before the round trip: the database has a CHECK on this column, and a bad value would come back as an opaque 400.
  if (!WORKER_STATUSES.includes(status)) return { error: new Error(`"${status}" is not a valid worker status.`) }
  // .select() so an update that RLS silently filtered to 0 rows is reported as a permission problem instead of looking like success.
  const { data, error, status: http } = await supabase.from('worker_profiles').update({ status }).eq('user_id', userId).select('user_id')
  if (error) return { error: toError(error, http) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this worker's status.") }
  return { error: null }
}

export async function getWorkerById(userId: string) {
  const { data: worker, error } = await supabase.from('worker_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error || !worker) return { data: null, error: toError(error) }
  const { data: profile } = await supabase.from('profiles').select('display_name, organization').eq('id', userId).maybeSingle()
  return { data: { ...worker, display_name: profile?.display_name ?? 'Unnamed worker' } as WorkerRow, error: null }
}

export interface CreateWorkerInput {
  name: string
  email: string
  phone?: string
  position?: string
  department_id?: string
  /** Make the new worker their department's admin. Requires a department. Main Admin only. */
  department_role?: 'member' | 'admin'
  role?: 'worker' | 'manager'
}

export interface CreateWorkerResult {
  worker_id: string
  temp_password: string
  user_id: string
}

/** Calls the create-worker edge function. The caller's session is attached automatically by supabase-js. */
export async function createWorker(input: CreateWorkerInput) {
  const { data, error } = await supabase.functions.invoke('create-worker', { body: input })
  if (error || data?.error) {
    return { data: null, error: new Error(data?.error ?? 'Unable to create this worker account right now.') }
  }
  return { data: data as CreateWorkerResult, error: null }
}

// ─── the richer worker view ─────────────────────────────────────────────────────────────────────────────────────────

export interface WorkerOverview {
  /** Account type from profiles: a plain worker or a manager. */
  role: string
  taskCounts: { total: number; todo: number; in_progress: number; blocked: number; done: number; overdue: number }
  /** Unfinished tasks, most urgent first (earliest due date; undated last). */
  openTasks: Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; project_id: string; project_name: string }>
  projects: Array<{ id: string; name: string; status: string }>
  activity: Array<{ id: string; action: string; resource_type: string; severity: string; created_at: string }>
}

/** Everything an admin wants to know about a worker at a glance. Every query is RLS-scoped, so a viewer only sees what they are allowed to. */
export async function getWorkerOverview(userId: string) {
  const [profile, tasks, memberships, activity] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    supabase.from('tasks').select('id, title, status, priority, due_date, project_id').eq('assignee_id', userId).limit(500),
    supabase.from('project_members').select('project_id').eq('user_id', userId),
    supabase.from('audit_logs').select('id, action, resource_type, severity, created_at').eq('actor_user_id', userId).order('created_at', { ascending: false }).limit(10),
  ])
  const firstError = tasks.error ?? memberships.error ?? profile.error
  if (firstError) return { data: null as WorkerOverview | null, error: toError(firstError) }

  const projectIds = [...new Set([...(memberships.data ?? []).map((m) => m.project_id as string), ...(tasks.data ?? []).map((t) => t.project_id as string)])]
  const { data: projectRows } = projectIds.length ? await supabase.from('projects').select('id, name, status').in('id', projectIds) : { data: [] }
  const projectById = new Map((projectRows ?? []).map((p) => [p.id as string, p]))

  const today = new Date().toISOString().slice(0, 10)
  const all = tasks.data ?? []
  const open = all.filter((t) => t.status !== 'done')
  const count = (s: string) => all.filter((t) => t.status === s).length

  const openTasks = open
    .map((t) => ({ ...t, project_name: (projectById.get(t.project_id as string)?.name as string | undefined) ?? 'Project' }))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, 8) as WorkerOverview['openTasks']

  return {
    data: {
      role: (profile.data?.role as string | undefined) ?? 'worker',
      taskCounts: { total: all.length, todo: count('todo'), in_progress: count('in_progress'), blocked: count('blocked'), done: count('done'), overdue: open.filter((t) => t.due_date && (t.due_date as string) < today).length },
      openTasks,
      projects: (memberships.data ?? []).map((m) => projectById.get(m.project_id as string)).filter(Boolean) as WorkerOverview['projects'],
      activity: (activity.data ?? []) as WorkerOverview['activity'],
    } as WorkerOverview,
    error: null,
  }
}

export interface WorkerDetailsPatch { position: string; phone: string; bio: string; skills: string[] }

/** Admin edit of the facts on a worker's card. `.select()` so a blocked update is reported rather than looking saved. */
export async function updateWorkerDetails(userId: string, patch: WorkerDetailsPatch) {
  const clean = {
    position: patch.position.trim().slice(0, 120),
    phone: patch.phone.trim().slice(0, 40) || null,
    bio: patch.bio.trim().slice(0, 2000),
    skills: [...new Set(patch.skills.map((s) => s.trim()).filter(Boolean))].slice(0, 30),
  }
  const { data, error, status } = await supabase.from('worker_profiles').update(clean).eq('user_id', userId).select('user_id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to edit this worker.") }
  return { error: null }
}
