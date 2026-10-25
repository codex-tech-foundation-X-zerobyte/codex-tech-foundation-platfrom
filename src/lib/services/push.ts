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
