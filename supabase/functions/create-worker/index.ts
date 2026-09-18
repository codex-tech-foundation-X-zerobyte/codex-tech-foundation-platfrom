import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

// Cryptographically random temporary password. Never logged, never stored —
// returned once in the function response for the admin to hand to the new
// worker, who must change it (worker_profiles.must_change_password defaults
// to true; enforcing that in the UI is still open, see /docs/AUTH-RULES.md).
function generateTempPassword() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return 'Ctf-' + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 16)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = request.headers.get('Authorization') ?? ''
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Two clients, two different trust levels:
    //  - `caller` carries the requesting user's own JWT, so RLS/has_permission()
    //    evaluate as THAT user. Used only to check authorization.
    //  - `admin` uses the service role and never leaves this function. Used
    //    only after authorization has already passed.
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: callerUser, error: callerError } = await caller.auth.getUser()
    if (callerError || !callerUser.user) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { data: canCreate } = await caller.rpc('has_permission', { permission_key: 'workers.create' })
    if (!canCreate) {
      return new Response(JSON.stringify({ error: 'You do not have permission to create workers.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: rateOk } = await admin.rpc('check_rate_limit', {
      p_bucket: 'create-worker',
      p_identifier: clientIp(request),
      p_max_attempts: 20,
      p_window_seconds: 600,
    })
    if (rateOk === false) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait a few minutes and try again.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const body = await request.json()
    const display_name = String(body.display_name ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200)
    const phone = body.phone ? String(body.phone).trim().slice(0, 40) : null
    const position = body.position ? String(body.position).trim().slice(0, 120) : ''
    const bio = body.bio ? String(body.bio).trim().slice(0, 2000) : ''
    // Only accept a manager assignment from a caller who could grant it — a
    // manager themselves can create workers but must never be able to spin up
    // a peer manager account by passing role: 'manager' in the body.
    const requestedRole = body.role === 'manager' ? 'manager' : 'worker'

    if (!display_name || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Please provide a name and a valid email address.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (requestedRole === 'manager') {
      const { data: canAssignManager } = await caller.rpc('has_permission', { permission_key: 'workers.suspend' })
      // No dedicated "can create managers" permission exists yet — restrict
      // manager creation to superadmin only (checked via profiles.role, the
      // one place a coarse role check is correct: this is exactly the kind
      // of "other CEO-only functionality" the brief reserves for Super Admin).
      const { data: callerProfile } = await caller.from('profiles').select('role').eq('id', callerUser.user.id).single()
      if (callerProfile?.role !== 'superadmin') {
        return new Response(JSON.stringify({ error: 'Only Super Admin can create Manager accounts.' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      void canAssignManager // reserved for a future granular managers.create permission
    }

    // Generate a unique Worker ID: CTF-WKR-NNNN, retried on collision.
    let workerId = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `CTF-WKR-${Math.floor(1000 + Math.random() * 9000)}`
      const { data: existing } = await admin.from('worker_profiles').select('user_id').eq('worker_id', candidate).maybeSingle()
      if (!existing) {
        workerId = candidate
        break
      }
    }
    if (!workerId) {
      return new Response(JSON.stringify({ error: 'Could not generate a unique Worker ID. Please try again.' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const tempPassword = generateTempPassword()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name },
    })
    if (createError || !created.user) {
      const message = createError?.message?.includes('already been registered')
        ? 'An account with this email already exists.'
        : 'Could not create the account. Please try again.'
      return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // profiles row is auto-created by the on_auth_user_created trigger with
    // role='client' — update it to the real role rather than relying on a
    // race with the trigger.
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: created.user.id, display_name, role: requestedRole }, { onConflict: 'id' })
    if (profileError) throw profileError

    const { error: workerProfileError } = await admin.from('worker_profiles').insert({
      user_id: created.user.id,
      worker_id: workerId,
      position,
      phone,
      bio,
      status: 'active',
      join_date: new Date().toISOString().slice(0, 10),
      must_change_password: true,
    })
    if (workerProfileError) throw workerProfileError

    const { data: roleRow } = await admin.from('roles').select('id').eq('name', requestedRole).maybeSingle()
    if (roleRow) {
      await admin.from('user_roles').insert({ user_id: created.user.id, role_id: roleRow.id }).select().maybeSingle()
    }

    await admin.from('audit_logs').insert({
      actor_user_id: callerUser.user.id,
      action: requestedRole === 'manager' ? 'manager.created' : 'worker.created',
      resource_type: 'worker_profiles',
      resource_id: created.user.id,
      severity: 'info',
      success: true,
      metadata: { worker_id: workerId, email },
    })

    return new Response(
      JSON.stringify({ user_id: created.user.id, worker_id: workerId, email, temporary_password: tempPassword, role: requestedRole }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to create the account right now.' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
