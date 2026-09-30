import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from './ui'
import {
  getDisplayNames, getOrStartGroupCall, joinGroupCall, leaveGroupCall,
  openGroupSignalingChannel, type GroupCall, type GroupSignal,
} from '../lib/services'
import { describeMediaError, getLocalMedia, ICE_SERVERS, stopStream } from '../lib/rtc'

const DISCONNECT_GRACE_MS = 8_000

interface PeerEntry {
  connection: RTCPeerConnection
  pendingIce: RTCIceCandidateInit[]
  disconnectTimer: ReturnType<typeof setTimeout> | null
}

interface GroupCallState {
  call: GroupCall | null
  joining: boolean
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  names: Record<string, string>
  muted: boolean
  cameraOff: boolean
  joinChannelCall: (channelId: string, type: 'voice' | 'video') => Promise<void>
  leave: () => Promise<void>
  toggleMute: () => void
  toggleCamera: () => void
}

const GroupCallContext = createContext<GroupCallState | null>(null)

/**
 * Small-team mesh calls: every participant holds one RTCPeerConnection per other participant.
 * Comfortable up to roughly 6 people; beyond that an SFU is the right tool.
 * Protocol: whoever is already in the room offers to a newcomer on `join` (one direction per pair => no glare).
 */
export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const pushRef = useRef(push)
  useEffect(() => { pushRef.current = push })

  const [call, setCall] = useState<GroupCall | null>(null)
  const [joining, setJoining] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [names, setNames] = useState<Record<string, string>>({})
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)

  const peersRef = useRef<Map<string, PeerEntry>>(new Map())
  const earlyIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const signalRef = useRef<ReturnType<typeof openGroupSignalingChannel> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const selfIdRef = useRef<string | null>(null)
  const callIdRef = useRef<string | null>(null)
  const joiningRef = useRef(false)
  const mutedRef = useRef(false)
  const cameraOffRef = useRef(false)

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId)
    if (entry) {
      if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer)
      entry.connection.onicecandidate = null
      entry.connection.ontrack = null
      entry.connection.onconnectionstatechange = null
      entry.connection.close()
    }
    peersRef.current.delete(peerId)
    earlyIceRef.current.delete(peerId)
    setRemoteStreams((prev) => {
      if (!prev.has(peerId)) return prev
      const next = new Map(prev)
      next.delete(peerId)
      return next
    })
  }, [])

  const createPeer = useCallback((peerId: string) => {
    closePeer(peerId) // a rejoining participant must not leave its old connection dangling
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry: PeerEntry = { connection: pc, pendingIce: earlyIceRef.current.get(peerId) ?? [], disconnectTimer: null }
    earlyIceRef.current.delete(peerId)
    peersRef.current.set(peerId, entry)

    pc.onicecandidate = (event) => {
      if (event.candidate && selfIdRef.current) {
        signalRef.current?.send({ kind: 'ice-candidate', from: selfIdRef.current, to: peerId, candidate: event.candidate.toJSON() })
      }
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      setRemoteStreams((prev) => new Map(prev).set(peerId, stream))
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (entry.disconnectTimer) { clearTimeout(entry.disconnectTimer); entry.disconnectTimer = null }
      } else if (pc.connectionState === 'disconnected') {
        if (!entry.disconnectTimer) entry.disconnectTimer = setTimeout(() => closePeer(peerId), DISCONNECT_GRACE_MS)
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(peerId)
      }
    }
    const local = localStreamRef.current
    local?.getTracks().forEach((t) => pc.addTrack(t, local))
    return entry
  }, [closePeer])

  const flushIce = useCallback(async (entry: PeerEntry) => {
    const pending = entry.pendingIce
    entry.pendingIce = []
    for (const c of pending) {
      try { await entry.connection.addIceCandidate(c) } catch { /* stale candidate */ }
    }
  }, [])

  const handleSignal = useCallback(async (payload: GroupSignal) => {
    const self = selfIdRef.current
    if (!self) return
    try {
      if (payload.kind === 'join' && payload.from !== self) {
        const entry = createPeer(payload.from)
        void getDisplayNames([payload.from]).then((n) => setNames((prev) => ({ ...prev, ...n })))
        const offer = await entry.connection.createOffer()
        await entry.connection.setLocalDescription(offer)
        signalRef.current?.send({ kind: 'offer', from: self, to: payload.from, sdp: offer })
      } else if (payload.kind === 'leave') {
        closePeer(payload.from)
      } else if (payload.kind === 'offer' && payload.to === self) {
        const entry = peersRef.current.get(payload.from) ?? createPeer(payload.from)
        void getDisplayNames([payload.from]).then((n) => setNames((prev) => ({ ...prev, ...n })))
        await entry.connection.setRemoteDescription(payload.sdp)
        await flushIce(entry)
        const answer = await entry.connection.createAnswer()
        await entry.connection.setLocalDescription(answer)
        signalRef.current?.send({ kind: 'answer', from: self, to: payload.from, sdp: answer })
      } else if (payload.kind === 'answer' && payload.to === self) {
        const entry = peersRef.current.get(payload.from)
        if (entry && entry.connection.signalingState === 'have-local-offer') {
          await entry.connection.setRemoteDescription(payload.sdp)
          await flushIce(entry)
        }
      } else if (payload.kind === 'ice-candidate' && payload.to === self) {
        const entry = peersRef.current.get(payload.from)
        if (entry?.connection.remoteDescription) {
          try { await entry.connection.addIceCandidate(payload.candidate) } catch { /* stale candidate */ }
        } else if (entry) {
          entry.pendingIce.push(payload.candidate)
        } else {
          const early = earlyIceRef.current.get(payload.from) ?? []
          early.push(payload.candidate)
          earlyIceRef.current.set(payload.from, early)
        }
      }
    } catch (error) {
      console.error('[group call] signalling error', error)
    }
  }, [createPeer, closePeer, flushIce])

  const teardown = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) closePeer(id)
    peersRef.current.clear()
    earlyIceRef.current.clear()
    signalRef.current?.close()
    signalRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    callIdRef.current = null
    selfIdRef.current = null
    mutedRef.current = false
    cameraOffRef.current = false
    setLocalStream(null)
    setRemoteStreams(new Map())
    setNames({})
    setCall(null)
    setMuted(false)
    setCameraOff(false)
  }, [closePeer])

  const joinChannelCall = useCallback(async (channelId: string, type: 'voice' | 'video') => {
    if (!profile) return
    if (callIdRef.current || joiningRef.current) { pushRef.current("You're already in a call.", 'info'); return }
    joiningRef.current = true
    setJoining(true)
    try {
      const { data: session, error } = await getOrStartGroupCall(channelId, type)
      if (error || !session) { pushRef.current(error?.message ?? 'Could not start the call.', 'error'); return }

      // Use the room's own type: joining an existing video room with "voice" would otherwise send no video.
      const wantsVideo = session.type === 'video'
      let stream: MediaStream
      try {
        stream = await getLocalMedia(wantsVideo)
      } catch (e) {
        pushRef.current(describeMediaError(e, wantsVideo), 'error')
        await leaveGroupCall(session.id, profile.id) // ends the room again if we were the one who just created it
        return
      }

      selfIdRef.current = profile.id
      callIdRef.current = session.id
      localStreamRef.current = stream
      setLocalStream(stream)
      setCall(session)
      setNames({ [profile.id]: profile.display_name || 'You' })

      const signal = openGroupSignalingChannel(session.id)
      signalRef.current = signal
      try {
        // Subscribe BEFORE announcing: a `join` broadcast sent before we are live reaches nobody, and nobody would offer to us.
        await signal.open((payload) => void handleSignal(payload))
      } catch {
        teardown()
        await leaveGroupCall(session.id, profile.id)
        pushRef.current('Could not reach the call service. Check your connection and try again.', 'error')
        return
      }
      await joinGroupCall(session.id)
      signal.send({ kind: 'join', from: profile.id })
    } finally {
      joiningRef.current = false
      setJoining(false)
    }
  }, [profile, handleSignal, teardown])

  const leave = useCallback(async () => {
    const callId = callIdRef.current
    const self = selfIdRef.current
    if (callId && self) signalRef.current?.send({ kind: 'leave', from: self })
    teardown() // instant UI feedback
    if (callId && self) await leaveGroupCall(callId, self)
  }, [teardown])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }, [])

  const toggleCamera = useCallback(() => {
    const next = !cameraOffRef.current
    cameraOffRef.current = next
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !next })
    setCameraOff(next)
  }, [])

  useEffect(() => {
    const onHide = () => {
      const callId = callIdRef.current
      const self = selfIdRef.current
      if (callId && self) { signalRef.current?.send({ kind: 'leave', from: self }); void leaveGroupCall(callId, self) }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  useEffect(() => { if (!profile && callIdRef.current) teardown() }, [profile, teardown])
  useEffect(() => teardown, [teardown])

  const value = useMemo<GroupCallState>(
    () => ({ call, joining, localStream, remoteStreams, names, muted, cameraOff, joinChannelCall, leave, toggleMute, toggleCamera }),
    [call, joining, localStream, remoteStreams, names, muted, cameraOff, joinChannelCall, leave, toggleMute, toggleCamera],
  )
  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>
}

export function useGroupCall() {
  const ctx = useContext(GroupCallContext)
  if (!ctx) throw new Error('useGroupCall must be used within GroupCallProvider')
  return ctx
}
