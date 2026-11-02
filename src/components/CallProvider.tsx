import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from './ui'
import {
  acceptCall, cancelCall, declineCall, endCall, getDisplayNames, listenForCalls, listenForOutgoingCallUpdates,
  markMissed, openSignalingChannel, startCall, type CallSession, type SignalPayload,
} from '../lib/services'
import { describeMediaError, getLocalMedia, ICE_SERVERS, stopStream } from '../lib/rtc'
import { startRingtone, stopRingtone } from '../lib/ringtone'

const RING_TIMEOUT_MS = 45_000
const CONNECT_TIMEOUT_MS = 25_000
const DISCONNECT_GRACE_MS = 8_000
const READY_RETRY_MS = 1_500
const READY_MAX_ATTEMPTS = 12

export type CallPhase = 'idle' | 'ringing-outgoing' | 'ringing-incoming' | 'connecting' | 'active'

interface CallState {
  phase: CallPhase
  session: CallSession | null
  peerName: string | null
  startedAt: number | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  startCallWith: (calleeId: string, type: 'voice' | 'video') => Promise<void>
  acceptIncoming: () => Promise<void>
  declineIncoming: () => Promise<void>
  hangUp: () => Promise<void>
  toggleMute: () => void
  toggleCamera: () => void
  /** True when this browser can share its screen (desktop browsers; phones generally cannot). */
  canShareScreen: boolean
  /** We are sharing our screen to the other person. */
  screenSharing: boolean
  /** The other person's shared screen, when they are sharing. */
  remoteScreen: MediaStream | null
  toggleScreenShare: () => Promise<void>
}

export const canShareScreenHere = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

const CallContext = createContext<CallState | null>(null)

