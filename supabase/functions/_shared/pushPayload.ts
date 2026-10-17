/**
 * What a push notification says and where tapping it goes. Kept free of Deno/Supabase imports so it can be unit-tested
 * under Node (tests/pushPayload.test.mjs) — the edge function only fetches the facts and calls these.
 */

export interface PushMessage {
  title: string
  body: string
  /** In-app path opened when the notification is tapped. Always same-origin and relative. */
  url: string
  /** Same tag replaces the previous notification instead of stacking (one per chat, one per call). */
  tag: string
  kind: 'notification' | 'chat' | 'call' | 'group-call'
  /** Calls stay on screen until answered or dismissed. */
  requireInteraction?: boolean
}

export const homePathForRole = (role: string | null | undefined) => (role === 'client' ? '/client' : role === 'worker' ? '/worker' : '/admin')

/** Collapses whitespace and cuts to `max` characters on a word boundary where it can. */
export function snippet(text: string | null | undefined, max = 120): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function notificationPush(n: { id?: string; title?: string | null; body?: string | null }, role: string | null | undefined): PushMessage {
  return {
    kind: 'notification',
    title: snippet(n.title, 80) || 'New notification',
    body: snippet(n.body, 140),
    url: `${homePathForRole(role)}/notifications`,
    tag: n.id ? `notification-${n.id}` : 'notification',
  }
}

export function chatPush(
  m: { channel_id: string; body?: string | null; attachments?: unknown },
  ctx: { senderName: string; channelType: string; channelName: string },
  role: string | null | undefined,
): PushMessage {
  const attachmentCount = Array.isArray(m.attachments) ? m.attachments.length : 0
  const text = snippet(m.body, 140)
  const body = text || (attachmentCount > 1 ? `Sent ${attachmentCount} attachments` : attachmentCount === 1 ? 'Sent an attachment' : 'New message')
  const isDirect = ctx.channelType === 'dm'
  return {
    kind: 'chat',
    title: isDirect ? ctx.senderName : `${ctx.senderName} in ${ctx.channelName || 'a channel'}`,
    // In a group the sender is already in the title; in a DM the title IS the sender. Either way the body is just the text.
    body,
    url: `${homePathForRole(role)}/chat?channel=${encodeURIComponent(m.channel_id)}`,
    tag: `chat-${m.channel_id}`,
  }
}

export function callPush(c: { id: string; type: string }, ctx: { callerName: string }, role: string | null | undefined): PushMessage {
  return {
    kind: 'call',
    title: `Incoming ${c.type === 'video' ? 'video' : 'voice'} call`,
    body: `${ctx.callerName} is calling you`,
    url: `${homePathForRole(role)}/chat`,
    tag: `call-${c.id}`,
    requireInteraction: true,
  }
}

export function groupCallPush(
  g: { id: string; channel_id: string; type: string },
  ctx: { starterName: string; channelName: string; isDirect: boolean },
  role: string | null | undefined,
): PushMessage {
  return {
    kind: 'group-call',
    title: `${ctx.starterName} started a ${g.type === 'video' ? 'video' : 'voice'} call`,
    body: ctx.isDirect ? 'Tap to join' : `in ${ctx.channelName || 'a channel'} — tap to join`,
    url: `${homePathForRole(role)}/chat?channel=${encodeURIComponent(g.channel_id)}`,
    tag: `gcall-${g.id}`,
    requireInteraction: true,
  }
}

/** True for the Web Push error codes that mean "this device is gone for good" — the subscription should be deleted. */
export const isGoneStatus = (status: number | undefined) => status === 404 || status === 410

/**
 * Should this person get a push for this kind of event? `prefs` is their notification_preferences row (or undefined if they
 * never saved one). Everything is allowed until switched off: the master `push` flag first, then the per-event setting.
 * 'general' (messages an admin sends on purpose) is never filterable.
 */
export function isPushAllowed(prefs: { push?: boolean | null; events?: Record<string, { push?: boolean }> | null } | undefined, kind: string): boolean {
  if (!prefs) return true
  if (prefs.push === false) return false
  if (kind === 'general') return true
  return prefs.events?.[kind]?.push !== false
}
