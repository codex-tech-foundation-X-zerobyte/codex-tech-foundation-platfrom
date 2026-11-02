import { adminClient } from '../_shared/rateLimit.ts'
import { sendWebPush, validateVapid, type PushSubscriptionLike } from '../_shared/webpush.ts'
import { callPush, chatPush, groupCallPush, isGoneStatus, isPushAllowed, notificationPush, type PushMessage } from '../_shared/pushPayload.ts'

/**
 * Delivers Web Push to people whose app is closed.
 *
 * Called ONLY by the database (public.dispatch_push(), through pg_net) with a shared secret — it is not a user-facing
 * endpoint, so deploy it with `--no-verify-jwt` (the secret is the authentication; see docs/NOTIFICATIONS.md).
 *
 * Secrets (supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@domain), PUSH_WEBHOOK_SECRET.
 * Without them the function answers 503 and nothing is sent — in-app notifications are unaffected.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Constant-time string comparison so the shared secret can't be recovered by timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

interface Target { userId: string; message: (role: string | null) => PushMessage }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // .trim(): a secret pasted with a trailing newline or space is the most common reason "it is set but nothing works".
  const secret = (Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '').trim()
  const vapid = { publicKey: (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim(), privateKey: (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').trim(), subject: (Deno.env.get('VAPID_SUBJECT') ?? '').trim() }
  if (!secret || !vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ error: 'Push is not configured.' }, 503)
  const vapidProblem = validateVapid(vapid)
  if (vapidProblem) { console.error('push-dispatch: ' + vapidProblem); return json({ error: vapidProblem }, 503) }
  if (!safeEqual((request.headers.get('x-push-secret') ?? '').trim(), secret)) return json({ error: 'Forbidden' }, 403)

  let payload: { table?: string; record?: Record<string, unknown> }
  try { payload = await request.json() } catch { return json({ error: 'Bad request' }, 400) }
  const record = payload.record
  if (!record || typeof payload.table !== 'string') return json({ error: 'Bad request' }, 400)

  const admin = adminClient()
  const name = async (id: string) => {
    const { data } = await admin.from('profiles').select('display_name').eq('id', id).maybeSingle()
    return (data?.display_name as string | undefined)?.trim() || 'A teammate'
  }

  const targets: Target[] = []
  let kind = 'general' // which per-event setting applies (notification_preferences.events[kind].push)
  let ttl = 60 * 60 * 24
  let urgency: 'high' | 'normal' = 'normal'

  try {
    switch (payload.table) {
      case 'notifications': {
        kind = typeof record.kind === 'string' ? record.kind : 'general'
        targets.push({ userId: String(record.user_id), message: (role) => notificationPush(record as { id?: string; title?: string; body?: string; kind?: string }, role) })
        break
      }
      case 'chat_messages': {
        kind = 'chat'
        if (record.deleted_at) return json({ ok: true, skipped: 'deleted' })
        const channelId = String(record.channel_id)
        const senderId = String(record.sender_id)
        const [{ data: channel }, { data: members }, senderName] = await Promise.all([
          admin.from('chat_channels').select('type, name').eq('id', channelId).maybeSingle(),
          admin.from('chat_channel_members').select('user_id').eq('channel_id', channelId),
          name(senderId),
        ])
        if (!channel) return json({ ok: true, skipped: 'no channel' })
        const ctx = { senderName, channelType: String(channel.type), channelName: String(channel.name ?? '') }
        for (const m of (members ?? []).slice(0, 500)) {
          if (m.user_id === senderId) continue
          targets.push({ userId: m.user_id as string, message: (role) => chatPush(record as { channel_id: string; body?: string; attachments?: unknown }, ctx, role) })
        }
        break
      }
      case 'calls': {
        kind = 'calls'
        ttl = 45 // a ring that nobody saw for a minute is no longer a call
        urgency = 'high'
        const callerName = await name(String(record.caller_id))
        targets.push({ userId: String(record.callee_id), message: (role) => callPush(record as { id: string; type: string }, { callerName }, role) })
        break
      }
      case 'group_calls': {
        kind = 'calls'
        ttl = 60
        urgency = 'high'
        const channelId = String(record.channel_id)
        const starterId = String(record.started_by)
        const [{ data: channel }, { data: members }, starterName] = await Promise.all([
          admin.from('chat_channels').select('type, name').eq('id', channelId).maybeSingle(),
          admin.from('chat_channel_members').select('user_id').eq('channel_id', channelId),
          name(starterId),
        ])
        const ctx = { starterName, channelName: String(channel?.name ?? ''), isDirect: channel?.type === 'dm' }
        for (const m of (members ?? []).slice(0, 500)) {
          if (m.user_id === starterId) continue
          targets.push({ userId: m.user_id as string, message: (role) => groupCallPush(record as { id: string; channel_id: string; type: string }, ctx, role) })
        }
        break
      }
      default:
        return json({ ok: true, skipped: 'unsupported table' })
    }

    if (targets.length === 0) return json({ ok: true, sent: 0 })
    const ids = [...new Set(targets.map((t) => t.userId))]

    // Skipped: people who switched push off entirely, or switched off THIS kind of event. No preference row = never said no.
    const [{ data: subs }, { data: prefs }, { data: roles }] = await Promise.all([
      admin.from('push_subscriptions').select('id, user_id, subscription').in('user_id', ids),
      admin.from('notification_preferences').select('user_id, push, events').in('user_id', ids),
      admin.from('profiles').select('id, role').in('id', ids),
    ])
    const prefsOf = new Map((prefs ?? []).map((p) => [p.user_id as string, p as { push?: boolean; events?: Record<string, { push?: boolean }> }]))
    const optedOut = new Set(ids.filter((id) => !isPushAllowed(prefsOf.get(id), kind)))
    const roleOf = new Map((roles ?? []).map((r) => [r.id as string, r.role as string]))
    const messageFor = new Map(targets.map((t) => [t.userId, t.message]))

    let sent = 0
    const gone: string[] = []
    const delivered: string[] = []
    await Promise.all((subs ?? []).map(async (s) => {
      const userId = s.user_id as string
      if (optedOut.has(userId)) return
      const build = messageFor.get(userId)
      if (!build) return
      const message = build(roleOf.get(userId) ?? null)
      const result = await sendWebPush(s.subscription as PushSubscriptionLike, JSON.stringify(message), vapid, { ttl, urgency })
      if (result.ok) { sent++; delivered.push(s.id as string) }
      else if (isGoneStatus(result.status)) gone.push(s.id as string)
      else console.error(`push failed for ${kind}: status ${result.status} ${result.error ?? ''}`)
    }))

    if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone)
    if (delivered.length) await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).in('id', delivered)
    return json({ ok: true, sent, removed: gone.length })
  } catch (err) {
    console.error('push-dispatch failed:', err instanceof Error ? err.message : err)
    return json({ error: 'Dispatch failed' }, 500)
  }
})
