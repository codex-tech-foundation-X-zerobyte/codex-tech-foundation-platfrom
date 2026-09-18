import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

function generateTempPassword() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return 'Ctf-' + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 16)
}

// Same two-client trust split as create-worker: `caller` carries the
// requesting user's own JWT (used only for the permission check), `admin`
// uses the service role and never leaves this function.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = request.headers.get('Authorization') ?? ''
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: callerUser, error: callerError } = await caller.auth.getUser()
    if (callerError || !callerUser.user) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { data: canCreate } = await caller.rpc('has_permission', { permission_key: 'clients.create' })
    if (!canCreate) {
      return new Response(JSON.stringify({ error: 'You do not have permission to create clients.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: rateOk } = await admin.rpc('check_rate_limit', {
      p_bucket: 'create-client',
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
    const contact_name = String(body.contact_name ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200)
    // Either attach a new login to an existing company (client_id provided)
    // or create a brand-new company record (organization name provided).
    const existing_client_id = body.client_id ? String(body.client_id) : null
    const organization = String(body.organization ?? '').trim().slice(0, 200)
    const project_ids: string[] = Array.isArray(body.project_ids) ? body.project_ids.map(String) : []

    if (!contact_name || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Please provide a contact name and a valid email address.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (!existing_client_id && !organization) {
      return new Response(JSON.stringify({ error: 'Please provide an organization name, or select an existing client to add a login for.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let clientId = existing_client_id
    let clientCode: string | null = null

    if (!clientId) {
      // Generate a unique Client ID: CTF-CLT-NNNN, retried on collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `CTF-CLT-${Math.floor(1000 + Math.random() * 9000)}`
        const { data: taken } = await admin.from('clients').select('id').eq('client_code', candidate).maybeSingle()
        if (!taken) { clientCode = candidate; break }
      }
      if (!clientCode) {
        return new Response(JSON.stringify({ error: 'Could not generate a unique Client ID. Please try again.' }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      const { data: newClient, error: clientError } = await admin
        .from('clients')
        .insert({ organization, contact_name, contact_email: email, client_code: clientCode, status: 'active' })
        .select('id')
        .single()
      if (clientError || !newClient) throw clientError ?? new Error('Could not create the client record.')
      clientId = newClient.id
    } else {
      const { data: found } = await admin.from('clients').select('id, client_code').eq('id', clientId).maybeSingle()
      if (!found) {
        return new Response(JSON.stringify({ error: 'The selected client could not be found.' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      clientCode = found.client_code
    }

    if (project_ids.length) {
      await admin.from('client_projects').upsert(
        project_ids.map((project_id) => ({ client_id: clientId, project_id })),
        { onConflict: 'client_id,project_id' },
      )
    }

    const tempPassword = generateTempPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name: contact_name },
    })
    if (createError || !created.user) {
      const message = createError?.message?.includes('already been registered')
        ? 'An account with this email already exists.'
        : 'Could not create the account. Please try again.'
      return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: created.user.id, display_name: contact_name, role: 'client' }, { onConflict: 'id' })
    if (profileError) throw profileError

    const { error: clientUserError } = await admin
      .from('client_users')
      .insert({ user_id: created.user.id, client_id: clientId, status: 'active' })
    if (clientUserError) throw clientUserError

    await admin.from('audit_logs').insert({
      actor_user_id: callerUser.user.id,
      action: 'client.created',
      resource_type: 'client_users',
      resource_id: created.user.id,
      severity: 'info',
      success: true,
      metadata: { client_id: clientId, client_code: clientCode, email },
    })

    return new Response(
      JSON.stringify({ user_id: created.user.id, client_id: clientId, client_code: clientCode, email, temporary_password: tempPassword }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to create the account right now.' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
