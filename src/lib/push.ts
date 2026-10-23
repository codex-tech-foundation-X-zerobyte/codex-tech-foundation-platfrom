import { registerPushSubscription, removePushSubscription } from './services'
import { explainSubscribeError, sameApplicationServerKey, urlBase64ToUint8Array, withTimeout } from './pushKey'

/**
 * Web Push for the signed-in person's device. Registration lives here; delivery happens server-side in the
 * push-dispatch edge function and the service worker (public/sw.js) shows the notification.
 */

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? ''
const ACTIVE_FLAG = 'ctf:push-active'

export type PushStatus =
  | 'unsupported'    // this browser has no Push API
  | 'needs-install'  // iPhone/iPad: push only works once the app is added to the Home Screen
  | 'not-configured' // the deployment has no VAPID key yet
  | 'denied'         // the person blocked notifications in the browser
  | 'off'
  | 'on'

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

export const pushApisAvailable = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** True when THIS device is registered — the in-tab desktop alerts stand down so one event isn't announced twice. */
export function isPushActive(): boolean {
  try { return globalThis.localStorage?.getItem(ACTIVE_FLAG) === '1' } catch { return false }
}
function setPushActive(on: boolean) {
  try { if (on) globalThis.localStorage?.setItem(ACTIVE_FLAG, '1'); else globalThis.localStorage?.removeItem(ACTIVE_FLAG) } catch { /* storage blocked: only affects de-duplication */ }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushApisAvailable()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on'
  return 'off'
}

async function register(sub: PushSubscription) {
  const { error } = await registerPushSubscription(sub)
  if (error) throw error
}

const BLOCKED = 'Notifications are blocked for this site. Allow them in your browser settings (the lock or bell icon next to the address bar), then try again.'
const SW_MESSAGE = "The background service that delivers notifications didn't start. Reload the page (Ctrl+Shift+R, or pull to refresh) and try again."
const PERMISSION_WAIT = 'Your browser is still waiting for you to answer its notification prompt. Look next to the address bar (a bell or lock icon) and choose Allow, then press Turn on again.'

/** The service worker registration, starting the worker if the page hasn't (it only auto-registers in production builds). */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  try {
    if (!(await navigator.serviceWorker.getRegistration())) await withTimeout(navigator.serviceWorker.register('/sw.js'), 10_000, SW_MESSAGE)
  } catch (err) {
    throw new Error(err instanceof Error && err.message !== SW_MESSAGE ? `${SW_MESSAGE} (${err.message})` : SW_MESSAGE)
  }
  return withTimeout(navigator.serviceWorker.ready, 15_000, SW_MESSAGE)
}

/**
 * A subscription this browser holds that was made with a DIFFERENT key (the key was changed after someone first turned
 * notifications on) can never receive our pushes — the push service rejects them — and subscribe() refuses to replace it.
 * So a stale one is dropped and replaced.
 */
async function subscribeWithCurrentKey(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  const existing = await reg.pushManager.getSubscription()
  if (existing && sameApplicationServerKey(existing.options?.applicationServerKey, key)) return existing
  if (existing) await existing.unsubscribe().catch(() => undefined)
  try {
    return await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }),
      20_000,
      "Your browser didn't answer in time when connecting to its push service. Check your connection or VPN and try again.",
    )
  } catch (err) {
    throw explainSubscribeError(err)
  }
}

/**
 * Asks permission (must be called from a click), subscribes this device and registers it. Every step has a time limit and a
 * plain-English failure, so the button can never just spin: it either finishes or says what to do. `onStatus` narrates progress.
 */
export async function enablePush(onStatus?: (message: string) => void): Promise<void> {
  if (!pushApisAvailable()) throw new Error('This browser does not support push notifications.')
  if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not set up on this deployment yet.')
  if (Notification.permission === 'denied') throw new Error(BLOCKED)

  if (Notification.permission === 'default') {
    onStatus?.('Waiting for you to allow notifications in your browser…')
    const result = await withTimeout(Notification.requestPermission(), 60_000, PERMISSION_WAIT)
    if (result !== 'granted') throw new Error(BLOCKED)
  }

  onStatus?.('Starting the notification service…')
  const reg = await readyRegistration()
  onStatus?.("Connecting to your browser's push service…")
  const sub = await subscribeWithCurrentKey(reg)
  onStatus?.('Saving…')
  await withTimeout(register(sub), 15_000, "Couldn't reach the server to save this device. Check your connection and try again.")
  setPushActive(true)
}

/** Turns push off for this device: unsubscribes the browser and removes the server record. */
export async function disablePush(): Promise<void> {
  const sub = pushApisAvailable() ? await currentSubscription() : null
  if (sub) {
    await removePushSubscription(sub.endpoint)
    await sub.unsubscribe()
  }
  setPushActive(false)
}

/**
 * On sign-in / app start: if this device already has permission, make sure the server knows its CURRENT credentials
 * (browsers rotate them) and that the record belongs to whoever is signed in now. Silent — never prompts.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!pushApisAvailable() || !VAPID_PUBLIC_KEY || Notification.permission !== 'granted') return setPushActive(false)
    const reg = await withTimeout(navigator.serviceWorker.ready, 15_000, SW_MESSAGE)
    // Only a person who turned push on has a subscription; do not create one silently for someone who never asked.
    if (!(await reg.pushManager.getSubscription())) return setPushActive(false)
    // Already opted in, so replacing a stale-key subscription here is repair, not a new request.
    await register(await subscribeWithCurrentKey(reg))
    setPushActive(true)
  } catch { /* best effort: push is an extra channel, never a reason to break sign-in */ }
}

/** Call BEFORE signing out: this browser must stop receiving the previous person's notifications. */
export async function detachPushOnSignOut(): Promise<void> {
  try {
    const sub = pushApisAvailable() ? await currentSubscription() : null
    if (sub) {
      await removePushSubscription(sub.endpoint)
      await sub.unsubscribe()
    }
  } catch { /* signing out must always succeed */ }
  setPushActive(false)
}
