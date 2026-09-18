import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GENERIC_ERROR = JSON.stringify({ error: 'Client ID or password is incorrect.' })

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

// Direct copy of resolve-worker-login's shape (see /docs/AUTH-RULES.md) —
// same reasons apply: the email is verified and consumed entirely
// server-side, never returned to the browser, and every failure path
// (unknown Client ID, no active client_users row, wrong password) returns
// an identical generic response.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const ip = clientIp(request)
  try {
    const { client_id, password } = await request.json()
    if (typeof client_id !== 'string' || !/^CTF-CLT-[A-Z0-9-]+$/i.test(client_id) || typeof password !== 'string' || password.length < 1) {
      return new Response(GENERIC_ERROR, { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_bucket: 'resolve-client-login',
      p_identifier: `${ip}:${client_id.toUpperCase()}`,
      p_max_attempts: 8,
      p_window_seconds: 300,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please wait a few minutes and try again.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: clientRow, error: clientError } = await admin
      .from('clients')
      .select('id')
      .eq('client_code', client_id.toUpperCase())
      .maybeSingle()
    if (clientError || !clientRow) {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // A company (clients row) can have more than one login (client_users
    // row) — pick the first active one. Most companies will have exactly one.
    const { data: clientUser, error: clientUserError } = await admin
      .from('client_users')
      .select('user_id,status')
      .eq('client_id', clientRow.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (clientUserError || !clientUser) {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { data: authUser, error: userError } = await admin.auth.admin.getUserById(clientUser.user_id)
    if (userError || !authUser.user?.email) {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: authUser.user.email, password })
    if (signInError || !signIn.session) {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    return new Response(
      JSON.stringify({ access_token: signIn.session.access_token, refresh_token: signIn.session.refresh_token }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch {
    return new Response(GENERIC_ERROR, { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
