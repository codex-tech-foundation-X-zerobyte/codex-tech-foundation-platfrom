import { supabase } from '../supabase'
import type { Channel, Message, Project } from '../types'
import { storage, toError } from './shared'

// Team channel: one per org, auto-created on first access if it doesn't
// exist yet (see ensureTeamChannel). Project channels: one per project,
// created on demand the first time someone opens a project's chat.
export async function ensureTeamChannel() {
  const { data: existing } = await supabase.from('channels').select('*').eq('kind', 'team').is('archived_at', null).maybeSingle()
  if (existing) return { data: existing as Channel, error: null }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('channels').insert({ kind: 'team', name: 'Team', created_by: user?.id ?? null }).select('*').single()
  return { data: data as Channel | null, error: toError(error) }
}

export async function ensureProjectChannel(project: Project) {
  const { data: existing } = await supabase.from('channels').select('*').eq('kind', 'project').eq('project_id', project.id).maybeSingle()
  if (existing) return { data: existing as Channel, error: null }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('channels')
    .insert({ kind: 'project', name: project.name, project_id: project.id, created_by: user?.id ?? null })
    .select('*')
    .single()
  return { data: data as Channel | null, error: toError(error) }
}

// Opens (or creates) a 1:1 DM with another user via the create_dm_channel()
// security-definer function — a plain insert can't do this from one
// session, since channel_members RLS only allows inserting your OWN
// membership row, never a row for the other participant. See the Pass 5
// migration for why this needs to be a function rather than two inserts.
export async function openDirectMessage(otherUserId: string) {
  const { data, error } = await supabase.rpc('create_dm_channel', { other_user_id: otherUserId })
  if (error || !data) return { data: null as Channel | null, error: toError(error) ?? new Error('Could not start that conversation.') }
  const { data: channel, error: fetchError } = await supabase.from('channels').select('*').eq('id', data).maybeSingle()
  return { data: channel as Channel | null, error: toError(fetchError) }
}

export async function listMyChannels() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: [] as Channel[], error: null }

  // Team + project channels the RLS policy already scopes correctly on
  // plain select (can_access_channel), so a broad select just works. DMs
  // need the explicit channel_members join since there's no other way to
  // find "channels I'm a participant in."
  const { data: teamAndProject, error: err1 } = await supabase.from('channels').select('*').in('kind', ['team', 'project']).is('archived_at', null)
  const { data: dmRows, error: err2 } = await supabase.from('channel_members').select('channels(*)').eq('user_id', user.id)
  // Supabase's untyped client can't know the channel_members→channels
  // relationship is many-to-one (each row embeds exactly one channel), so
  // it infers `channels` as an array here. It isn't one at runtime — this
  // cast reflects the real FK shape, not a type-check workaround.
  const dms = ((dmRows ?? []) as unknown as { channels: Channel | null }[])
    .map((row) => row.channels)
    .filter((c): c is Channel => c !== null)

  return { data: [...(teamAndProject ?? []), ...dms] as Channel[], error: toError(err1) ?? toError(err2) }
}

export async function listMessages(channelId: string, limit = 100) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(limit)
  return { data: (data ?? []) as Message[], error: toError(error) }
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25MB — chat attachments stay small; large files belong in Team Files

export async function sendMessage(channelId: string, body: string, attachment?: File) {
  if (attachment && attachment.size > MAX_ATTACHMENT_BYTES) {
    return { error: new Error(`Attachment is too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB) — use Team Files for larger files.`) }
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: new Error('Not signed in.') }

  let attachment_path: string | null = null
  let attachment_name: string | null = null
  let attachment_size: number | null = null
  if (attachment) {
    // Path is `${channelId}/...` deliberately — the storage RLS policy on
    // chat-attachments parses the channel_id out of the object path itself
    // (see the Pass 5 migration), so this prefix is load-bearing, not cosmetic.
    const path = `${channelId}/${crypto.randomUUID()}-${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: uploadError } = await storage.upload('chat-attachments', path, attachment)
    if (uploadError) return { error: new Error('Could not upload the attachment.') }
    attachment_path = path
    attachment_name = attachment.name
    attachment_size = attachment.size
  }

  const { error } = await supabase.from('messages').insert({
    channel_id: channelId,
    author_id: user.id,
    body: body.trim(),
    attachment_path,
    attachment_name,
    attachment_size,
  })
  return { error: toError(error) }
}

export async function editMessage(messageId: string, body: string) {
  const { error } = await supabase.from('messages').update({ body: body.trim(), edited_at: new Date().toISOString() }).eq('id', messageId)
  return { error: toError(error) }
}

// Soft delete — the row and its channel_id stay (so "message deleted"
// renders in place of a hole in the thread); body and attachment are
// cleared. The attachment's storage object is also removed here, since a
// deleted message shouldn't leave a live signed-URL-able file behind.
export async function deleteMessage(message: Message) {
  if (message.attachment_path) await storage.remove('chat-attachments', [message.attachment_path])
  const { error } = await supabase
    .from('messages')
    .update({ body: '', attachment_path: null, attachment_name: null, attachment_size: null, deleted_at: new Date().toISOString() })
    .eq('id', message.id)
  return { error: toError(error) }
}

export async function getProfilesByIds(ids: string[]) {
  const unique = Array.from(new Set(ids)).filter(Boolean)
  if (!unique.length) return { data: new Map<string, string>(), error: null }
  const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', unique)
  const map = new Map((data ?? []).map((p) => [p.id as string, p.display_name as string]))
  return { data: map, error: toError(error) }
}

export async function getAttachmentUrl(message: Message) {
  if (!message.attachment_path) return { url: null, error: null }
  return storage.getSignedUrl('chat-attachments', message.attachment_path, 300)
}
