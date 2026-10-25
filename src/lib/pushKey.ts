// Kept apart from push.ts (which needs the browser and Supabase) so it can be unit-tested under Node.

/** Base64url public key → the byte array pushManager.subscribe() wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=').replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Rejects with `message` if `promise` has not settled within `ms`. The underlying work is left running. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/** True if a browser's existing subscription was made with this exact application server key. */
export function sameApplicationServerKey(existing: ArrayBuffer | ArrayBufferView | null | undefined, key: Uint8Array): boolean {
  if (!existing) return false
  const bytes = existing instanceof ArrayBuffer ? new Uint8Array(existing) : new Uint8Array(existing.buffer, existing.byteOffset, existing.byteLength)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

/** Turns the browser's cryptic subscribe() failures into something a person can act on. */
export function explainSubscribeError(err: unknown): Error {
  const name = (err as { name?: string })?.name ?? ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'NotAllowedError') return new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.')
  if (name === 'AbortError') return new Error("Your browser couldn't reach its push service. Check your connection or VPN. (In Brave, turn on “Use Google Services for Push Messaging” in brave://settings/privacy.)")
  if (name === 'InvalidAccessError' || name === 'InvalidCharacterError') return new Error("The notification key this site was set up with isn't valid. Ask the Main Admin to check VITE_VAPID_PUBLIC_KEY.")
  if (name === 'NotSupportedError') return new Error("This browser can't receive push notifications here. On iPhone, add the app to your Home Screen first.")
  return new Error(message || "Couldn't subscribe to push notifications.")
}
