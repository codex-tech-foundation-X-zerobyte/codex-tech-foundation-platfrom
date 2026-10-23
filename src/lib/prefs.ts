import { useSyncExternalStore } from 'react'

/**
 * Per-device preferences (sounds, desktop alerts, layout density). Stored in localStorage on purpose: they describe THIS
 * browser — a laptop in an open office and a phone are not meant to share them — so there's no server round trip.
 */
export interface Prefs {
  callSounds: boolean
  messageSounds: boolean
  desktopAlerts: boolean
  reducedMotion: boolean
  compact: boolean
  /** Preferred microphone / camera for calls (a MediaDeviceInfo.deviceId). Empty = the system default. */
  micId: string
  camId: string
}

export const DEFAULT_PREFS: Prefs = { callSounds: true, messageSounds: true, desktopAlerts: false, reducedMotion: false, compact: false, micId: '', camId: '' }
const KEY = 'ctf:prefs'
const EVENT = 'ctf:prefs-changed'

let cache: { raw: string | null; value: Prefs } | null = null

function read(): Prefs {
  let raw: string | null = null
  try { raw = globalThis.localStorage?.getItem(KEY) ?? null } catch { /* storage blocked: fall back to defaults */ }
  if (cache && cache.raw === raw) return cache.value // stable identity => useSyncExternalStore doesn't loop
  let value = DEFAULT_PREFS
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Prefs>
      value = { ...DEFAULT_PREFS }
      // Accept only values of the right TYPE for each key, so a corrupt or hand-edited value can't poison the app.
      for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
        if (typeof parsed[k] === typeof DEFAULT_PREFS[k]) (value as unknown as Record<string, unknown>)[k] = parsed[k]
      }
    } catch { /* corrupt value: ignore */ }
  }
  cache = { raw, value }
  return value
}

export const getPrefs = read

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  const next = { ...read(), [key]: value }
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)) } catch { /* storage blocked: preference lasts only this session */ }
  cache = null
  globalThis.dispatchEvent?.(new Event(EVENT))
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (notify) => {
      globalThis.addEventListener(EVENT, notify)
      globalThis.addEventListener('storage', notify) // another tab changed it
      return () => { globalThis.removeEventListener(EVENT, notify); globalThis.removeEventListener('storage', notify) }
    },
    read,
    () => DEFAULT_PREFS,
  )
}
