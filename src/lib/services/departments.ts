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
  const [depts, members, workers] = await Promise.all([
    supabase.from('departments').select(DEPARTMENT_COLUMNS).order('name'),
    supabase.from('worker_departments').select('user_id, department_id, department_role'),
    supabase.from('worker_profiles').select('user_id'),
  ])
  const error = depts.error ?? members.error ?? workers.error
  if (error) return { data: { departments: [] as DepartmentSummary[], unassigned: 0 }, error: toError(error) }

  const adminIds = [...new Set((members.data ?? []).filter((w) => w.department_role === 'admin').map((w) => w.user_id))]
  const { data: adminProfiles } = adminIds.length ? await supabase.from('profiles').select('id, display_name').in('id', adminIds) : { data: [] }
  const names = new Map((adminProfiles ?? []).map((p) => [p.id, p.display_name || 'Unnamed']))

  // A worker can belong to several departments, so they count once in EACH; "unassigned" means in none.
  const counts = new Map<string, number>()
  const admins = new Map<string, string[]>()
  for (const w of members.data ?? []) {
    counts.set(w.department_id, (counts.get(w.department_id) ?? 0) + 1)
    if (w.department_role === 'admin') admins.set(w.department_id, [...(admins.get(w.department_id) ?? []), names.get(w.user_id) ?? 'Unnamed'])
  }
  const placed = new Set((members.data ?? []).map((m) => m.user_id))
  const unassigned = (workers.data ?? []).filter((w) => !placed.has(w.user_id)).length
  const departments = (depts.data ?? []).map((d) => ({ ...(d as DepartmentRow), workerCount: counts.get(d.id) ?? 0, admins: admins.get(d.id) ?? [] }))
  return { data: { departments, unassigned }, error: null }
}

export async function getDepartmentBySlug(slug: string) {
  const { data, error } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).eq('slug', slug).maybeSingle()
  return { data: (data as DepartmentRow | null) ?? null, error: error ? toError(error) : null }
}

/** The signed-in worker's PRIMARY department and their role in it. Kept for screens that need one; use getMyDepartments for all of them. */
export async function getMyDepartment(userId: string) {
  const { data: wp, error } = await supabase.from('worker_profiles').select('department_id, department_role').eq('user_id', userId).maybeSingle()
  if (error) return { data: null, error: toError(error) }
  if (!wp?.department_id) return { data: { department: null, role: (wp?.department_role ?? 'member') as DepartmentRole }, error: null }
  const { data: dept, error: deptError } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).eq('id', wp.department_id).maybeSingle()
  if (deptError) return { data: null, error: toError(deptError) }
  return { data: { department: (dept as DepartmentRow | null) ?? null, role: wp.department_role as DepartmentRole }, error: null }
}

export interface MyDepartment { department: DepartmentRow; role: DepartmentRole; isPrimary: boolean }

/** Every department a worker belongs to, primary first, with their role in each. */
export async function getMyDepartments(userId: string) {
  const { data: rows, error } = await supabase.from('worker_departments').select('department_id, department_role, is_primary').eq('user_id', userId)
  if (error) return { data: [] as MyDepartment[], error: toError(error) }
  const ids = (rows ?? []).map((r) => r.department_id)
  if (ids.length === 0) return { data: [] as MyDepartment[], error: null }
  const { data: depts, error: deptError } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).in('id', ids)
  if (deptError) return { data: [] as MyDepartment[], error: toError(deptError) }
  const byId = new Map((depts ?? []).map((d) => [d.id, d as DepartmentRow]))
  const list = (rows ?? []).flatMap((r) => { const department = byId.get(r.department_id); return department ? [{ department, role: r.department_role as DepartmentRole, isPrimary: r.is_primary }] : [] })
  list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.department.name.localeCompare(b.department.name))
  return { data: list, error: null }
}

/** Pure helper: is this person an admin of that department? (A department-admin of one department is just a member of another.) */
export const isAdminOf = (mine: MyDepartment[], departmentId: string | null | undefined) => !!departmentId && mine.some((m) => m.department.id === departmentId && m.role === 'admin')

export interface Membership { department_id: string; department_role: DepartmentRole; is_primary: boolean }

/** Every worker's memberships at once, keyed by worker: lets list screens show all of a person's departments. */
export async function listMembershipsByWorker() {
  const { data, error } = await supabase.from('worker_departments').select('user_id, department_id, department_role, is_primary')
  if (error) return { data: new Map<string, Membership[]>(), error: toError(error) }
  const map = new Map<string, Membership[]>()
  for (const r of data ?? []) map.set(r.user_id, [...(map.get(r.user_id) ?? []), { department_id: r.department_id, department_role: r.department_role as DepartmentRole, is_primary: r.is_primary }])
  return { data: map, error: null }
}

