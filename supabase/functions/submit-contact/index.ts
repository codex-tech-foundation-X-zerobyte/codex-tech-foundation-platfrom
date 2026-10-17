import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, 'submit-contact', { maxEvents: 5, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }
  try {
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
