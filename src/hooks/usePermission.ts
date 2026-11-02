import { useEffect, useState } from 'react'
import { hasPermission } from '../lib/services'
import { useAuth } from '../lib/auth'
import type { Role } from '../lib/types'

/**
 * Mirrors the database rule "role is one of X, or holds permission Y" so the UI can hide actions that RLS would refuse.
 *  - `roles` are allowed outright (e.g. worker, superadmin) with no round trip;
 *  - clients are never allowed;
 *  - everyone else (managers) is checked against the real has_permission() once.
 * `checking` is true until the answer is known, so callers can avoid flashing a "you can't do this" message.
 */
export function usePermission(permission: string, roles: Role[]) {
  const { profile } = useAuth()
  const userId = profile?.id
  const role = profile?.role
  const byRole = !!role && roles.includes(role)
  const needsLookup = !!userId && !byRole && role !== 'client'
  const [answer, setAnswer] = useState<{ user: string; permission: string; value: boolean } | null>(null)

  useEffect(() => {
    if (!needsLookup || !userId) return
    let cancelled = false
    void hasPermission(permission).then((value) => { if (!cancelled) setAnswer({ user: userId, permission, value }) })
    return () => { cancelled = true }
  }, [needsLookup, userId, permission])

  const answered = answer?.user === userId && answer?.permission === permission
  return {
    allowed: byRole || (needsLookup && answered && answer.value),
    checking: needsLookup && !answered,
  }
}
