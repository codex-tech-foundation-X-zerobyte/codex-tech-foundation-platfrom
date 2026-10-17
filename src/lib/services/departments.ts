import { supabase } from '../supabase'
import { toError } from './shared'

/*
  Departments are PRE-PROVISIONED by migration 20260926000000 and described by src/workspaces/definitions.ts.
  This service therefore only reads them and assigns people to them. There is deliberately no create / rename / delete:
  the Main Admin assigns workers and projects to departments, they do not build the company's departments.
*/

export type DepartmentRole = 'member' | 'admin'

export interface DepartmentRow {
  id: string
  name: string
  /** Matches a definition in src/workspaces/definitions.ts. Null for a legacy department an admin made by hand. */
  slug: string | null
  is_system: boolean
  created_at: string
}

export interface DepartmentSummary extends DepartmentRow {
  workerCount: number
  admins: string[]
}

export interface DepartmentMember {
  user_id: string
  display_name: string
  position: string
  status: string
  department_role: DepartmentRole
}

const DEPARTMENT_COLUMNS = 'id, name, slug, is_system, created_at'

/** Every department with its head-count and Department Admins, plus how many workers have no department. */
export async function listDepartmentSummaries() {
  const [depts, workers] = await Promise.all([
    supabase.from('departments').select(DEPARTMENT_COLUMNS).order('name'),
    supabase.from('worker_profiles').select('user_id, department_id, department_role'),
  ])
  const error = depts.error ?? workers.error
  if (error) return { data: { departments: [] as DepartmentSummary[], unassigned: 0 }, error: toError(error) }

  const adminIds = (workers.data ?? []).filter((w) => w.department_role === 'admin').map((w) => w.user_id)
  const { data: adminProfiles } = adminIds.length ? await supabase.from('profiles').select('id, display_name').in('id', adminIds) : { data: [] }
  const names = new Map((adminProfiles ?? []).map((p) => [p.id, p.display_name || 'Unnamed']))

  const counts = new Map<string, number>()
  const admins = new Map<string, string[]>()
  let unassigned = 0
  for (const w of workers.data ?? []) {
    if (!w.department_id) { unassigned += 1; continue }
    counts.set(w.department_id, (counts.get(w.department_id) ?? 0) + 1)
    if (w.department_role === 'admin') admins.set(w.department_id, [...(admins.get(w.department_id) ?? []), names.get(w.user_id) ?? 'Unnamed'])
  }
  const departments = (depts.data ?? []).map((d) => ({ ...(d as DepartmentRow), workerCount: counts.get(d.id) ?? 0, admins: admins.get(d.id) ?? [] }))
  return { data: { departments, unassigned }, error: null }
}

export async function getDepartmentBySlug(slug: string) {
  const { data, error } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).eq('slug', slug).maybeSingle()
  return { data: (data as DepartmentRow | null) ?? null, error: error ? toError(error) : null }
}

/** The signed-in worker's own department and their role in it. */
export async function getMyDepartment(userId: string) {
  const { data: wp, error } = await supabase.from('worker_profiles').select('department_id, department_role').eq('user_id', userId).maybeSingle()
  if (error) return { data: null, error: toError(error) }
  if (!wp?.department_id) return { data: { department: null, role: (wp?.department_role ?? 'member') as DepartmentRole }, error: null }
  const { data: dept, error: deptError } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).eq('id', wp.department_id).maybeSingle()
  if (deptError) return { data: null, error: toError(deptError) }
  return { data: { department: (dept as DepartmentRow | null) ?? null, role: wp.department_role as DepartmentRole }, error: null }
}

/** Workers currently in one department (or, with `null`, those in none). Department Admins sort first. */
export async function listDepartmentMembers(departmentId: string | null) {
  const query = supabase.from('worker_profiles').select('user_id, position, status, department_role')
  const { data: rows, error } = await (departmentId ? query.eq('department_id', departmentId) : query.is('department_id', null))
  if (error) return { data: [] as DepartmentMember[], error: toError(error) }
  const ids = (rows ?? []).map((r) => r.user_id)
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))
  const members = (rows ?? []).map((r) => ({ ...r, display_name: names.get(r.user_id) || 'Unnamed worker' })) as DepartmentMember[]
  members.sort((a, b) => (a.department_role === b.department_role ? a.display_name.localeCompare(b.display_name) : a.department_role === 'admin' ? -1 : 1))
  return { data: members, error: null }
}

export async function setWorkerDepartment(userId: string, departmentId: string | null) {
  // .select() so an update that RLS filtered to zero rows is reported instead of looking like success.
  const { data, error, status } = await supabase.from('worker_profiles').update({ department_id: departmentId }).eq('user_id', userId).select('user_id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to move this worker.") }
  return { error: null }
}

/** Only a Main Admin may do this; the database enforces it (guard_department_role trigger), not just this UI. */
export async function setDepartmentAdmin(userId: string, isAdmin: boolean) {
  const { data, error, status } = await supabase.from('worker_profiles').update({ department_role: isAdmin ? 'admin' : 'member' }).eq('user_id', userId).select('user_id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this role.") }
  return { error: null }
}
