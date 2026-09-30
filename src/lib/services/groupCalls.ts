import { supabase } from '../supabase'
import { toError } from './shared'

export interface GroupCall {
  id: string
  channel_id: string
  started_by: string
  type: 'voice' | 'video'
  status: 'active' | 'ended'
  started_at: string
  ended_at: string | null
}

export interface GroupCallParticipant {
  call_id: string
  user_id: string
  joined_at: string
  left_at: string | null
}

/** Finds the channel's active call, or starts one if none exists — never creates a duplicate. */
export async function getOrStartGroupCall(channelId: string, type: 'voice' | 'video') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('You must be signed in.') }

  const { data: existing } = await supabase
    .from('group_calls')
    .select('*')
    .eq('channel_id', channelId)
    .eq('status', 'active')
    .maybeSingle()

  if (existing) return { data: existing as GroupCall, error: null }

  const { data, error } = await supabase
    .from('group_calls')
    .insert({ channel_id: channelId, started_by: user.id, type, status: 'active' })
    .select('*')
    .single()
  return { data: data as GroupCall | null, error: toError(error) }
}

export async function joinGroupCall(callId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: new Error('You must be signed in.') }
  const { error } = await supabase.from('group_call_participants').upsert(
    { call_id: callId, user_id: user.id, joined_at: new Date().toISOString(), left_at: null },
    { onConflict: 'call_id,user_id' },
  )
  return { error: toError(error) }
}

export async function leaveGroupCall(callId: string, userId: string) {
  const { error } = await supabase.from('group_call_participants').update({ left_at: new Date().toISOString() }).eq('call_id', callId).eq('user_id', userId)
  // Best-effort: if no one is left active, mark the call ended so a future
  // join starts a fresh room rather than joining a stale empty one.
  const { data: remaining } = await supabase.from('group_call_participants').select('user_id').eq('call_id', callId).is('left_at', null)
  if (!remaining || remaining.length === 0) {
    await supabase.from('group_calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId)
  }
  return { error: toError(error) }
}

export async function listActiveParticipants(callId: string) {
  const { data, error } = await supabase.from('group_call_participants').select('*').eq('call_id', callId).is('left_at', null)
  return { data: (data ?? []) as GroupCallParticipant[], error: toError(error) }
}

/** Fires whenever a participant row for this call changes (join/leave). */
export function subscribeToParticipants(callId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`group-call-participants:${callId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_call_participants', filter: `call_id=eq.${callId}` }, () => onChange())
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

// ─── Mesh signaling (ephemeral, per-call broadcast channel) ────────────────

export type GroupSignal =
  | { kind: 'join'; from: string }
  | { kind: 'leave'; from: string }
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice-candidate'; from: string; to: string; candidate: RTCIceCandidateInit }

export function openGroupSignalingChannel(callId: string) {
  const channel = supabase.channel(`group-call-signal:${callId}`, { config: { broadcast: { self: false } } })
  return {
    /** Resolves once SUBSCRIBED. Never send `join` before this — broadcasts aren't replayed. */
    open(onSignal: (payload: GroupSignal) => void): Promise<void> {
      channel.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as GroupSignal))
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Could not reach the realtime service.')), 10_000)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Could not reach the realtime service.')) }
        })
      })
    },
    send(payload: GroupSignal) {
      void channel.send({ type: 'broadcast', event: 'signal', payload })
    },
    close() {
      void supabase.removeChannel(channel)
    },
  }
}
