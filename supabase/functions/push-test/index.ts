import { adminClient, enforceRateLimitByKey, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'
import { isGoneStatus } from '../_shared/pushPayload.ts'
import { sendWebPush, validateVapid, type PushSubscriptionLike } from '../_shared/webpush.ts'

/**
 * "Send me a test notification" — and tell me, in plain words, which link of the chain is broken if it doesn't arrive.
 *
 * Signed-in people only (normal JWT verification — deploy WITHOUT --no-verify-jwt, unlike push-dispatch). It only ever pushes
 * to the caller's own devices, so it can't be used to notify anyone else.
 *
 * The chain it checks:  secrets set → keys valid → database knows where to send events → that address answers and accepts
 * our secret (this is where "deployed with JWT verification still on" shows up as 401) → this person has a registered device
 * → the push service accepts a real message for each device.
 */

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface Check { id: string; label: string; ok: boolean; detail: string }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const caller = await authorizeCaller(admin, request)
  if (!caller) return forbiddenResponse(cors)
  if (!(await enforceRateLimitByKey(admin, `push-test:${caller.userId}`, { maxEvents: 10, windowSeconds: 300 }))) return rateLimitedResponse(cors)

  const checks: Check[] = []
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail })

  // 1. Secrets
  const env = (name: string) => (Deno.env.get(name) ?? '').trim()
  const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') }
  const missing = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_WEBHOOK_SECRET'].filter((n) => !env(n))
  add('secrets', 'Server secrets are set', missing.length === 0,
    missing.length === 0 ? 'All four are present.' : `Missing: ${missing.join(', ')}. Run: supabase secrets set ${missing.map((n) => `${n}=…`).join(' ')}`)

  // 2. Keys
  const vapidProblem = missing.some((n) => n.startsWith('VAPID')) ? 'Set the VAPID secrets first.' : validateVapid(vapid)
  add('keys', 'VAPID keys are valid', vapidProblem === null, vapidProblem ?? 'The public and private keys decode correctly.')

  // 3. Does the database know where to send events?
  const { data: settings } = await admin.from('push_settings').select('function_url, webhook_secret').maybeSingle()
  add('settings', 'The database knows where to send events', Boolean(settings),
    settings ? `Events are sent to ${settings.function_url}` : 'The push_settings row is missing, so no event ever triggers a push. Insert it (see docs/NOTIFICATIONS.md, step 4).')

  // 4. Does that address answer and accept our secret?
  if (settings) {
    const urlOk = /^https:\/\/[^/]+\/functions\/v1\/push-dispatch\/?$/.test(settings.function_url)
    if (!urlOk) {
      add('hook', 'The event address is reachable', false, 'The function_url in push_settings should look like https://<project-ref>.supabase.co/functions/v1/push-dispatch')
    } else {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(settings.function_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-push-secret': settings.webhook_secret }, body: JSON.stringify({ type: 'PING', table: 'ping', record: {} }), signal: controller.signal })
        clearTimeout(timer)
        const hint: Record<number, string> = {
          200: 'push-dispatch answered and accepted the secret.',
          401: 'push-dispatch rejected the call before running (401). It was deployed WITH JWT verification — redeploy it: supabase functions deploy push-dispatch --no-verify-jwt',
          403: 'push-dispatch is running but the secret in push_settings does not match the PUSH_WEBHOOK_SECRET it was given. Make them identical.',
          404: 'Nothing is deployed at that address. Deploy it: supabase functions deploy push-dispatch --no-verify-jwt',
          503: 'push-dispatch is running but is missing its secrets or has an invalid key (see the checks above).',
        }
        add('hook', 'The event address answers and accepts the secret', res.status === 200, hint[res.status] ?? `push-dispatch answered with an unexpected status ${res.status}.`)
      } catch (err) {
        add('hook', 'The event address answers', false, (err as Error).name === 'AbortError' ? 'No answer within 8 seconds.' : `Could not reach it: ${(err as Error).message}`)
      }
    }
  }

  // 5. This person's devices
  const { data: subs } = await admin.from('push_subscriptions').select('id, subscription, user_agent').eq('user_id', caller.userId)
  add('device', 'This account has a registered device', (subs?.length ?? 0) > 0,
    (subs?.length ?? 0) > 0 ? `${subs?.length} device${subs?.length === 1 ? '' : 's'} registered.` : 'No device is registered for your account. Turn push on in Settings → Notifications on the device you want.')

  // 6. A real push to each device (only possible when the keys are fine)
  const devices: Array<{ service: string; ok: boolean; status: number; detail: string }> = []
  if (vapidProblem === null && subs?.length) {
    const message = JSON.stringify({ kind: 'test', title: 'Notifications are working', body: 'This is a test from Codex Tech Foundation.', url: '/', tag: 'push-test' })
    const gone: string[] = []
    for (const s of subs) {
      const sub = s.subscription as PushSubscriptionLike
      let service = 'unknown push service'
      try { service = new URL(sub.endpoint).hostname } catch { /* keep the generic label */ }
      const result = await sendWebPush(sub, message, vapid, { ttl: 60, urgency: 'high' })
      if (!result.ok && isGoneStatus(result.status)) gone.push(s.id as string)
      devices.push({
        service, ok: result.ok, status: result.status,
        detail: result.ok ? 'Accepted by the push service — it should appear within a few seconds.'
          : isGoneStatus(result.status) ? 'This device is no longer registered with its push service (it was removed). Turn push off and on again on it.'
          : result.status === 401 || result.status === 403 ? 'The push service rejected our keys. The device subscribed with a different VAPID_PUBLIC_KEY than the server now uses — turn push off and on again on that device.'
          : `The push service refused it (${result.status || 'no response'}): ${result.error ?? 'unknown error'}`,
      })
    }
    if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone)
  }
  if (devices.length) add('delivery', 'The push service accepted a test message', devices.every((d) => d.ok), devices.every((d) => d.ok) ? 'Every registered device accepted it.' : 'At least one device did not accept it — details below.')

  return json({ ok: checks.every((c) => c.ok), checks, devices })
})
