import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Lock } from 'lucide-react'
import { ButtonLink, EmptyState, SkeletonRows } from './ui'
import type { Role } from '../lib/types'
import { roleHome } from '../lib/roles'

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
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 320 }}><SkeletonRows rows={3} /></div>
      </div>
    )
  }

  // Signed out: send them to sign in and remember where they were going. (This used to be a dead-end
  // "Access restricted" card with no way forward — e.g. after a session expired mid-task.)
  if (activeRole === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (!allowedRoles.includes(activeRole)) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <EmptyState
          icon={Lock}
          title="You don't have access to this area"
          description="Your account is signed in, but it isn't permitted to open this workspace."
          action={<ButtonLink to={roleHome(activeRole)} variant="secondary">Go to your workspace</ButtonLink>}
        />
      </div>
    )
  }

  return <>{children}</>
}
