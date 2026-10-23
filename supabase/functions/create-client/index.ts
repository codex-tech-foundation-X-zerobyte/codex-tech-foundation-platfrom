import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse, generateTempPassword } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  if (!(await enforceRateLimit(admin, request, 'create-client', { maxEvents: 20, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }

  const caller = await authorizeCaller(admin, request)
  if (!caller) return forbiddenResponse(cors)
  if (caller.role !== 'superadmin') {
    const { data: allowed } = await admin.rpc('has_permission_for', { p_user_id: caller.userId, p_permission_key: 'clients.create' })
    if (!allowed) return forbiddenResponse(cors)
  }

  try {
    const body = await request.json()
    const contactName = String(body.contact_name ?? '').trim().slice(0, 200)
    const organization = String(body.organization ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200)
    const projectId = body.project_id ? String(body.project_id) : null

    if (!organization || !contactName || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Please provide a company name, contact name, and a valid email.' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Client company/account record.
    const { data: client, error: clientError } = await admin
      .from('clients')
      .insert({ organization, contact_name: contactName, contact_email: email, status: 'active', owner_id: caller.userId })
      .select('id').single()
    if (clientError || !client) throw clientError ?? new Error('Could not create the client account')

    const tempPassword = generateTempPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
    })
    if (createError || !created.user) throw createError ?? new Error('Could not create the login account')

    // provision_profile() trigger already created a 'client'-role profile —
    // that's already correct for a client account, just set the display name.
    await admin.from('profiles').update({ display_name: contactName, organization }).eq('id', created.user.id)

    // Client ID format mirrors Worker ID (CTF-WKR-xxxx) for consistency.
    let clientCode = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `CTF-CLI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      const { data: existing } = await admin.from('client_users').select('user_id').eq('client_code', candidate).maybeSingle()
      if (!existing) { clientCode = candidate; break }
    }
    if (!clientCode) throw new Error('Could not generate a unique Client ID')

    const { error: clientUserError } = await admin.from('client_users').insert({
      user_id: created.user.id, client_id: client.id, client_code: clientCode, status: 'active', must_change_password: true,
    })
    if (clientUserError) throw clientUserError

    if (projectId) {
      const { error: linkError } = await admin.from('client_projects').insert({ client_id: client.id, project_id: projectId })
      if (linkError) throw linkError
    }

    await admin.from('audit_logs').insert({
      actor_user_id: caller.userId, action: 'client.created', resource_type: 'clients',
      resource_id: client.id, severity: 'info', metadata: { organization },
    })

    return new Response(JSON.stringify({ client_id: clientCode, temp_password: tempPassword, user_id: created.user.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-client failed:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Unable to create this client account right now.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
