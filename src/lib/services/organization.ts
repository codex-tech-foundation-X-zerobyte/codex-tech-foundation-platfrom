import { supabase } from '../supabase'
import { toError } from './shared'
import type { DepartmentRow } from './departments'

export interface OrgPerson { id: string; name: string; position: string; status: string }
export interface OrgDepartment { row: DepartmentRow; admins: OrgPerson[]; members: OrgPerson[] }
export interface Organization {
  leaders: { id: string; name: string }[]
  departments: OrgDepartment[]
  unassigned: OrgPerson[]
}

/** Who is who: Main Admins, each department with its Department Admins and members, and anyone not yet placed. */
export async function listOrganization() {
  const empty: Organization = { leaders: [], departments: [], unassigned: [] }
  const [depts, workers, memberships, leaders] = await Promise.all([
    supabase.from('departments').select('id, name, slug, is_system, created_at').order('name'),
    supabase.from('worker_profiles').select('user_id, position, status'),
    supabase.from('worker_departments').select('user_id, department_id, department_role'),
    supabase.from('profiles').select('id, display_name').eq('role', 'superadmin'),
  ])
  const error = depts.error ?? workers.error ?? memberships.error ?? leaders.error
  if (error) return { data: empty, error: toError(error) }
  const ids = (workers.data ?? []).map((w) => w.user_id)
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))
  const person = (w: { user_id: string; position: string; status: string }): OrgPerson => ({ id: w.user_id, name: names.get(w.user_id) || 'Unnamed worker', position: w.position ?? '', status: w.status })
  const byName = (a: OrgPerson, b: OrgPerson) => a.name.localeCompare(b.name)

  // A worker in several departments appears in each of them; "unassigned" means in none.
  const byId = new Map((workers.data ?? []).map((w) => [w.user_id, w]))
  const departments = (depts.data ?? []).map((row) => {
    const here = (memberships.data ?? []).filter((m) => m.department_id === row.id).flatMap((m) => { const w = byId.get(m.user_id); return w ? [{ ...w, department_role: m.department_role }] : [] })
    return {
      row: row as DepartmentRow,
      admins: here.filter((w) => w.department_role === 'admin').map(person).sort(byName),
      members: here.filter((w) => w.department_role !== 'admin').map(person).sort(byName),
    }
  })
  const placed = new Set((memberships.data ?? []).map((m) => m.user_id))
  const unassigned = (workers.data ?? []).filter((w) => !placed.has(w.user_id)).map(person).sort(byName)
  return { data: { leaders: (leaders.data ?? []).map((l) => ({ id: l.id, name: l.display_name || 'Main Admin' })), departments, unassigned }, error: null }
}
