import { supabase } from '../supabase'
import { toError } from './shared'

export interface RoleRow { id: string; name: string; description: string }
export interface PermissionRow { id: string; key: string; description: string }

export async function listRoles() {
  const { data, error } = await supabase.from('roles').select('*').order('name')
  return { data: (data ?? []) as RoleRow[], error: toError(error) }
}

export async function listPermissions() {
  const { data, error } = await supabase.from('permissions').select('*').order('key')
  return { data: (data ?? []) as PermissionRow[], error: toError(error) }
}

export async function listRolePermissions() {
  const { data, error } = await supabase.from('role_permissions').select('role_id, permission_id')
  return { data: (data ?? []) as { role_id: string; permission_id: string }[], error: toError(error) }
}

export async function createRole(input: { name: string; description?: string }) {
  const { data, error } = await supabase.from('roles').insert(input).select('*').single()
  return { data: data as RoleRow | null, error: toError(error) }
}

export async function grantPermission(roleId: string, permissionId: string) {
  const { error } = await supabase.from('role_permissions').insert({ role_id: roleId, permission_id: permissionId })
  return { error: toError(error) }
}

export async function revokePermission(roleId: string, permissionId: string) {
  const { error } = await supabase.from('role_permissions').delete().eq('role_id', roleId).eq('permission_id', permissionId)
  return { error: toError(error) }
}
