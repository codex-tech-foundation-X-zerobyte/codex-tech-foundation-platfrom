import type { Role } from './types'

/** Where each role lands after sign-in (and the prefix of the only area it may open). */
export const roleHome = (role: Role | null | undefined) => (role === 'client' ? '/client' : role === 'worker' ? '/worker' : role ? '/admin' : '/login')
