import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, PhoneOff, Video } from 'lucide-react'
import { Avatar, Button } from './ui'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getProfilesByIds } from '../lib/services/chat'
import type { Call } from '../lib/types'
import './IncomingCallListener.css'

interface IncomingCall {
  call: Call
  callerName: string
  channelName: string
}

// Mounted once at the app root (inside the Router, outside any one
// workspace's routes) so an incoming call surfaces no matter what page the
// recipient is on — the previous behavior only showed a "call in progress"
// banner inside ChatPage, and only for whichever channel you happened to
// already have open. This is the real fix for "the person I'm calling
// doesn't even know."
//
// Subscribes to ALL `calls` INSERTs with no channel filter — this is
// correct, not a broad-access bug: Postgres Changes still enforces RLS
// (can_access_channel()) on every row before it reaches this client, so a
// user only ever receives events for calls in channels they can actually
// access. See docs/REALTIME.md.
export function IncomingCallListener() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  // Declined calls stay dismissed for this browser tab even if the
  // INSERT event (or a reconnect) somehow delivers the same call again.
  const dismissedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Clients have no Chat/Calls UI in this pass (§39 of the brief — Chat
    // is an internal team surface) — nothing to subscribe to for them.
    if (!profile || profile.role === 'client') return

    const channel = supabase
      .channel('global-incoming-calls')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
        void (async () => {
          const call = payload.new as Call
          if (call.created_by === profile.id) return // I started this call
          if (dismissedRef.current.has(call.id)) return

          const [{ data: channelRow }, { data: names }] = await Promise.all([
            supabase.from('channels').select('*').eq('id', call.channel_id).maybeSingle(),
            call.created_by ? getProfilesByIds([call.created_by]) : Promise.resolve({ data: new Map<string, string>() }),
          ])
          setIncoming({
            call,
            callerName: (call.created_by && names.get(call.created_by)) || 'A team member',
            channelName: channelRow?.name || 'Direct message',
          })
        })()
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [profile?.id, profile?.role])

  if (!incoming) return null

  const accept = () => {
    const base = profile?.role === 'worker' ? '/worker/chat' : '/admin/chat'
    navigate(`${base}?join=${incoming.call.id}&channel=${incoming.call.channel_id}`)
    setIncoming(null)
  }
  const decline = () => {
    dismissedRef.current.add(incoming.call.id)
    setIncoming(null)
  }

  return (
    <div className="ctf-incoming-call">
      <div className="ctf-incoming-call__card">
        <Avatar name={incoming.callerName} size={48} />
        <div className="ctf-incoming-call__info">
          <strong>{incoming.callerName}</strong>
          <p>{incoming.call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call'} · {incoming.channelName}</p>
        </div>
        <div className="ctf-incoming-call__actions">
          <Button variant="danger" icon={<PhoneOff size={16} />} onClick={decline}>Decline</Button>
          <Button variant="primary" icon={incoming.call.kind === 'video' ? <Video size={16} /> : <Phone size={16} />} onClick={accept}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
