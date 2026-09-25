import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { EmptyState, SkeletonRows } from './ui'
import type { Role } from '../lib/types'

export function ProtectedRoute({
  allowedRoles,
  activeRole,
  loading = false,
  children,
}: {
  allowedRoles: Role[]
  activeRole: Role | null
  loading?: boolean
  children: ReactNode
}) {
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 320 }}><SkeletonRows rows={3} /></div>
      </div>
    )
  }

  const hasAccess = activeRole !== null && allowedRoles.includes(activeRole)
  if (!hasAccess) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description="This workspace is secured for authenticated accounts with the required permission. Sign in with an authorised account to continue."
        />
      </div>
    )
  }

  return <>{children}</>
}
