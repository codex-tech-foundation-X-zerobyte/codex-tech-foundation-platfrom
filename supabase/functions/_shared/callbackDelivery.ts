import { isPublicIp, validateCallbackUrl } from './safeUrl.ts'
import { signWebhook } from './webhookSign.ts'

/**
 * Sends one queued callback. The network is injected so this is testable without one. Order of safety checks: validate the address,
 * resolve its name, require EVERY resolved address to be public, then POST without following redirects and with a short timeout.
 * (A name could in theory change its answer between the lookup and the connection; https and the no-redirect rule limit what that could
 * reach, and the response is never read or returned.)
 */
export interface Delivery { event_id: string; url: string; secret: string; event: string; payload: unknown; attempts: number }
export interface DeliveryDeps { fetch: typeof fetch; resolve: (host: string) => Promise<string[]>; nowMs: () => number; timeoutMs?: number }
export interface DeliveryResult { ok: boolean; http: number | null; error: string | null }

export async function deliver(d: Delivery, deps: DeliveryDeps): Promise<DeliveryResult> {
  const checked = validateCallbackUrl(d.url)
  if (!checked.ok) return { ok: false, http: null, error: `Blocked: ${checked.reason}` }
  let addresses: string[]
  try { addresses = await deps.resolve(checked.host) } catch { return { ok: false, http: null, error: 'The domain name could not be looked up.' } }
  if (addresses.length === 0) return { ok: false, http: null, error: 'The domain name has no address.' }
  if (!addresses.every(isPublicIp)) return { ok: false, http: null, error: 'Blocked: the domain resolves to a non-public address.' }

  const body = JSON.stringify(d.payload)
  const signature = await signWebhook(d.secret, Math.floor(deps.nowMs() / 1000), body)
  try {
    const res = await deps.fetch(checked.url.toString(), {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
      headers: { 'content-type': 'application/json', 'user-agent': 'Codex-Support-Callback/1', 'x-codex-event': d.event, 'x-codex-event-id': d.event_id, 'x-codex-delivery-attempt': String(d.attempts + 1), 'x-codex-signature': signature },
      body,
    })
    void res.body?.cancel().catch(() => {})   // the answer is not needed, and is never stored
    if (res.status >= 200 && res.status < 300) return { ok: true, http: res.status, error: null }
    if (res.status >= 300 && res.status < 400) return { ok: false, http: res.status, error: 'The address redirected; redirects are not followed.' }
    return { ok: false, http: res.status, error: `The receiver answered HTTP ${res.status}.` }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { ok: false, http: null, error: timedOut ? 'The receiver did not answer in time.' : 'Could not connect to the receiver.' }
  }
}
