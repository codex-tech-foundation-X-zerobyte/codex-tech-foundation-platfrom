import { supabase } from '../supabase'
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
