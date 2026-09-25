import { supabase } from '../supabase'
import { toError } from './shared'

// Update your OWN display name/organization. RLS ("users update own
// profile") already enforces id = auth.uid() and blocks changing your own
// role through this path — this function can't be used to self-promote,
// even if someone tried passing a role field through it (it doesn't accept one).
export async function updateOwnProfile(input: { display_name?: string; organization?: string }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: new Error('Not signed in.') }
  const { error } = await supabase.from('profiles').update(input).eq('id', user.id)
  return { error: toError(error) }
}

export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return { error: toError(error) }
}

export async function getOwnEmail() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.email ?? null
}
