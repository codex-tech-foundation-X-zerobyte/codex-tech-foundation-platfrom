import { useEffect, useMemo, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows, Tabs, useToast } from '../../components/ui'
import {
  grantPermission, listPermissions, listRolePermissions, listRoles, revokePermission,
  type PermissionRow, type RoleRow,
} from '../../lib/services'
import './AdminRoles.css'

export function AdminRoles() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [grants, setGrants] = useState<Set<string>>(new Set())
  const [activeRole, setActiveRole] = useState<string>('')
  const [error, setError] = useState(false)
  const { push } = useToast()

  const load = () => {
    setError(false)
    Promise.all([listRoles(), listPermissions(), listRolePermissions()]).then(([r, p, rp]) => {
      if (r.error || p.error || rp.error) { setError(true); return }
      setRoles(r.data)
      setPermissions(p.data)
      setGrants(new Set(rp.data.map((g) => `${g.role_id}:${g.permission_id}`)))
      if (r.data[0]) setActiveRole((prev) => prev || r.data[0].id)
    })
  }
  useEffect(load, [])

  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionRow[]>()
    for (const p of permissions) {
      const group = p.key.split('.')[0]
      if (!byGroup.has(group)) byGroup.set(group, [])
      byGroup.get(group)!.push(p)
    }
    return byGroup
  }, [permissions])

  const toggle = async (permissionId: string, granted: boolean) => {
    const key = `${activeRole}:${permissionId}`
    setGrants((prev) => {
      const next = new Set(prev)
      granted ? next.delete(key) : next.add(key)
      return next
    })
    const { error: err } = granted ? await revokePermission(activeRole, permissionId) : await grantPermission(activeRole, permissionId)
    if (err) {
      push('Could not update that permission.', 'error')
      load()
    } else {
      push(granted ? 'Permission revoked' : 'Permission granted')
    }
  }

  if (error) return <ErrorState onRetry={load} />
  if (roles === null) return <SkeletonRows rows={4} height="40px" />
  if (roles.length === 0) {
    return <EmptyState icon={KeyRound} title="No roles defined yet" description="Roles are seeded automatically the first time this migration runs." />
  }

  return (
    <div>
      <SectionHeading eyebrow="Admin" title="Roles &amp; permissions." description="Changes here write directly to role_permissions and take effect immediately." />
      <Tabs tabs={roles.map((r) => ({ id: r.id, label: r.name }))} active={activeRole} onChange={setActiveRole} />

      <div className="ctf-permission-groups">
        {[...groups.entries()].map(([group, perms]) => (
          <div className="ctf-permission-group" key={group}>
            <h3>{group}</h3>
            {perms.map((p) => {
              const granted = grants.has(`${activeRole}:${p.id}`)
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