/**
 * 1:1 calls. Handshake, in order:
 *   caller: has mic -> inserts the `calls` row -> subscribes to the signalling channel -> rings
 *   callee: sees the row via realtime -> user taps Accept -> has mic -> SUBSCRIBES -> marks accepted -> sends `ready`
 *   caller: receives `ready` -> creates the offer -> callee answers -> ICE flows -> connected
 *
 * Why `ready`: signalling broadcasts are not stored. The old flow made the caller send its offer the
 * instant the DB said "accepted", which routinely landed before the callee had joined the channel — so
 * the offer was lost and the callee's screen never connected. The callee now speaks first, from a channel
 * it knows is live, and repeats `ready` until an offer arrives.
 *
 * All mutable call state lives in refs so realtime callbacks never read a stale render's closure.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const profileId = profile?.id
  const { push } = useToast()
  const pushRef = useRef(push)
  useEffect(() => { pushRef.current = push })

  const [phase, setPhaseState] = useState<CallPhase>('idle')
  const [session, setSessionState] = useState<CallSession | null>(null)
  const [peerName, setPeerName] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [remoteScreen, setRemoteScreen] = useState<MediaStream | null>(null)

  const phaseRef = useRef<CallPhase>('idle')
  const sessionRef = useRef<CallSession | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const signalRef = useRef<ReturnType<typeof openSignalingChannel> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const isCallerRef = useRef(false)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null)
  const answerRef = useRef<RTCSessionDescriptionInit | null>(null)
  const gotOfferRef = useRef(false)
  const startingRef = useRef(false)
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutedRef = useRef(false)
  const cameraOffRef = useRef(false)
  const screenRef = useRef<MediaStream | null>(null)
  const screenSendersRef = useRef<RTCRtpSender[]>([])
  const mainStreamRef = useRef<MediaStream | null>(null)
  const makingOfferRef = useRef(false)
  const stopScreenRef = useRef<() => Promise<void>>(async () => {})

  const setPhase = useCallback((p: CallPhase) => { phaseRef.current = p; setPhaseState(p) }, [])
  const setSession = useCallback((s: CallSession | null) => { sessionRef.current = s; setSessionState(s) }, [])

  const clearTimers = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    if (readyTimerRef.current) { clearInterval(readyTimerRef.current); readyTimerRef.current = null }
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null }
  }, [])

  const cleanup = useCallback(() => {
    clearTimers()
    stopRingtone()
    signalRef.current?.close()
    signalRef.current = null
    const pc = pcRef.current
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.close() }
    pcRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    stopStream(screenRef.current)
    screenRef.current = null
    screenSendersRef.current = []
    mainStreamRef.current = null
    makingOfferRef.current = false
    setScreenSharing(false)
    setRemoteScreen(null)
    pendingIceRef.current = []
    offerRef.current = null
    answerRef.current = null
    gotOfferRef.current = false
    isCallerRef.current = false
    mutedRef.current = false
    cameraOffRef.current = false
    setLocalStream(null)
    setRemoteStream(null)
    setPeerName(null)
    setStartedAt(null)
    setMuted(false)
    setCameraOff(false)
    setSession(null)
    setPhase('idle')
  }, [clearTimers, setPhase, setSession])

  /** Ends the call from our side because something went wrong, and tells the other person. */
  const failCall = useCallback((callId: string, message: string) => {
    signalRef.current?.send({ kind: 'hangup' })
    void endCall(callId)
    cleanup()
    pushRef.current(message, 'error')
  }, [cleanup])

  const createPc = useCallback((callId: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc

    pc.onicecandidate = (event) => {
      if (event.candidate) signalRef.current?.send({ kind: 'ice-candidate', candidate: event.candidate.toJSON() })
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      const main = mainStreamRef.current
      // The first stream is the person's camera/microphone. Any other stream is a screen share: it must NEVER replace the
      // camera stream, or the call would lose its audio the moment someone starts presenting.
      if (!main) { mainStreamRef.current = stream; setRemoteStream(stream); return }
      if (stream === main || (stream.id && stream.id === main.id)) { setRemoteStream(stream); return }
      setRemoteScreen(stream)
    }
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'connected') {
        if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null }
        if (phaseRef.current !== 'active') {
          clearTimers()
          stopRingtone()
          setStartedAt(Date.now())
          setPhase('active')
        }
      } else if (state === 'disconnected') {
        // Often a momentary blip while ICE re-routes; only give up if it doesn't recover.
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => failCall(callId, 'The connection was lost.'), DISCONNECT_GRACE_MS)
        }
      } else if (state === 'failed') {
        failCall(callId, 'The call could not connect. One of your networks may be blocking it.')
      }
    }

    const local = localStreamRef.current
    local?.getTracks().forEach((t) => pc.addTrack(t, local))
    return pc
  }, [clearTimers, failCall, setPhase])

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const pending = pendingIceRef.current
    pendingIceRef.current = []
    for (const candidate of pending) {
      try { await pc.addIceCandidate(candidate) } catch { /* stale candidate — harmless */ }
    }
  }, [])

  /**
   * Sends a fresh offer after tracks were added or removed mid-call. Uses the "perfect negotiation" rules so two people changing
   * things at once don't deadlock: the CALLER is impolite (its offer wins a collision), the callee is polite (it rolls back).
   */
  const renegotiate = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || phaseRef.current !== 'active') return
    if (makingOfferRef.current || pc.signalingState !== 'stable') { setTimeout(() => { void renegotiate() }, 250); return }
    makingOfferRef.current = true
    try {
      const offer = await pc.createOffer()
      if (pc.signalingState !== 'stable') return
      await pc.setLocalDescription(offer)
      signalRef.current?.send({ kind: 'reoffer', sdp: pc.localDescription ?? offer })
    } catch (error) {
      console.error('[call] renegotiation failed', error)
    } finally {
      makingOfferRef.current = false
    }
  }, [])

  const handleSignal = useCallback(async (callId: string, payload: SignalPayload) => {
    if (sessionRef.current?.id !== callId) return
    try {
      switch (payload.kind) {
        case 'hangup': {
          cleanup()
          pushRef.current('The call ended.', 'info')
          return
        }
        case 'ready': {
          if (!isCallerRef.current) return
          clearTimers()
          stopRingtone()
          if (offerRef.current) { // callee retried — it probably missed our offer, so send the same one again
            signalRef.current?.send({ kind: 'offer', sdp: offerRef.current })
            return
          }
          const pc = pcRef.current ?? createPc(callId)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          offerRef.current = offer
          signalRef.current?.send({ kind: 'offer', sdp: offer })
          setPhase('connecting')
          return
        }
        case 'offer': {
          if (isCallerRef.current) return
          const pc = pcRef.current
          if (!pc) return
          if (readyTimerRef.current) { clearInterval(readyTimerRef.current); readyTimerRef.current = null }
          if (gotOfferRef.current) { // duplicate offer: just repeat our answer
            if (answerRef.current) signalRef.current?.send({ kind: 'answer', sdp: answerRef.current })
            return
          }
          gotOfferRef.current = true
          await pc.setRemoteDescription(payload.sdp)
          await flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          answerRef.current = answer
          signalRef.current?.send({ kind: 'answer', sdp: answer })
          return
        }
        case 'answer': {
          const pc = pcRef.current
          if (!pc || pc.signalingState !== 'have-local-offer') return
          await pc.setRemoteDescription(payload.sdp)
          await flushIce(pc)
          return
        }
        case 'screen': {
          if (!payload.on) setRemoteScreen(null)
          return
        }
        case 'reoffer': {
          const pc = pcRef.current
          if (!pc || !pc.remoteDescription) return
          const polite = !isCallerRef.current
          const collision = makingOfferRef.current || pc.signalingState !== 'stable'
          if (collision && !polite) return // we are the impolite side: our own offer wins, theirs is dropped
          if (collision && pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' })
          await pc.setRemoteDescription(payload.sdp)
          await flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          signalRef.current?.send({ kind: 'reanswer', sdp: pc.localDescription ?? answer })
          if (collision) void renegotiate() // our rolled-back change still needs to reach them
          return
        }
        case 'reanswer': {
          const pc = pcRef.current
          if (!pc || pc.signalingState !== 'have-local-offer') return
          await pc.setRemoteDescription(payload.sdp)
          await flushIce(pc)
          return
        }
        case 'ice-candidate': {
          const pc = pcRef.current
          // Candidates can outrun the offer/answer. Adding one before the remote description is set throws
          // and the candidate is gone for good — queue it and flush once the description is in.
          if (pc && pc.remoteDescription) {
            try { await pc.addIceCandidate(payload.candidate) } catch { /* stale candidate */ }
          } else {
            pendingIceRef.current.push(payload.candidate)
          }
          return
        }
      }
    } catch (error) {
      console.error('[call] signalling error', error)
      failCall(callId, 'Something went wrong setting up the call.')
    }
  }, [cleanup, clearTimers, createPc, failCall, flushIce, renegotiate, setPhase])

  const resolvePeerName = useCallback((callId: string, otherUserId: string) => {
    void getDisplayNames([otherUserId]).then((names) => {
      if (sessionRef.current?.id === callId) setPeerName(names[otherUserId] ?? 'Team member')
    })
  }, [])

  const startCallWith = useCallback(async (calleeId: string, type: 'voice' | 'video') => {
    if (phaseRef.current !== 'idle' || startingRef.current) {
      pushRef.current('Finish your current call first.', 'info')
      return
    }
    startingRef.current = true
    try {
      // Get the microphone BEFORE ringing anyone: if permission is denied we fail immediately with a clear
      // message instead of leaving the other person's phone ringing for a call that can never connect.
      let stream: MediaStream
      try {
        stream = await getLocalMedia(type === 'video')
      } catch (error) {
        pushRef.current(describeMediaError(error, type === 'video'), 'error')
        return
      }
      localStreamRef.current = stream
      setLocalStream(stream)

      const { data, error } = await startCall(calleeId, type)
      if (error || !data) {
        stopStream(stream)
        localStreamRef.current = null
        setLocalStream(null)
        pushRef.current(error?.message ?? 'Could not start the call.', 'error')
        return
      }

      isCallerRef.current = true
      setSession(data)
      setPhase('ringing-outgoing')
      startRingtone('outgoing')
      resolvePeerName(data.id, calleeId)

      const signal = openSignalingChannel(data.id)
      signalRef.current = signal
      try {
        await signal.open((payload) => void handleSignal(data.id, payload))
      } catch {
        if (sessionRef.current?.id === data.id) {
          void cancelCall(data.id)
          cleanup()
          pushRef.current('Could not reach the call service. Check your connection and try again.', 'error')
        }
        return
      }
      if (sessionRef.current?.id !== data.id) return // cancelled while connecting

      ringTimeoutRef.current = setTimeout(() => {
        if (sessionRef.current?.id !== data.id || phaseRef.current !== 'ringing-outgoing') return
        void markMissed(data.id)
        cleanup()
        pushRef.current('No answer.', 'info')
      }, RING_TIMEOUT_MS)
    } finally {
      startingRef.current = false
    }
  }, [cleanup, handleSignal, resolvePeerName, setPhase, setSession])

  const acceptIncoming = useCallback(async () => {
    const s = sessionRef.current
    if (!s || phaseRef.current !== 'ringing-incoming') return
    clearTimers()
    stopRingtone()
    setPhase('connecting')

    let stream: MediaStream
    try {
      stream = await getLocalMedia(s.type === 'video')
    } catch (error) {
      pushRef.current(describeMediaError(error, s.type === 'video'), 'error')
      void declineCall(s.id)
      cleanup()
      return
    }
    if (sessionRef.current?.id !== s.id) { stopStream(stream); return } // caller hung up during the permission prompt
    localStreamRef.current = stream
    setLocalStream(stream)

    createPc(s.id)
    const signal = openSignalingChannel(s.id)
    signalRef.current = signal
    try {
      await signal.open((payload) => void handleSignal(s.id, payload))
    } catch {
      void declineCall(s.id)
      cleanup()
      pushRef.current('Could not reach the call service. Check your connection and try again.', 'error')
      return
    }
    if (sessionRef.current?.id !== s.id) return

    const { error } = await acceptCall(s.id)
    if (error) {
      cleanup()
      pushRef.current('Could not answer the call.', 'error')
      return
    }

    // We are subscribed and the caller is waiting: say so, and keep saying so until an offer arrives.
    let attempts = 0
    const announce = () => {
      if (gotOfferRef.current || attempts >= READY_MAX_ATTEMPTS) {
        if (readyTimerRef.current) { clearInterval(readyTimerRef.current); readyTimerRef.current = null }
        return
      }
      attempts += 1
      signal.send({ kind: 'ready' })
    }
    announce()
    readyTimerRef.current = setInterval(announce, READY_RETRY_MS)
  }, [cleanup, clearTimers, createPc, handleSignal, setPhase])

  const declineIncoming = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    cleanup()
    await declineCall(s.id)
  }, [cleanup])

  const hangUp = useCallback(async () => {
    const s = sessionRef.current
    if (!s) { cleanup(); return }
    const wasRinging = phaseRef.current === 'ringing-outgoing'
    signalRef.current?.send({ kind: 'hangup' })
    cleanup() // instant UI feedback; the DB write follows
    await (wasRinging ? cancelCall(s.id) : endCall(s.id))
  }, [cleanup])

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

  const stopScreenShare = useCallback(async () => {
    const stream = screenRef.current
    if (!stream) return
    const pc = pcRef.current
    screenRef.current = null
    stopStream(stream)
    for (const sender of screenSendersRef.current) { try { pc?.removeTrack(sender) } catch { /* connection already closed */ } }
    screenSendersRef.current = []
    setScreenSharing(false)
    signalRef.current?.send({ kind: 'screen', on: false })
    await renegotiate()
  }, [renegotiate])
  useEffect(() => { stopScreenRef.current = stopScreenShare }, [stopScreenShare])

  const startScreenShare = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || phaseRef.current !== 'active' || screenRef.current) return
    if (!canShareScreenHere()) { pushRef.current("This device can't share its screen. Phones can't, but you can still present on the Presentation board.", 'info'); return }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name !== 'NotAllowedError' && name !== 'AbortError') pushRef.current('Could not start screen sharing.', 'error') // pressing Cancel in the picker is not an error
      return
    }
    if (!pcRef.current || phaseRef.current !== 'active') { stopStream(stream); return } // the call ended while the picker was open
    screenRef.current = stream
    setScreenSharing(true)
    const video = stream.getVideoTracks()[0]
    try { video.contentHint = 'detail' } catch { /* hint only */ }
    video.addEventListener('ended', () => { void stopScreenRef.current() }) // the browser's own "Stop sharing" button
    screenSendersRef.current = stream.getTracks().map((t) => pc.addTrack(t, stream))
    signalRef.current?.send({ kind: 'screen', on: true })
    await renegotiate()
  }, [renegotiate])

  const toggleScreenShare = useCallback(async () => {
    if (screenRef.current) await stopScreenShare()
    else await startScreenShare()
  }, [startScreenShare, stopScreenShare])

  // Incoming calls, from any page. Callback reads refs, so it never sees a stale phase/session.
  useEffect(() => {
    if (!profileId) return
    return listenForCalls(profileId, (call) => {
      if (call.status === 'ringing') {
        if (Date.now() - new Date(call.started_at).getTime() > RING_TIMEOUT_MS + 5_000) return // stale row
        if (phaseRef.current !== 'idle' || startingRef.current) { void declineCall(call.id); return } // busy
        isCallerRef.current = false
        setSession(call)
        setPhase('ringing-incoming')
        startRingtone('incoming')
        resolvePeerName(call.id, call.caller_id)
        ringTimeoutRef.current = setTimeout(() => {
          if (sessionRef.current?.id !== call.id || phaseRef.current !== 'ringing-incoming') return
          void markMissed(call.id)
          cleanup()
          pushRef.current('Missed call.', 'info')
        }, RING_TIMEOUT_MS)
        return
      }
      const current = sessionRef.current
      if (current && call.id === current.id && (call.status === 'cancelled' || call.status === 'ended' || call.status === 'missed')) {
        const wasRinging = phaseRef.current === 'ringing-incoming'
        cleanup()
        pushRef.current(wasRinging ? 'Missed call.' : 'The call ended.', 'info')
      }
    })
  }, [profileId, cleanup, resolvePeerName, setPhase, setSession])

  // The caller's view of what the callee did.
  useEffect(() => {
    if (!profileId) return
    return listenForOutgoingCallUpdates(profileId, (call) => {
      const current = sessionRef.current
      if (!current || call.id !== current.id || !isCallerRef.current) return
      if (call.status === 'accepted') {
        if (phaseRef.current === 'ringing-outgoing') {
          // Answered: stop ringing AND cancel the ring timeout. Leaving that timer armed would mark the call
          // "missed" and tear it down 45s in, mid-conversation.
          clearTimers()
          stopRingtone()
          setPhase('connecting')
        }
      } else if (call.status === 'declined') {
        cleanup()
        pushRef.current('Call declined.', 'info')
      } else if (call.status === 'ended' || call.status === 'missed' || call.status === 'cancelled') {
        cleanup()
      }
    })
  }, [profileId, cleanup, clearTimers, setPhase])

  // If connecting never completes (blocked network, dead signalling), don't sit on "Connecting…" forever.
  useEffect(() => {
    if (phase !== 'connecting') return
    const timer = setTimeout(() => {
      const s = sessionRef.current
      if (s && phaseRef.current === 'connecting') {
        failCall(s.id, "Couldn't connect the call. One of your networks may be blocking it — a TURN relay server can fix this.")
      }
    }, CONNECT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [phase, failCall])

  // Closing the tab mid-call: tell the other side instead of leaving them on a dead line.
  useEffect(() => {
    const onHide = () => {
      const s = sessionRef.current
      if (!s) return
      signalRef.current?.send({ kind: 'hangup' })
      void endCall(s.id)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  // Signing out (or unmounting) must never leave the microphone hot.
  useEffect(() => {
    if (!profileId && sessionRef.current) cleanup()
  }, [profileId, cleanup])
  useEffect(() => cleanup, [cleanup])

  const value = useMemo<CallState>(
    () => ({ phase, session, peerName, startedAt, localStream, remoteStream, muted, cameraOff, startCallWith, acceptIncoming, declineIncoming, hangUp, toggleMute, toggleCamera, canShareScreen: canShareScreenHere(), screenSharing, remoteScreen, toggleScreenShare }),
    [phase, session, peerName, startedAt, localStream, remoteStream, muted, cameraOff, startCallWith, acceptIncoming, declineIncoming, hangUp, toggleMute, toggleCamera, screenSharing, remoteScreen, toggleScreenShare],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used within CallProvider')
  return ctx
}
