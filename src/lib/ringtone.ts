/**
 * Tiny WebAudio ringtone/ringback so a ringing call is actually audible.
 * Synthesised (no audio files to ship). Browsers may refuse to start audio before the user has
 * interacted with the page — that failure is swallowed; the visual banner is still shown.
 */
import { getPrefs } from './prefs'

let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | null = null

function beep(freq: number, start: number, dur: number, volume: number) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const t0 = ctx.currentTime + start
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02)
  gain.gain.setValueAtTime(volume, t0 + dur - 0.05)
  gain.gain.linearRampToValueAtTime(0, t0 + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function startRingtone(kind: 'incoming' | 'outgoing') {
  stopRingtone()
  if (!getPrefs().callSounds) return // the person turned call sounds off in Settings
  try {
    ctx = new AudioContext()
    void ctx.resume().catch(() => {})
    const pattern = () => {
      if (kind === 'incoming') { beep(880, 0, 0.18, 0.09); beep(660, 0.22, 0.18, 0.09); beep(880, 0.6, 0.18, 0.09); beep(660, 0.82, 0.18, 0.09) }
      else { beep(425, 0, 1.0, 0.04) }
    }
    pattern()
    timer = setInterval(pattern, kind === 'incoming' ? 2600 : 3600)
  } catch {
    /* audio unavailable or blocked — visual ringing still works */
  }
}

export function stopRingtone() {
  if (timer) { clearInterval(timer); timer = null }
  if (ctx) { void ctx.close().catch(() => {}); ctx = null }
}

/** A short, soft two-note chime for non-call alerts (a new message, a group call starting). Respects the message-sound setting. */
export function playChime() {
  if (!getPrefs().messageSounds) return
  try {
    const c = new AudioContext()
    void c.resume().catch(() => {})
    const note = (freq: number, at: number) => {
      const osc = c.createOscillator(); const gain = c.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      const t = c.currentTime + at
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.07, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      osc.connect(gain).connect(c.destination); osc.start(t); osc.stop(t + 0.4)
    }
    note(784, 0); note(1047, 0.12)
    setTimeout(() => void c.close().catch(() => {}), 800)
  } catch { /* audio blocked until the user has interacted — silent is fine */ }
}
