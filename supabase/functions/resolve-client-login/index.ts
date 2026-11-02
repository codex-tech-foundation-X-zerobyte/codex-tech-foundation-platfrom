import { adminClient, enforceRateLimitByKey, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GENERIC_ERROR = 'Invalid credentials'

function genericFailure(status: number) {
  return new Response(JSON.stringify({ error: GENERIC_ERROR }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  if (!(await enforceRateLimit(admin, request, 'resolve-client-login', { maxEvents: 10, windowSeconds: 300 }))) {
    return rateLimitedResponse(cors)
  }

  try {
    const { client_id } = await request.json()
    if (typeof client_id !== 'string' || !/^CTF-CLI-[A-Z0-9-]+$/i.test(client_id)) {
      return genericFailure(400)
    }
    const normalizedId = client_id.toUpperCase()

    if (!(await enforceRateLimitByKey(admin, `resolve-client-login-id:${normalizedId}`, { maxEvents: 8, windowSeconds: 300 }))) {
      return rateLimitedResponse(cors)
    }

    const { data, error } = await admin.from('client_users').select('user_id,status').eq('client_code', normalizedId).maybeSingle()

    if (error || !data || data.status !== 'active') {
      await admin.from('audit_logs').insert({
        action: 'login.failed', resource_type: 'client_users', success: false, severity: 'warning',
        metadata: { client_id: normalizedId, reason: !data ? 'not_found' : 'inactive' },
      })
      return genericFailure(401)
    }

    const { data: user, error: userError } = await admin.auth.admin.getUserById(data.user_id)
    if (userError || !user.user?.email) {
      await admin.from('audit_logs').insert({
        actor_user_id: data.user_id, action: 'login.failed', resource_type: 'client_users',
        resource_id: data.user_id, success: false, severity: 'error', metadata: { client_id: normalizedId, reason: 'no_auth_email' },
      })
      return genericFailure(401)
    }

    return new Response(JSON.stringify({ email: user.user.email }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch {
    return genericFailure(400)
  }
})
