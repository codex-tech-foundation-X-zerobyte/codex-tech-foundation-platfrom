import { supabase } from '../supabase'
import { toError } from './shared'

/** Server side of push registration. The browser side (permission, subscribe) lives in lib/push.ts. */

/** Registers this browser for the signed-in user. Takes the endpoint over if a previous person used this browser. */
export async function registerPushSubscription(sub: PushSubscription) {
  const { error, status } = await supabase.rpc('register_push_subscription', {
    p_endpoint: sub.endpoint,
    p_subscription: sub.toJSON(),
    p_user_agent: navigator.userAgent,
  })
  return { error: toError(error, status) }
}

/** Forgets this browser. Deleting by endpoint only ever matches the signed-in user's own row (RLS). */
export async function removePushSubscription(endpoint: string) {
  const { error, status } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return { error: toError(error, status) }
}

export interface PushCheck { id: string; label: string; ok: boolean; detail: string }
export interface PushDeviceResult { service: string; ok: boolean; status: number; detail: string }
export interface PushTestReport { ok: boolean; checks: PushCheck[]; devices: PushDeviceResult[] }

/** Sends a real test push to the signed-in person's own devices and returns a step-by-step diagnosis of the whole chain. */
export async function sendTestPush(): Promise<{ data: PushTestReport | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke('push-test', { body: {} })
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status
    if (status === 404) return { data: null, error: new Error("The test function isn't deployed yet. Run: supabase functions deploy push-test") }
    if (status === 401 || status === 403) return { data: null, error: new Error('You need to be signed in to run the test.') }
    if (status === 429) return { data: null, error: new Error('Too many tests — wait a few minutes and try again.') }
    return { data: null, error: new Error("Couldn't reach the test function. Check your connection, or that it has been deployed (supabase functions deploy push-test).") }
  }
  return { data: data as PushTestReport, error: null }
}

/* ── the notification checkup: a REAL test notification through the database trigger, and what happened to it ── */
export interface PushSetupSummary { configured: boolean; secret_set: boolean; function_host: string | null; function_path_ok: boolean; devices: number; pg_net_available: boolean }
export async function pushSetupSummary(): Promise<{ data: PushSetupSummary | null; error: Error | null }> {
  const { data, error, status } = await supabase.rpc('push_setup_summary')
  return { data: (data as PushSetupSummary | null) ?? null, error: toError(error, status) }
}
export async function sendTestNotification(): Promise<{ id: string | null; error: Error | null }> {
  const { data, error, status } = await supabase.rpc('send_test_notification')
  return { id: (data as string | null) ?? null, error: toError(error, status) }
}
export interface PushDispatchResult { handed_over: boolean; configured?: boolean; pg_net_available: boolean; error?: string | null; answered?: boolean; status_code?: number | null; content?: string | null }
export async function pushDispatchResult(notificationId: string): Promise<{ data: PushDispatchResult | null; error: Error | null }> {
  const { data, error, status } = await supabase.rpc('push_dispatch_result', { p_notification: notificationId })
  return { data: (data as PushDispatchResult | null) ?? null, error: toError(error, status) }
}
/**
 * Starts listening for new notifications for this person BEFORE a test is sent (a listener started afterwards would miss it).
 * `ready` resolves once the channel is subscribed; `arrived(id, ms)` says whether that notification reached this tab live.
 */
export function listenForLiveNotifications(userId: string) {
  const seen = new Set<string>()
  const waiting = new Map<string, () => void>()
  let resolveReady: (ok: boolean) => void = () => undefined
  const ready = new Promise<boolean>((r) => { resolveReady = r })
  const channel = supabase.channel(`checkup:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
      const id = (p.new as { id?: string }).id
      if (!id) return
      seen.add(id); waiting.get(id)?.()
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') resolveReady(true); else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolveReady(false) })
  const readyOrTimeout = Promise.race([ready, new Promise<boolean>((r) => setTimeout(() => r(false), 5000))])
  return {
    ready: readyOrTimeout,
    arrived: (id: string, ms = 8000) => new Promise<boolean>((resolve) => {
      if (seen.has(id)) return resolve(true)
      const timer = setTimeout(() => { waiting.delete(id); resolve(false) }, ms)
      waiting.set(id, () => { clearTimeout(timer); waiting.delete(id); resolve(true) })
    }),
    stop: () => void supabase.removeChannel(channel),
  }
}
/** Does the server hold this browser's endpoint? (RLS: you only ever see your own rows.) */
export async function isEndpointRegistered(endpoint: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1)
  return error ? null : (data ?? []).length > 0
}
