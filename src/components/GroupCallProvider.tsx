import { isPushActive } from '../lib/push'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from './ui'
import { useCall } from './CallProvider'
import {
  countCallParticipants, getDisplayNames, getOrStartGroupCall, joinGroupCall, leaveGroupCall, listActiveGroupCalls,
  listenForGroupCalls, listMyChannels, openGroupSignalingChannel, type GroupCall, type GroupSignal,
} from '../lib/services'
import { describeMediaError, getLocalMedia, ICE_SERVERS, stopStream } from '../lib/rtc'
import { getPrefs } from '../lib/prefs'
import { playChime } from '../lib/ringtone'

/** A call in progress that this person could join, shown as a banner on whatever page they are on. */
export interface GroupCallInvite {
  call: GroupCall
  channelName: string
  starterName: string
  isDirect: boolean
}

const STALE_CALL_MS = 3 * 60 * 60 * 1000

const DISCONNECT_GRACE_MS = 8_000

interface PeerEntry {
  connection: RTCPeerConnection
  pendingIce: RTCIceCandidateInit[]
  disconnectTimer: ReturnType<typeof setTimeout> | null
  /** First stream we received from this person: their camera/microphone. Any other stream from them is a screen share. */
  mainStream: MediaStream | null
  makingOffer: boolean
  screenSenders: RTCRtpSender[]
}

interface GroupCallState {
  invites: GroupCallInvite[]
  dismissInvite: (callId: string) => void
  joinInvite: (invite: GroupCallInvite) => Promise<void>
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
  canShareScreen: boolean
  screenSharing: boolean
  /** Screens other people in the room are sharing, by person. */
  screens: Map<string, MediaStream>
  toggleScreenShare: () => Promise<void>
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
  // A 1:1 call and a group call can't run at once (one microphone, one set of ears).
  const { phase: oneToOnePhase } = useCall()
  const oneToOnePhaseRef = useRef(oneToOnePhase)
  useEffect(() => { oneToOnePhaseRef.current = oneToOnePhase })
  const [invites, setInvites] = useState<GroupCallInvite[]>([])
  const dismissedRef = useRef<Set<string>>(new Set())

  const [call, setCall] = useState<GroupCall | null>(null)
  const [joining, setJoining] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [names, setNames] = useState<Record<string, string>>({})
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [screens, setScreens] = useState<Map<string, MediaStream>>(new Map())

