import { supabase } from '../supabase'
import type { Call, CallParticipant } from '../types'
import { toError } from './shared'

export async function getActiveCall(channelId: string) {
  const { data, error } = await supabase.from('calls').select('*').eq('channel_id', channelId).eq('status', 'active').maybeSingle()
  return { data: data as Call | null, error: toError(error) }
}

export async function startCall(channelId: string, kind: Call['kind']) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null as Call | null, error: new Error('Not signed in.') }

  const { data, error } = await supabase.from('calls').insert({ channel_id: channelId, kind, created_by: user.id }).select('*').single()
  if (error || !data) return { data: null as Call | null, error: toError(error) }
  await supabase.from('call_participants').insert({ call_id: data.id, user_id: user.id })
  return { data: data as Call, error: null }
}

export async function joinCall(callId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: new Error('Not signed in.') }
  const { error } = await supabase.from('call_participants').upsert({ call_id: callId, user_id: user.id, status: 'joined', left_at: null })
  return { error: toError(error) }
}

export async function leaveCall(callId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: new Error('Not signed in.') }
  const { error } = await supabase.from('call_participants').update({ status: 'left', left_at: new Date().toISOString() }).eq('call_id', callId).eq('user_id', user.id)

  // If nobody is left "joined", mark the call ended — a call with zero
  // active participants shouldn't keep showing as ringing/active to anyone
  // who opens the channel later.
  const { data: remaining } = await supabase.from('call_participants').select('user_id').eq('call_id', callId).eq('status', 'joined')
  if (!remaining || remaining.length === 0) {
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId)
  }
  return { error: toError(error) }
}

export async function listParticipants(callId: string) {
  const { data, error } = await supabase.from('call_participants').select('*').eq('call_id', callId)
  return { data: (data ?? []) as CallParticipant[], error: toError(error) }
}
