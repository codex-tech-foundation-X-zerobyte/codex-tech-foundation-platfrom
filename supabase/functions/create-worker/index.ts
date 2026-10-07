import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse, generateTempPassword } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  // This is an authenticated admin action, not a public form — rate limit
  // is a defense-in-depth backstop against a compromised admin session or
  // a scripting mistake hammering the endpoint, not the primary control.
  if (!(await enforceRateLimit(admin, request, 'create-worker', { maxEvents: 20, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }

  // Service-role calls bypass RLS entirely, so this function is the only
  // thing standing between "any authenticated user" and creating a worker
  // account. Worker creation is superadmin-only (matches the
  // "permission-scoped worker creates" RLS policy's intent even though RLS
  // itself can't run under the service-role key here).
  const caller = await authorizeCaller(admin, request)
  if (!caller || caller.role !== 'superadmin') return forbiddenResponse(cors)

  try {
    const body = await request.json()
    const displayName = String(body.name ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200)
    const phone = body.phone ? String(body.phone).trim().slice(0, 50) : null
    const position = String(body.position ?? '').trim().slice(0, 200)
    const departmentId = body.department_id ? String(body.department_id) : null
    const role = body.role === 'manager' ? 'manager' : 'worker' // only these two may be created here

    if (!displayName || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Please provide a name and a valid email.' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Worker ID format matches resolve-worker-login's validation regex.
    // Retry on the (extremely unlikely) chance of a collision.
    let workerId = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `CTF-WKR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      const { data: existing } = await admin.from('worker_profiles').select('user_id').eq('worker_id', candidate).maybeSingle()
      if (!existing) { workerId = candidate; break }
    }
    if (!workerId) throw new Error('Could not generate a unique Worker ID')

    const tempPassword = generateTempPassword()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
    })
    if (createError || !created.user) throw createError ?? new Error('Could not create the account')

    // provision_profile() trigger already inserted a default 'client' profile
    // row for this new auth user — update it to the intended role. The
    // on_profile_role_set trigger syncs user_roles automatically.
    const { error: profileError } = await admin
      .from('profiles')
      .update({ display_name: displayName, role })
      .eq('id', created.user.id)
    if (profileError) throw profileError

    const { error: workerProfileError } = await admin.from('worker_profiles').insert({
      user_id: created.user.id, worker_id: workerId, department_id: departmentId,
      position, phone, status: 'active', must_change_password: true, join_date: new Date().toISOString().slice(0, 10),
    })
    if (workerProfileError) throw workerProfileError

    await admin.from('audit_logs').insert({
      actor_user_id: caller.userId, action: 'worker.created', resource_type: 'worker_profiles',
      resource_id: created.user.id, severity: 'info', metadata: { worker_id: workerId, role },
    })

    // Temporary password is returned exactly once, in this response, to be
    // shown to the admin immediately — it is never stored in plaintext
    // anywhere and never logged (see generateTempPassword's contract and the
    // audit_logs insert above, which deliberately omits it).
    return new Response(JSON.stringify({ worker_id: workerId, temp_password: tempPassword, user_id: created.user.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-worker failed:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Unable to create this worker account right now.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
