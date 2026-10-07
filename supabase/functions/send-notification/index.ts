import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

type Audience =
  | { kind: 'user'; user_id: string }
  | { kind: 'project'; project_id: string }
  | { kind: 'workers' }
  | { kind: 'managers' }
  | { kind: 'everyone_internal' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  if (!(await enforceRateLimit(admin, request, 'send-notification', { maxEvents: 30, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }

  const caller = await authorizeCaller(admin, request)
  if (!caller) return forbiddenResponse(cors)

  try {
    const body = await request.json()
    const title = String(body.title ?? '').trim().slice(0, 200)
    const message = String(body.message ?? '').trim().slice(0, 2000)
    const audience = body.audience as Audience

    if (!title || !message || !audience?.kind) {
      return new Response(JSON.stringify({ error: 'A title, message, and audience are required.' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let recipientIds: string[] = []

    if (audience.kind === 'user') {
      // Any authenticated internal user may notify one specific person —
      // no broadcast permission needed for a 1:1 notification. Clients are
      // not valid targets here (this function is for internal notification
      // sending; client-facing notifications come from project update
      // publication, not this endpoint).
      if (caller.role === 'client') return forbiddenResponse(cors)
      recipientIds = [audience.user_id]
    } else if (audience.kind === 'project') {
      // Must actually be a member of the project to notify its members —
      // checked here explicitly since this function runs as service role
      // and bypasses project_members' RLS.
      const { data: membership } = await admin
        .from('project_members')
        .select('user_id')
        .eq('project_id', audience.project_id)
        .eq('user_id', caller.userId)
        .maybeSingle()
      if (!membership && caller.role !== 'superadmin') return forbiddenResponse(cors)
      const { data: members } = await admin.from('project_members').select('user_id').eq('project_id', audience.project_id)
      recipientIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== caller.userId)
    } else {
      // workers / managers / everyone_internal — broad audiences require
      // the notifications.broadcast permission (or superadmin).
      if (caller.role !== 'superadmin') {
        const { data: allowed } = await admin.rpc('has_permission_for', { p_user_id: caller.userId, p_permission_key: 'notifications.broadcast' })
        if (!allowed) return forbiddenResponse(cors)
      }
      const roleFilter = audience.kind === 'workers' ? ['worker'] : audience.kind === 'managers' ? ['manager'] : ['worker', 'manager', 'superadmin']
      const { data: recipients } = await admin.from('profiles').select('id').in('role', roleFilter)
      recipientIds = (recipients ?? []).map((r) => r.id).filter((id) => id !== caller.userId)
    }

    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { error } = await admin.from('notifications').insert(
      recipientIds.map((user_id) => ({ user_id, title, body: message })),
    )
    if (error) throw error

    await admin.from('audit_logs').insert({
      actor_user_id: caller.userId, action: 'notification.sent', resource_type: 'notifications',
      severity: 'info', metadata: { audience: audience.kind, recipient_count: recipientIds.length },
    })

    return new Response(JSON.stringify({ ok: true, sent: recipientIds.length }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('send-notification failed:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Unable to send this notification right now.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
