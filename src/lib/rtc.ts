/**
 * Shared WebRTC helpers for 1:1 and group calls.
 *
 * STUN alone connects most home/office networks but NOT symmetric NATs or strict corporate
 * firewalls — those need a TURN relay. Set VITE_TURN_URL (+ VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL)
 * to enable one; it is appended automatically. Without TURN, some pairs of people simply cannot connect.
 */
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
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  })
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}
