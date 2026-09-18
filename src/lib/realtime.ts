import { supabase } from './supabase'
import type { Message } from './types'
import type { RealtimeChannel } from '@supabase/supabase-js'

// The one place supabase.channel() is called for chat. Pages import
// subscribeToChannelMessages(), never touch the Supabase Realtime client
// directly — see docs/REALTIME.md, which this file implements.
//
// Scoping: each Postgres Changes subscription filters to a single
// channel_id server-side (`filter: channel_id=eq.<id>`), so a client is
// never subscribed to a firehose of every message in the system — only the
// one channel it currently has open. RLS still applies to postgres_changes
// payloads, so even a manipulated filter couldn't leak another channel's
// messages.
export function subscribeToChannelMessages(
  channelId: string,
  handlers: { onInsert?: (message: Message) => void; onUpdate?: (message: Message) => void },
): RealtimeChannel {
  const channel = supabase
    .channel(`messages:${channelId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => handlers.onInsert?.(payload.new as Message),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => handlers.onUpdate?.(payload.new as Message),
    )
    .subscribe()
  return channel
}

// Callers MUST call this in a useEffect cleanup — an un-unsubscribed
// channel is a real leak, doubly so under React StrictMode's
// mount/unmount/remount in development. See docs/REALTIME.md's guardrail.
export function unsubscribe(channel: RealtimeChannel) {
  void supabase.removeChannel(channel)
}

// Live "is there a call happening in this channel" feed — Postgres
// Changes on `calls`, filtered server-side to one channel_id, same
// pattern as subscribeToChannelMessages above.
export function subscribeToChannelCalls(channelId: string, onChange: () => void): RealtimeChannel {
  const channel = supabase
    .channel(`calls:${channelId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `channel_id=eq.${channelId}` }, () => onChange())
    .subscribe()
  return channel
}

// ── Call signaling ─────────────────────────────────────────────────────
// Uses Realtime Broadcast, not postgres_changes: SDP offers/answers and ICE
// candidates are ephemeral exchange messages, not data worth persisting to
// Postgres. IMPORTANT — read this before assuming this has the same
// guarantee as messages above: Broadcast on a public (non-private) channel
// is relayed to anyone subscribed to that exact channel name; it is NOT
// checked against Postgres RLS the way postgres_changes is. The practical
// protection here is (a) the channel name is an unguessable call UUID that
// a client can only ever learn by successfully querying `calls`/
// `call_participants`, which ARE RLS-protected, and (b) callSignalPayload
// below is a discriminated union scoped to one call — there is nothing
// generically listenable. This is the same class of protection already
// used for chat-attachments paths and DM channel IDs elsewhere in this
// codebase, not a new pattern. For stronger, RLS-enforced broadcast
// authorization, Supabase supports "private channels" with policies on
// `realtime.messages` — deliberately not implemented here since getting
// that schema/API exactly right without a live project to verify against
// risks shipping a policy that LOOKS like protection but silently doesn't
// apply; see docs/REALTIME.md for this tradeoff spelled out and a pointer
// to Supabase's own docs for whoever hardens this next.
export type CallSignal =
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'hangup'; from: string }

export function subscribeToCallSignaling(callId: string, onSignal: (signal: CallSignal) => void): RealtimeChannel {
  const channel = supabase
    .channel(`call:${callId}`)
    .on('broadcast', { event: 'signal' }, (payload) => onSignal(payload.payload as CallSignal))
    .subscribe()
  return channel
}

export function sendCallSignal(channel: RealtimeChannel, signal: CallSignal) {
  void channel.send({ type: 'broadcast', event: 'signal', payload: signal })
}

