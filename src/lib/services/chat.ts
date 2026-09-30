import { supabase } from '../supabase'
import { toError } from './shared'

export interface ChatChannel {
  id: string
  type: 'project' | 'dm' | 'group'
  project_id: string | null
  name: string
  created_at: string
}

export interface ChatMessage {
  id: string
  channel_id: string
  sender_id: string
  body: string
  reply_to_id: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export async function listMyChannels() {
  const { data, error } = await supabase
    .from('chat_channel_members')
    .select('chat_channels(*)')
    .order('joined_at', { ascending: false })
  if (error) return { data: [] as ChatChannel[], error: toError(error) }
  const channels = (data ?? [])
    .map((row) => row.chat_channels as unknown as ChatChannel | null)
    .filter((c): c is ChatChannel => c !== null)
  return { data: channels, error: null }
}

export async function listMessages(channelId: string, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: ((data ?? []) as ChatMessage[]).reverse(), error: toError(error) }
}

export async function sendMessage(channelId: string, body: string, replyToId?: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null as ChatMessage | null, error: new Error('Not signed in') }
  // .select().single() hands the stored row back so the UI can show it immediately (and de-duplicate it
  // against the realtime echo) instead of depending on the websocket to display your own message.
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ channel_id: channelId, sender_id: user.id, body, reply_to_id: replyToId ?? null })
    .select('*')
    .single()
  return { data: data as ChatMessage | null, error: toError(error) }
}

export async function editMessage(id: string, body: string) {
  const { error } = await supabase.from('chat_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

export async function deleteMessage(id: string) {
  const { error } = await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

/**
 * Subscribes to new messages in a channel via Supabase Realtime. RLS on
 * chat_messages (is_channel_member) still applies to what Realtime will
 * actually deliver — this isn't a separate authorization path, it rides on
 * the same policy. Returns an unsubscribe function.
 */
export function subscribeToChannel(channelId: string, onMessage: (message: ChatMessage) => void): () => void {
  const channel = supabase
    .channel(`chat:${channelId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
      (payload) => onMessage(payload.new as ChatMessage),
    )
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

/**
 * Lightweight presence: tracks who's "online" on this channel via Supabase
 * Presence. Not a global online/offline indicator across the whole app —
 * scoped per channel, matching docs/REALTIME.md's target design.
 */
export function subscribeToPresence(channelId: string, userId: string, onSync: (onlineUserIds: string[]) => void): () => void {
  const channel = supabase.channel(`presence:${channelId}`, { config: { presence: { key: userId } } })
  channel
    .on('presence', { event: 'sync' }, () => {
      onSync(Object.keys(channel.presenceState()))
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ online_at: new Date().toISOString() })
    })
  return () => void supabase.removeChannel(channel)
}
