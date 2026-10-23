import { supabase } from '../supabase'

/**
 * Resolves user ids to display names for chat, presence and calls.
 * Depends on the "internal users read internal profiles" policy (migration 20260923000000);
 * without it RLS only returns your own row and everyone else shows as "Team member".
 */
export async function getDisplayNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', unique)
  const names: Record<string, string> = {}
  for (const row of data ?? []) names[row.id as string] = (row.display_name as string) || 'Team member'
  for (const id of unique) names[id] ??= 'Team member'
  return names
}
