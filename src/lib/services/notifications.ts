import { supabase } from '../supabase'
import { toError } from './shared'

export async function countUnreadNotifications() {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  return { count: count ?? 0, error: toError(error) }
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  return { error: toError(error) }
}

/**
 * Live notification inserts for one user. Requires `notifications` in the supabase_realtime publication
 * (added in migration 20260923000000). The caller also polls as a fallback, so a missed event self-heals.
 */
export function subscribeToNotifications(userId: string, onInsert: () => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => onInsert())
    .subscribe()
  return () => void supabase.removeChannel(channel)
}
