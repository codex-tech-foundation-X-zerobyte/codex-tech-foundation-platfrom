import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      p_bucket: 'submit-contact',
      p_identifier: clientIp(request),
      p_max_attempts: 5,
      p_window_seconds: 600,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Too many submissions. Please try again in a few minutes.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const body = await request.json()
    const name = String(body.name ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().slice(0, 200)
    const message = String(body.message ?? '').trim().slice(0, 5000)

    if (!name || !EMAIL_RE.test(email) || !message) {
      return new Response(JSON.stringify({ error: 'Please provide your name, a valid email, and a message.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await admin.from('leads').insert({ name, email, message, source: 'contact', status: 'new' })
    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to send right now.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
