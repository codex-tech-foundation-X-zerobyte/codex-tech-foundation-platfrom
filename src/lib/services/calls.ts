import { supabase } from '../supabase'
import { toError } from './shared'

export interface CallSession {
  id: string
  caller_id: string
  callee_id: string
  type: 'voice' | 'video'
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended' | 'cancelled'
  started_at: string
  answered_at: string | null
  ended_at: string | null
}

export async function startCall(calleeId: string, type: 'voice' | 'video') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('You must be signed in.') }
  if (user.id === calleeId) return { data: null, error: new Error('You cannot call yourself.') }
  const { data, error } = await supabase
    .from('calls')
    .insert({ caller_id: user.id, callee_id: calleeId, type, status: 'ringing' })
    .select('*')
    .single()
  return { data: data as CallSession | null, error: toError(error) }
}

export async function acceptCall(callId: string) {
  const { error } = await supabase.from('calls').update({ status: 'accepted', answered_at: new Date().toISOString() }).eq('id', callId)
  return { error: toError(error) }
}

export async function declineCall(callId: string) {
  const { error } = await supabase.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', callId)
  return { error: toError(error) }
}

export async function cancelCall(callId: string) {
  const { error } = await supabase.from('calls').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', callId)
  return { error: toError(error) }
}

export async function endCall(callId: string) {
  const { error } = await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId)
  return { error: toError(error) }
}

export async function markMissed(callId: string) {
  const { error } = await supabase.from('calls').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', callId)
  return { error: toError(error) }
}

export async function listCallHistory(limit = 30) {
  const { data, error } = await supabase.from('calls').select('*').order('started_at', { ascending: false }).limit(limit)
  return { data: (data ?? []) as CallSession[], error: toError(error) }
}

/**
 * Listens for calls where the current user is the callee. Backed by
 * Realtime on the `calls` table (RLS still applies — this can only ever
 * deliver rows the participants-only SELECT policy would allow anyway, so
 * there's no separate authorization surface to get wrong here). Fires for
 * both new incoming calls (INSERT) and status changes made by the other
 * party, e.g. the caller cancelling before you answer (UPDATE).
 */
export function listenForCalls(userId: string, onChange: (call: CallSession) => void): () => void {
  const channel = supabase
    .channel(`calls:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calls', filter: `callee_id=eq.${userId}` },
      (payload) => onChange(payload.new as CallSession),
    )
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

/** Same idea, for the caller's own side — so a caller's UI updates when the callee accepts/declines. */
export function listenForOutgoingCallUpdates(userId: string, onChange: (call: CallSession) => void): () => void {
  const channel = supabase
    .channel(`calls-out:${userId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `caller_id=eq.${userId}` },
      (payload) => onChange(payload.new as CallSession),
    )
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

// ─── WebRTC signaling (ephemeral — never written to a table) ───────────────

export type SignalPayload =
  | { kind: 'ready' }
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'hangup' }

const SUBSCRIBE_TIMEOUT_MS = 10_000

/**
 * One broadcast channel per call. Broadcast messages are NOT persisted or replayed, so a message sent
 * before the other side has fully subscribed is lost forever. `open()` therefore resolves only once this
 * side is SUBSCRIBED, and the call protocol (see CallProvider) never sends an offer until the callee
 * announces `ready` from a subscribed channel.
 */
export function openSignalingChannel(callId: string) {
  const channel = supabase.channel(`call-signal:${callId}`, { config: { broadcast: { self: false } } })
  return {
    open(onSignal: (payload: SignalPayload) => void): Promise<void> {
      channel.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as SignalPayload))
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Could not reach the realtime service.')), SUBSCRIBE_TIMEOUT_MS)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Could not reach the realtime service.')) }
        })
      })
    },
    send(payload: SignalPayload) {
      void channel.send({ type: 'broadcast', event: 'signal', payload })
    },
    close() {
      void supabase.removeChannel(channel)
    },
  }
}
