import { useMemo, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows, Tabs, useToast } from '../../components/ui'
import {
  grantPermission, listPermissions, listRolePermissions, listRoles, revokePermission,
  type PermissionRow, type RoleRow,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminRoles.css'

interface RolesData {
  roles: RoleRow[]
  permissions: PermissionRow[]
  baseGrants: Set<string>
}

async function fetchRolesData(): Promise<{ data: RolesData; error: Error | null }> {
  const [r, p, rp] = await Promise.all([listRoles(), listPermissions(), listRolePermissions()])
  const error = r.error || p.error || rp.error
  return {
    data: {
      roles: r.data,
      permissions: p.data,
      baseGrants: new Set(rp.data.map((g) => `${g.role_id}:${g.permission_id}`)),
    },
    error,
  }
}

export function AdminRoles() {
  const { data, error, loading, reload } = useAsyncData('once', fetchRolesData)
  // Selected role: user's explicit choice, falling back to the first role once
  // data arrives — derived during render rather than synced via an effect.
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  // Optimistic per-permission overrides, keyed by "roleId:permissionId". Applied
  // on top of baseGrants so a toggle updates instantly without refetching.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const { push } = useToast()

  const roles = data?.roles ?? []
  const activeRole = selectedRole ?? roles[0]?.id ?? ''

  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionRow[]>()
    for (const p of data?.permissions ?? []) {
      const group = p.key.split('.')[0]
      if (!byGroup.has(group)) byGroup.set(group, [])
      byGroup.get(group)!.push(p)
    }
    return byGroup
  }, [data])

  const toggle = async (permissionId: string, currentlyGranted: boolean) => {
    const key = `${activeRole}:${permissionId}`
    setOverrides((prev) => ({ ...prev, [key]: !currentlyGranted }))
    const { error: err } = currentlyGranted
      ? await revokePermission(activeRole, permissionId)
      : await grantPermission(activeRole, permissionId)
    if (err) {
      push('Could not update that permission.', 'error')
      setOverrides((prev) => ({ ...prev, [key]: currentlyGranted })) // revert
    } else {
      push(currentlyGranted ? 'Permission revoked' : 'Permission granted')
    }
  }

  if (error) return <ErrorState onRetry={reload} />
  if (loading) return <SkeletonRows rows={4} height="40px" />
  if (roles.length === 0) {
    return <EmptyState icon={KeyRound} title="No roles defined yet" description="Roles are seeded automatically the first time this migration runs." />
  }

  return (
    <div>
      <SectionHeading eyebrow="Admin" title="Roles &amp; permissions." description="Changes here write directly to role_permissions and take effect immediately." />
      <Tabs tabs={roles.map((r) => ({ id: r.id, label: r.name }))} active={activeRole} onChange={setSelectedRole} />

      <div className="ctf-permission-groups">
        {[...groups.entries()].map(([group, perms]) => (
          <div className="ctf-permission-group" key={group}>
            <h3>{group}</h3>
            {perms.map((p) => {
              const key = `${activeRole}:${p.id}`
              const granted = key in overrides ? overrides[key] : (data?.baseGrants.has(key) ?? false)
              return (
                <label key={p.id} className="ctf-permission-row">
                  <input type="checkbox" checked={granted} onChange={() => void toggle(p.id, granted)} />
                  <div>
                    <strong>{p.key.split('.')[1] ?? p.key}</strong>
                    <span>{p.description}</span>
                  </div>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