/** Workers currently in one department (or, with `null`, those in none). Department Admins sort first. */
export async function listDepartmentMembers(departmentId: string | null) {
  let roles = new Map<string, DepartmentRole>()
  let ids: string[]
  if (departmentId) {
    const { data, error } = await supabase.from('worker_departments').select('user_id, department_role').eq('department_id', departmentId)
    if (error) return { data: [] as DepartmentMember[], error: toError(error) }
    roles = new Map((data ?? []).map((r) => [r.user_id, r.department_role as DepartmentRole]))
    ids = [...roles.keys()]
  } else {
    const [{ data: all, error }, { data: placed }] = await Promise.all([supabase.from('worker_profiles').select('user_id'), supabase.from('worker_departments').select('user_id')])
    if (error) return { data: [] as DepartmentMember[], error: toError(error) }
    const inSome = new Set((placed ?? []).map((r) => r.user_id))
    ids = (all ?? []).map((r) => r.user_id).filter((id) => !inSome.has(id))
  }
  if (ids.length === 0) return { data: [] as DepartmentMember[], error: null }
  const [{ data: wps, error: wpError }, { data: profiles }] = await Promise.all([
    supabase.from('worker_profiles').select('user_id, position, status').in('user_id', ids),
    supabase.from('profiles').select('id, display_name').in('id', ids),
  ])
  if (wpError) return { data: [] as DepartmentMember[], error: toError(wpError) }
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))
  const members = (wps ?? []).map((r) => ({ ...r, department_role: roles.get(r.user_id) ?? 'member', display_name: names.get(r.user_id) || 'Unnamed worker' })) as DepartmentMember[]
  members.sort((a, b) => (a.department_role === b.department_role ? a.display_name.localeCompare(b.display_name) : a.department_role === 'admin' ? -1 : 1))
  return { data: members, error: null }
}

export interface DepartmentPlacement { department_id: string; role: DepartmentRole; primary?: boolean }

/** Replaces a worker's departments in one atomic step (Main Admin only; the database enforces it). */
export async function setWorkerDepartments(userId: string, placements: DepartmentPlacement[]) {
  const { error, status } = await supabase.rpc('set_worker_departments', { p_user: userId, p_departments: placements })
  return { error: error ? toError(error, status) : null }
}

async function currentPlacements(userId: string) {
  const { data, error } = await supabase.from('worker_departments').select('department_id, department_role, is_primary').eq('user_id', userId)
  if (error) return { data: null, error: toError(error) }
  return { data: (data ?? []).map((r) => ({ department_id: r.department_id, role: r.department_role as DepartmentRole, primary: r.is_primary })), error: null }
}

/** Adds the worker to one more department, keeping all their others. */
export async function addWorkerToDepartment(userId: string, departmentId: string, role: DepartmentRole = 'member') {
  const cur = await currentPlacements(userId)
  if (cur.error || !cur.data) return { error: cur.error }
  if (cur.data.some((p) => p.department_id === departmentId)) return { error: null }
  return setWorkerDepartments(userId, [...cur.data, { department_id: departmentId, role, primary: cur.data.length === 0 }])
}

/** Takes the worker out of ONE department, keeping the rest. */
export async function removeWorkerFromDepartment(userId: string, departmentId: string) {
  const cur = await currentPlacements(userId)
  if (cur.error || !cur.data) return { error: cur.error }
  return setWorkerDepartments(userId, cur.data.filter((p) => p.department_id !== departmentId))
}

/** Moves a worker out of one department and into another (their other departments are untouched). A plain member in the new one. */
export async function moveWorkerDepartment(userId: string, fromId: string, toId: string | null) {
  const cur = await currentPlacements(userId)
  if (cur.error || !cur.data) return { error: cur.error }
  const wasPrimary = cur.data.find((p) => p.department_id === fromId)?.primary ?? false
  const rest = cur.data.filter((p) => p.department_id !== fromId && p.department_id !== toId)
  const kept = toId ? (cur.data.find((p) => p.department_id === toId) ?? { department_id: toId, role: 'member' as const, primary: false }) : null
  const next = [...rest, ...(kept ? [{ ...kept, primary: kept.primary || wasPrimary }] : [])]
  return setWorkerDepartments(userId, next)
}

/** Makes someone a Department Admin of one department (or a plain member again) without touching their other departments. */
export async function setDepartmentAdminIn(userId: string, departmentId: string, isAdmin: boolean) {
  const cur = await currentPlacements(userId)
  if (cur.error || !cur.data) return { error: cur.error }
  if (!cur.data.some((p) => p.department_id === departmentId)) return { error: new Error('That worker is not in this department.') }
  return setWorkerDepartments(userId, cur.data.map((p) => (p.department_id === departmentId ? { ...p, role: isAdmin ? 'admin' as const : 'member' as const } : p)))
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
