import { supabase } from '../supabase'

/**
 * Asks the database whether the CURRENT user holds a permission, via the same has_permission() function the RLS policies
 * call. Used only to decide what to SHOW; the policies remain the actual enforcement. A failure counts as "no" — the
 * safe default for a UI hint.
 */
export async function hasPermission(key: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_permission', { permission_key: key })
  return !error && data === true
}
