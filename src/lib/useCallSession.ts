import { useEffect, useRef, useState, useCallback } from 'react'
import { sendCallSignal, subscribeToCallSignaling, unsubscribe, type CallSignal } from './realtime'
import { joinCall, leaveCall, listParticipants } from './services/calls'
import { supabase } from './supabase'
import type { Call } from './types'

// Public STUN only — no TURN server is available in this environment (a
// TURN server needs real infrastructure/credentials to run, the same class
// of external dependency R2 was for storage). Calls between two peers who
// are both behind restrictive/symmetric NATs may fail to connect at all
// without one. This is a real, known limitation, not a silently-ignored
// edge case — see docs/REALTIME.md.
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

interface PeerEntry {
  connection: RTCPeerConnection
  pendingCandidates: RTCIceCandidateInit[]
}

export function useCallSession(call: Call | null) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(true)

  const peersRef = useRef<Map<string, PeerEntry>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const myIdRef = useRef<string | null>(null)
  const signalChannelRef = useRef<ReturnType<typeof subscribeToCallSignaling> | null>(null)

  const createPeerConnection = useCallback((remoteUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!))

    pc.onicecandidate = (event) => {
      if (event.candidate && signalChannelRef.current && myIdRef.current) {
        sendCallSignal(signalChannelRef.current, {
          type: 'ice-candidate',
          from: myIdRef.current,
          to: remoteUserId,
          candidate: event.candidate.toJSON(),
        })
      }
    }
    pc.ontrack = (event) => {
      setRemoteStreams((prev) => {
        const next = new Map(prev)
        next.set(remoteUserId, event.streams[0])
        return next
      })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setRemoteStreams((prev) => {
          const next = new Map(prev)
          next.delete(remoteUserId)
          return next
        })
      }
    }
    peersRef.current.set(remoteUserId, { connection: pc, pendingCandidates: [] })
    return pc
  }, [])

  const handleSignal = useCallback(async (signal: CallSignal) => {
    const me = myIdRef.current
    if (!me) return

    if (signal.type === 'hangup') {
      const entry = peersRef.current.get(signal.from)
      entry?.connection.close()
      peersRef.current.delete(signal.from)
      setRemoteStreams((prev) => {
        const next = new Map(prev)
        next.delete(signal.from)
        return next
      })
      return
    }

    if (signal.to !== me) return // not addressed to us — ignore (broadcast is per-call, not per-user)

    if (signal.type === 'offer') {
      const pc = peersRef.current.get(signal.from)?.connection ?? createPeerConnection(signal.from)
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
      const entry = peersRef.current.get(signal.from)
      if (entry) {
        for (const candidate of entry.pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(candidate))
        entry.pendingCandidates = []
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      if (signalChannelRef.current) sendCallSignal(signalChannelRef.current, { type: 'answer', from: me, to: signal.from, sdp: answer })
    } else if (signal.type === 'answer') {
      const pc = peersRef.current.get(signal.from)?.connection
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
    } else if (signal.type === 'ice-candidate') {
      const entry = peersRef.current.get(signal.from)
      if (entry?.connection.remoteDescription) {
        await entry.connection.addIceCandidate(new RTCIceCandidate(signal.candidate))
      } else if (entry) {
        entry.pendingCandidates.push(signal.candidate)
      }
    }
  }, [createPeerConnection])

  useEffect(() => {
    if (!call) return
    let cancelled = false

    const setup = async () => {
      setConnecting(true)
      setError(null)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      myIdRef.current = user.id

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' })
      } catch {
        if (!cancelled) { setError('Could not access your microphone/camera. Check your browser permissions.'); setConnecting(false) }
        return
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
      localStreamRef.current = stream
      setLocalStream(stream)

      await joinCall(call.id)

      const channel = subscribeToCallSignaling(call.id, (signal) => void handleSignal(signal))
      signalChannelRef.current = channel

      // Mesh join: offer to every participant already in the call. Anyone
      // who joins after us will offer to us instead (handled in
      // handleSignal's 'offer' branch) — so every pair ends up with
      // exactly one offer/answer exchange, not two racing ones.
      const { data: participants } = await listParticipants(call.id)
      for (const p of participants) {
        if (p.user_id === user.id || p.status !== 'joined') continue
        const pc = createPeerConnection(p.user_id)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendCallSignal(channel, { type: 'offer', from: user.id, to: p.user_id, sdp: offer })
      }
      if (!cancelled) setConnecting(false)
    }

    void setup()

    return () => {
      cancelled = true
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      peersRef.current.forEach((entry) => entry.connection.close())
      peersRef.current.clear()
      if (signalChannelRef.current && myIdRef.current) {
        sendCallSignal(signalChannelRef.current, { type: 'hangup', from: myIdRef.current })
        unsubscribe(signalChannelRef.current)
      }
      if (call) void leaveCall(call.id)
      setLocalStream(null)
      setRemoteStreams(new Map())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running on
    // handleSignal's identity (it changes when createPeerConnection does,
    // which is stable, so this is mostly theoretical) would tear down and
    // rejoin the call unnecessarily; only a different call.id should do that.
  }, [call?.id])

  const toggleMute = () => {
    const nextMuted = !muted
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !nextMuted))
    setMuted(nextMuted)
  }
  const toggleCamera = () => {
    const nextCameraOff = !cameraOff
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !nextCameraOff))
    setCameraOff(nextCameraOff)
  }

  return { localStream, remoteStreams, muted, cameraOff, connecting, error, toggleMute, toggleCamera }
}
