import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// Deliberately simple and conservative rather than a full policy engine —
// length is the strongest single signal available without a breached-
// password list, which isn't in scope here.
function isStrongEnough(password: string): boolean {
  return password.length >= 10
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  if (!(await enforceRateLimit(admin, request, 'change-password', { maxEvents: 8, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }

  // Self-service only: the caller can only ever change their OWN password.
  // This function takes no target user id from the request body at all —
  // there is deliberately no way to pass one, so there's nothing to spoof.
  const caller = await authorizeCaller(admin, request)
  if (!caller) return forbiddenResponse(cors)

  try {
    const body = await request.json()
    const newPassword = String(body.new_password ?? '')
    if (!isStrongEnough(newPassword)) {
      return new Response(JSON.stringify({ error: 'Password must be at least 10 characters.' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(caller.userId, { password: newPassword })
    if (updateError) throw updateError

    // Clear the forced-change flag on whichever profile table applies —
    // harmless no-op update if the row doesn't exist for this user's role.
    await admin.from('worker_profiles').update({ must_change_password: false }).eq('user_id', caller.userId)
    await admin.from('client_users').update({ must_change_password: false }).eq('user_id', caller.userId)

    await admin.from('audit_logs').insert({
      actor_user_id: caller.userId, action: 'account.password_changed', resource_type: 'profiles',
      resource_id: caller.userId, severity: 'info', metadata: {},
    })

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('change-password failed:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Unable to change your password right now.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
