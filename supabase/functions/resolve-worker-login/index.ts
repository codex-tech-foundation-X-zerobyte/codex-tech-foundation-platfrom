import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GENERIC_ERROR = JSON.stringify({ error: 'Worker ID or password is incorrect.' })

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

// SECURITY NOTE (fixed in this pass): this function used to resolve worker_id
// to a raw email address and return it to the browser, which then called
// supabase.auth.signInWithPassword() itself. That meant any caller could learn
// a worker's real email by POSTing a worker_id + any password — a PII leak and
// enumeration vector regardless of whether the password was ever checked.
// Now the password is verified server-side (via a short-lived anon-key client,
// never the service role) and only a session is returned. The email never
// leaves this function.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const ip = clientIp(request)
  try {
    const { worker_id, password } = await request.json()
    if (typeof worker_id !== 'string' || !/^CTF-WKR-[A-Z0-9-]+$/i.test(worker_id) || typeof password !== 'string' || password.length < 1) {
      return new Response(GENERIC_ERROR, { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Rate limit per (IP, worker_id) so brute-forcing one account is capped
    // without one abusive IP being able to lock out attempts against every
    // other worker_id in the system. 8 attempts / 5 minutes.
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_bucket: 'resolve-worker-login',
      p_identifier: `${ip}:${worker_id.toUpperCase()}`,
      p_max_attempts: 8,
      p_window_seconds: 300,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please wait a few minutes and try again.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: worker, error: workerError } = await admin
      .from('worker_profiles')
      .select('user_id,status')
      .eq('worker_id', worker_id.toUpperCase())
      .maybeSingle()

    // Deliberately identical response whether the worker_id doesn't exist,
    // is suspended/banned/inactive, or the password (checked below) is wrong —
    // a different response for any of these turns this into an enumeration API.
    if (workerError || !worker || worker.status !== 'active') {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const { data: authUser, error: userError } = await admin.auth.admin.getUserById(worker.user_id)
    if (userError || !authUser.user?.email) {
      return new Response(GENERIC_ERROR, { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Verify the password using a plain (anon-key) client scoped to this one
    // request — this is the same check the browser used to do itself, just
    // moved server-side so the email is never exposed to the caller.
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
