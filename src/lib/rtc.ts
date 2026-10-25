/**
 * Shared WebRTC helpers for 1:1 and group calls.
 *
 * STUN alone connects most home/office networks but NOT symmetric NATs or strict corporate
 * firewalls — those need a TURN relay. Set VITE_TURN_URL (+ VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL)
 * to enable one; it is appended automatically. Without TURN, some pairs of people simply cannot connect.
 */
import { getPrefs } from './prefs'

const env = import.meta.env as Record<string, string | undefined>

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(env.VITE_TURN_URL
    ? [{ urls: env.VITE_TURN_URL.split(',').map((u) => u.trim()), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }]
    : []),
]

/** Turns the opaque DOMException names from getUserMedia into something a person can act on. */
export function describeMediaError(error: unknown, wantsVideo: boolean): string {
  const device = wantsVideo ? 'microphone or camera' : 'microphone'
  if (!window.isSecureContext) return 'Calls need a secure connection (HTTPS). Open the app over https:// and try again.'
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser does not support calls. Try a recent Chrome, Edge, Firefox or Safari.'
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Access to your ${device} was blocked. Allow it in your browser's site settings, then try again.`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${device} was found. Plug one in and try again.`
  if (name === 'NotReadableError' || name === 'AbortError') return `Your ${device} is being used by another app. Close it and try again.`
  return `Could not access your ${device}.`
}

export async function getLocalMedia(video: boolean): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('unsupported', 'NotSupportedError')
  const { micId, camId } = getPrefs()
  const build = (useChosen: boolean): MediaStreamConstraints => ({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(useChosen && micId ? { deviceId: { exact: micId } } : {}) },
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', ...(useChosen && camId ? { deviceId: { exact: camId } } : {}) } : false,
  })
  try {
    return await navigator.mediaDevices.getUserMedia(build(true))
  } catch (error) {
    // The device chosen in Settings may be unplugged (or on another machine): fall back to the system default rather than failing the call.
    if ((micId || camId) && error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      return navigator.mediaDevices.getUserMedia(build(false))
    }
    throw error
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

export interface RelayTest { ok: boolean; ms: number; detail: string }

const isTurn = (s: RTCIceServer) => ([] as string[]).concat(s.urls).some((u) => /^turns?:/i.test(u))

/** TURN error codes (RFC 5766 / WebRTC) in words. */
function explainIceError(code: number, text: string): string {
  if (code === 401 || code === 403) return 'The TURN server rejected the username or credential. Check VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL.'
  if (code === 701) return 'Could not reach the TURN server. The address in VITE_TURN_URL may be wrong, or this network blocks it.'
  return `The TURN server reported an error (${code}${text ? `: ${text}` : ''}).`
}

/**
 * Proves the TURN relay works by asking the browser for relay-ONLY candidates. A normal call quietly falls back to STUN when
 * TURN is broken, so a misconfigured relay stays invisible until two people on strict networks can't connect. Returns null
 * when no TURN server is configured.
 */
export function testTurnRelay(timeoutMs = 8000, servers: RTCIceServer[] = ICE_SERVERS, PC: typeof RTCPeerConnection = RTCPeerConnection): Promise<RelayTest | null> {
  const turn = servers.filter(isTurn)
  if (turn.length === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    const started = performance.now()
    let lastError = ''
    let settled = false
    const pc = new PC({ iceServers: turn, iceTransportPolicy: 'relay' })
    const finish = (ok: boolean, detail: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pc.onicecandidate = null
      pc.onicecandidateerror = null
      pc.close()
      resolve({ ok, ms: Math.round(performance.now() - started), detail })
    }
    const timer = setTimeout(() => finish(false, lastError || `No relay address was allocated within ${timeoutMs / 1000}s. The TURN server is unreachable or blocked.`), timeoutMs)

    pc.onicecandidate = (e) => { if (e.candidate && /\btyp relay\b/.test(e.candidate.candidate)) finish(true, 'The TURN relay allocated an address — calls can connect through strict networks.') }
    pc.onicecandidateerror = (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent
      lastError = explainIceError(ev.errorCode, ev.errorText)
      if (ev.errorCode === 401 || ev.errorCode === 403) finish(false, lastError) // credentials are wrong: no point waiting
    }
    pc.createDataChannel('turn-probe') // gives the offer something to gather candidates for
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch((err) => finish(false, `Could not start the relay test: ${(err as Error).message}`))
  })
}
