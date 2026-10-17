import { supabase } from '../supabase'
import { getCurrentUserId, storage, toError } from './shared'
import { storageKey } from '../storagePath'
import type { Role } from '../types'

export interface ChatChannel {
  id: string
  type: 'project' | 'dm' | 'group'
  project_id: string | null
  name: string
  created_at: string
}

export interface ChatAttachment {
  path: string
  name: string
  mime: string
  size: number
}

export interface TeamMember {
  id: string
  display_name: string
  role: Role
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
  attachments: ChatAttachment[]
}

/**
 * The channels I'm a member of — one row per channel.
 *
 * This used to read chat_channel_members and embed the channel. But RLS lets a member read EVERY membership row of their
 * channels, so a channel with five members came back five times (five "General"s, all the same channel). Querying the
 * channels, restricted to MY membership row, can only ever return each channel once.
 */
export async function listMyChannels() {
  const userId = await getCurrentUserId()
  if (!userId) return { data: [] as ChatChannel[], error: new Error('Your session has expired. Please sign in again.') }
  const { data, error, status } = await supabase
    .from('chat_channels')
    .select('*, chat_channel_members!inner(user_id)')
    .eq('chat_channel_members.user_id', userId)
  if (error) return { data: [] as ChatChannel[], error: toError(error, status) }
  const seen = new Set<string>() // belt and braces: never show the same channel twice, whatever the query returns
  const channels: ChatChannel[] = []
  for (const row of (data ?? []) as (ChatChannel & { chat_channel_members?: unknown })[]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    const { chat_channel_members: _members, ...channel } = row
    void _members
    channels.push(channel)
  }
  return { data: channels, error: null }
}

/** Everyone on the team (workers, managers, admins) — the directory used to start a private chat. */
export async function listTeamMembers() {
  const { data, error, status } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .in('role', ['worker', 'manager', 'superadmin'])
    .order('display_name')
  return { data: (data ?? []) as TeamMember[], error: toError(error, status) }
}

/** Opens (creating if needed) the private 1:1 chat with `otherUserId`. The database function enforces who may. */
export async function getOrCreateDm(otherUserId: string) {
  const { data, error, status } = await supabase.rpc('get_or_create_dm', { p_other: otherUserId })
  return { data: (data as string | null) ?? null, error: toError(error, status) }
}

/** The user ids in a channel — used to show how many of its members are online. */
export async function listChannelMemberIds(channelId: string): Promise<string[]> {
  const { data } = await supabase.from('chat_channel_members').select('user_id').eq('channel_id', channelId)
  return (data ?? []).map((r) => r.user_id as string)
}

/** For each DM channel, who the OTHER person is — so a DM can be labelled with their name. */
export async function listDmPartners(dmChannelIds: string[], myId: string): Promise<Record<string, string>> {
  if (dmChannelIds.length === 0) return {}
  const { data } = await supabase.from('chat_channel_members').select('channel_id, user_id').in('channel_id', dmChannelIds).neq('user_id', myId)
  return Object.fromEntries((data ?? []).map((r) => [r.channel_id as string, r.user_id as string]))
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

export async function sendMessage(channelId: string, body: string, attachments: ChatAttachment[] = [], replyToId?: string) {
  const userId = await getCurrentUserId()
  if (!userId) return { data: null as ChatMessage | null, error: new Error('Your session has expired. Please sign in again.') }
  // .select().single() hands the stored row back so the UI can show it immediately (and de-duplicate it
  // against the realtime echo) instead of depending on the websocket to display your own message.
  const { data, error, status } = await supabase
    .from('chat_messages')
    .insert({ channel_id: channelId, sender_id: userId, body, attachments, reply_to_id: replyToId ?? null })
    .select('*')
    .single()
  return { data: data as ChatMessage | null, error: toError(error, status) }
}

/** Uploads one attachment into the channel's media folder. The storage key is made safe; the original name is kept for display. */
export async function uploadChatMedia(channelId: string, file: File) {
  const userId = await getCurrentUserId()
  if (!userId) return { data: null as ChatAttachment | null, error: new Error('Your session has expired. Please sign in again.') }
  const path = storageKey([channelId, userId], file.name)
  const { error } = await storage.upload('chat-media', path, file)
  if (error) return { data: null as ChatAttachment | null, error }
  return { data: { path, name: file.name, mime: file.type, size: file.size } as ChatAttachment, error: null }
}

const signedUrlCache = new Map<string, { url: string; expires: number }>()
/** A short-lived link to an attachment, cached so scrolling a long thread doesn't re-sign every image on every render. */
export async function getChatMediaUrl(path: string): Promise<string | null> {
  const hit = signedUrlCache.get(path)
  if (hit && hit.expires > Date.now() + 60_000) return hit.url
  const { url } = await storage.getSignedUrl('chat-media', path, 3600)
  if (url) signedUrlCache.set(path, { url, expires: Date.now() + 3600 * 1000 })
  return url
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

/** Removes uploaded-but-never-sent attachments (the person removed one, or left the chat). */
export async function deleteChatMedia(paths: string[]) {
  if (paths.length) await storage.remove('chat-media', paths)
}

/** Fires when I'm added to a channel (e.g. someone opens a DM with me), so the chat list can update live. */
export function subscribeToMyChannelMembership(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`my-channels:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_channel_members', filter: `user_id=eq.${userId}` }, () => onChange())
    .subscribe()
  return () => void supabase.removeChannel(channel)
}
