import { supabase } from '../supabase'
import { toError } from './shared'
import type { Role } from '../types'

/** Checks worker_profiles/client_users (wherever applies for this role) for the forced-change flag. */
export async function getMustChangePassword(userId: string, role: Role): Promise<boolean> {
  if (role === 'worker' || role === 'manager') {
    const { data } = await supabase.from('worker_profiles').select('must_change_password').eq('user_id', userId).maybeSingle()
    return data?.must_change_password ?? false
  }
  if (role === 'client') {
    const { data } = await supabase.from('client_users').select('must_change_password').eq('user_id', userId).maybeSingle()
    return data?.must_change_password ?? false
  }
  return false
}

export async function changePassword(newPassword: string) {
  const { data, error } = await supabase.functions.invoke('change-password', { body: { new_password: newPassword } })
  if (error || data?.error) {
    return { error: new Error(data?.error ?? 'Unable to change your password right now.') }
  }
  return { error: null }
}

export async function updateOwnProfile(input: { display_name: string }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: new Error('You must be signed in.') }
  const { error } = await supabase.from('profiles').update(input).eq('id', user.id)
  return { error: error ? new Error(error.message) : null }
}

export interface SessionInfo { email: string | null; lastSignInAt: string | null; createdAt: string | null; expiresAt: string | null }

/** Facts about THIS sign-in, for the Settings page. Reads the local session; nothing sensitive (no tokens) is returned. */
export async function getSessionInfo(): Promise<SessionInfo> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  return {
    email: user?.email ?? null,
    lastSignInAt: user?.last_sign_in_at ?? null,
    createdAt: user?.created_at ?? null,
    expiresAt: data.session?.expires_at ? new Date(data.session.expires_at * 1000).toISOString() : null,
  }
}

/** Ends every OTHER browser/device's session, keeping this one. Use after a lost phone or a shared computer. */
export async function signOutOtherSessions() {
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  return { error: toError(error) }
}