  const peersRef = useRef<Map<string, PeerEntry>>(new Map())
  const earlyIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const signalRef = useRef<ReturnType<typeof openGroupSignalingChannel> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const selfIdRef = useRef<string | null>(null)
  const callIdRef = useRef<string | null>(null)
  const joiningRef = useRef(false)
  const mutedRef = useRef(false)
  const cameraOffRef = useRef(false)
  const screenRef = useRef<MediaStream | null>(null)
  const stopScreenRef = useRef<() => Promise<void>>(async () => {})

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
    setScreens((prev) => {
      if (!prev.has(peerId)) return prev
      const next = new Map(prev)
      next.delete(peerId)
      return next
    })
  }, [])

  const createPeer = useCallback((peerId: string) => {
    closePeer(peerId) // a rejoining participant must not leave its old connection dangling
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry: PeerEntry = { connection: pc, pendingIce: earlyIceRef.current.get(peerId) ?? [], disconnectTimer: null, mainStream: null, makingOffer: false, screenSenders: [] }
    earlyIceRef.current.delete(peerId)
    peersRef.current.set(peerId, entry)

    pc.onicecandidate = (event) => {
      if (event.candidate && selfIdRef.current) {
        signalRef.current?.send({ kind: 'ice-candidate', from: selfIdRef.current, to: peerId, candidate: event.candidate.toJSON() })
      }
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      const main = entry.mainStream
      // First stream = camera/microphone; anything else from the same person is their screen. A screen must never replace the
      // camera stream, or the room would go silent for that person while they present.
      if (!main || stream === main || (stream.id && stream.id === main.id)) {
        entry.mainStream = stream
        setRemoteStreams((prev) => new Map(prev).set(peerId, stream))
      } else {
        setScreens((prev) => new Map(prev).set(peerId, stream))
      }
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
    // Someone joining while we are presenting must receive the screen too.
    const screen = screenRef.current
    if (screen) entry.screenSenders = screen.getTracks().map((t) => pc.addTrack(t, screen))
    return entry
  }, [closePeer])

  const flushIce = useCallback(async (entry: PeerEntry) => {
    const pending = entry.pendingIce
    entry.pendingIce = []
    for (const c of pending) {
      try { await entry.connection.addIceCandidate(c) } catch { /* stale candidate */ }
    }
  }, [])

  /** Fresh offer to one person after our tracks changed. Perfect negotiation: the lexicographically larger id is "polite" and yields on a collision. */
  const renegotiatePeer = useCallback(async (peerId: string) => {
    const self = selfIdRef.current
    const entry = peersRef.current.get(peerId)
    if (!self || !entry) return
    const pc = entry.connection
    if (entry.makingOffer || pc.signalingState !== 'stable') { setTimeout(() => { void renegotiatePeer(peerId) }, 250); return }
    entry.makingOffer = true
    try {
      const offer = await pc.createOffer()
      if (pc.signalingState !== 'stable') return
      await pc.setLocalDescription(offer)
      signalRef.current?.send({ kind: 'offer', from: self, to: peerId, sdp: pc.localDescription ?? offer })
    } catch (error) {
      console.error('[group call] renegotiation failed', error)
    } finally {
      entry.makingOffer = false
    }
  }, [])

  const handleSignal = useCallback(async (payload: GroupSignal) => {
    const self = selfIdRef.current
    if (!self) return
    try {
      if (payload.kind === 'screen') {
        if (!payload.on && payload.from !== self) setScreens((prev) => { if (!prev.has(payload.from)) return prev; const next = new Map(prev); next.delete(payload.from); return next })
      } else if (payload.kind === 'join' && payload.from !== self) {
        const entry = createPeer(payload.from)
        void getDisplayNames([payload.from]).then((n) => setNames((prev) => ({ ...prev, ...n })))
        entry.makingOffer = true
        try {
          const offer = await entry.connection.createOffer()
          await entry.connection.setLocalDescription(offer)
          signalRef.current?.send({ kind: 'offer', from: self, to: payload.from, sdp: offer })
        } finally { entry.makingOffer = false }
        if (screenRef.current) signalRef.current?.send({ kind: 'screen', from: self, on: true })
      } else if (payload.kind === 'leave') {
        closePeer(payload.from)
      } else if (payload.kind === 'offer' && payload.to === self) {
        const entry = peersRef.current.get(payload.from) ?? createPeer(payload.from)
        void getDisplayNames([payload.from]).then((n) => setNames((prev) => ({ ...prev, ...n })))
        const polite = self > payload.from
        const collision = entry.makingOffer || entry.connection.signalingState !== 'stable'
        if (collision && !polite) return // we are impolite: our offer wins, theirs is dropped
        if (collision && entry.connection.signalingState === 'have-local-offer') await entry.connection.setLocalDescription({ type: 'rollback' })
        await entry.connection.setRemoteDescription(payload.sdp)
        await flushIce(entry)
        const answer = await entry.connection.createAnswer()
        await entry.connection.setLocalDescription(answer)
        signalRef.current?.send({ kind: 'answer', from: self, to: payload.from, sdp: entry.connection.localDescription ?? answer })
        if (collision) void renegotiatePeer(payload.from) // our rolled-back change still needs to reach them
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
  }, [createPeer, closePeer, flushIce, renegotiatePeer])

  const teardown = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) closePeer(id)
    peersRef.current.clear()
    earlyIceRef.current.clear()
    signalRef.current?.close()
    signalRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    stopStream(screenRef.current)
    screenRef.current = null
    setScreenSharing(false)
    setScreens(new Map())
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
    if (callIdRef.current || joiningRef.current || oneToOnePhaseRef.current !== 'idle') { pushRef.current("You're already in a call.", 'info'); return }
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

  const stopScreenShare = useCallback(async () => {
    const stream = screenRef.current
    const self = selfIdRef.current
    if (!stream) return
    screenRef.current = null
    stopStream(stream)
    setScreenSharing(false)
    for (const [peerId, entry] of peersRef.current) {
      for (const sender of entry.screenSenders) { try { entry.connection.removeTrack(sender) } catch { /* peer already gone */ } }
      entry.screenSenders = []
      void renegotiatePeer(peerId)
    }
    if (self) signalRef.current?.send({ kind: 'screen', from: self, on: false })
  }, [renegotiatePeer])
  useEffect(() => { stopScreenRef.current = stopScreenShare }, [stopScreenShare])

  const startScreenShare = useCallback(async () => {
    const self = selfIdRef.current
    if (!self || !callIdRef.current || screenRef.current) return
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') { pushRef.current("This device can't share its screen. Phones can't, but you can still present on the Presentation board.", 'info'); return }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name !== 'NotAllowedError' && name !== 'AbortError') pushRef.current('Could not start screen sharing.', 'error')
      return
    }
    if (!callIdRef.current) { stopStream(stream); return } // we left while the picker was open
    screenRef.current = stream
    setScreenSharing(true)
    const video = stream.getVideoTracks()[0]
    try { video.contentHint = 'detail' } catch { /* hint only */ }
    video.addEventListener('ended', () => { void stopScreenRef.current() })
    signalRef.current?.send({ kind: 'screen', from: self, on: true })
    for (const [peerId, entry] of peersRef.current) {
      entry.screenSenders = stream.getTracks().map((t) => entry.connection.addTrack(t, stream))
      void renegotiatePeer(peerId)
    }
  }, [renegotiatePeer])

  const toggleScreenShare = useCallback(async () => {
    if (screenRef.current) await stopScreenShare()
    else await startScreenShare()
  }, [startScreenShare, stopScreenShare])

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

  // ── Invitations: find calls in progress in my channels (now, and live from any page) ──
  const profileId = profile?.id
  const isTeam = !!profile && profile.role !== 'client'
  useEffect(() => {
    if (!profileId || !isTeam) return
    let cancelled = false
    const channelNames = new Map<string, { name: string; type: string }>()

    const toInvite = async (call: GroupCall): Promise<GroupCallInvite> => {
      if (!channelNames.has(call.channel_id)) {
        const { data } = await listMyChannels()
        for (const c of data) channelNames.set(c.id, { name: c.name, type: c.type })
      }
      const names = await getDisplayNames([call.started_by])
      const ch = channelNames.get(call.channel_id)
      return { call, channelName: ch?.name || 'a channel', starterName: names[call.started_by] ?? 'A teammate', isDirect: ch?.type === 'dm' }
    }
    const eligible = (c: GroupCall) =>
      c.status === 'active' && c.started_by !== profileId && !dismissedRef.current.has(c.id) && c.id !== callIdRef.current &&
      Date.now() - new Date(c.started_at).getTime() < STALE_CALL_MS

    // Catch-up: calls that started before this page loaded. Skip rows nobody is actually in (stale).
    void listActiveGroupCalls().then(async ({ data }) => {
      const candidates = data.filter(eligible)
      const counts = await countCallParticipants(candidates.map((c) => c.id))
      const live = candidates.filter((c) => (counts[c.id] ?? 0) > 0)
      const built = await Promise.all(live.map(toInvite))
      if (!cancelled && built.length) setInvites((prev) => [...prev, ...built.filter((b) => !prev.some((p) => p.call.id === b.call.id))])
    })

    const unlisten = listenForGroupCalls((call) => {
      if (call.status !== 'active') { setInvites((prev) => prev.filter((i) => i.call.id !== call.id)); return } // ended
      if (!eligible(call)) return
      void toInvite(call).then((invite) => {
        if (cancelled) return
        let added = false
        setInvites((prev) => { if (prev.some((p) => p.call.id === call.id)) return prev; added = true; return [...prev, invite] })
        if (added) {
          playChime()
          if (getPrefs().desktopAlerts && !isPushActive() && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`${invite.starterName} started a ${call.type} call`, { body: invite.isDirect ? 'Tap to join' : `in ${invite.channelName}`, tag: `gcall-${call.id}` })
          }
        }
      })
    })
    return () => { cancelled = true; unlisten() }
  }, [profileId, isTeam])

  // Once I'm in a call, its invitation is moot — derived at render, so there's no state to keep in sync.
  const activeCallId = call?.id
  const visibleInvites = useMemo(() => invites.filter((i) => i.call.id !== activeCallId), [invites, activeCallId])

  const dismissInvite = useCallback((callId: string) => {
    dismissedRef.current.add(callId)
    setInvites((prev) => prev.filter((i) => i.call.id !== callId))
  }, [])
  const joinInvite = useCallback(async (invite: GroupCallInvite) => { await joinChannelCall(invite.call.channel_id, invite.call.type) }, [joinChannelCall])
  useEffect(() => teardown, [teardown])

  const value = useMemo<GroupCallState>(
    () => ({ invites: visibleInvites, dismissInvite, joinInvite, call, joining, localStream, remoteStreams, names, muted, cameraOff, joinChannelCall, leave, toggleMute, toggleCamera, canShareScreen: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function', screenSharing, screens, toggleScreenShare }),
    [visibleInvites, dismissInvite, joinInvite, call, joining, localStream, remoteStreams, names, muted, cameraOff, joinChannelCall, leave, toggleMute, toggleCamera, screenSharing, screens, toggleScreenShare],
  )
  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>
}

export function useGroupCall() {
  const ctx = useContext(GroupCallContext)
  if (!ctx) throw new Error('useGroupCall must be used within GroupCallProvider')
  return ctx
}
