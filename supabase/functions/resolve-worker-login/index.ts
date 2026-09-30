import { adminClient, enforceRateLimit, enforceRateLimitByKey, rateLimitedResponse } from '../_shared/rateLimit.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GENERIC_ERROR = 'Invalid credentials'

function genericFailure(status: number) {
  return new Response(JSON.stringify({ error: GENERIC_ERROR }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  // Rate limit by IP (broad anti-abuse) AND by the specific worker_id
  // (anti-brute-force against one account) — an attacker distributing
  // guesses across many IPs still can't hammer a single Worker ID.
  if (!(await enforceRateLimit(admin, request, 'resolve-worker-login', { maxEvents: 10, windowSeconds: 300 }))) {
    return rateLimitedResponse(cors)
  }

  try {
    const { worker_id } = await request.json()
    if (typeof worker_id !== 'string' || !/^CTF-WKR-[A-Z0-9-]+$/i.test(worker_id)) {
      return genericFailure(400)
    }
    const normalizedId = worker_id.toUpperCase()

    const perIdOk = await enforceRateLimitByKey(admin, `resolve-worker-login-id:${normalizedId}`, { maxEvents: 8, windowSeconds: 300 })
    if (!perIdOk) return rateLimitedResponse(cors)

    const { data, error } = await admin.from('worker_profiles').select('user_id,status').eq('worker_id', normalizedId).maybeSingle()

    if (error || !data || data.status !== 'active') {
      // Same generic response whether the ID doesn't exist, is suspended, or
      // is banned — the caller can't distinguish "no such worker" from
      // "exists but inactive" from the response alone.
      await admin.from('audit_logs').insert({
        action: 'login.failed', resource_type: 'worker_profiles', success: false, severity: 'warning',
        metadata: { worker_id: normalizedId, reason: !data ? 'not_found' : 'inactive' },
      })
      return genericFailure(401)
    }

    const { data: user, error: userError } = await admin.auth.admin.getUserById(data.user_id)
    if (userError || !user.user?.email) {
      await admin.from('audit_logs').insert({
        actor_user_id: data.user_id, action: 'login.failed', resource_type: 'worker_profiles',
        resource_id: data.user_id, success: false, severity: 'error', metadata: { worker_id: normalizedId, reason: 'no_auth_email' },
      })
      return genericFailure(401)
    }

    // Note: this endpoint only resolves Worker ID -> email; the actual
    // password check happens client-side via supabase.auth.signInWithPassword
    // immediately after, which is the real authentication boundary. We don't
    // log login.success here because we don't yet know if the password was
    // correct — that would misrepresent an ID lookup as a successful login.
    return new Response(JSON.stringify({ email: user.user.email }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch {
    return genericFailure(400)
  }
})
