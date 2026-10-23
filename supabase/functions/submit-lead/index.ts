import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, 'submit-lead', { maxEvents: 5, windowSeconds: 600 }))) {
    return rateLimitedResponse(cors)
  }
  try {
    const body = await request.json()
    const name = String(body.name ?? '').trim().slice(0, 200)
    const email = String(body.email ?? '').trim().slice(0, 200)
    const company = body.company ? String(body.company).trim().slice(0, 200) : null
    const source = String(body.source ?? 'website').trim().slice(0, 100)

    // Compose a single readable message from either a plain lead or a full "start a project" submission.
    const message = body.message
      ? String(body.message).trim().slice(0, 5000)
      : [
          body.project_type && `Project type: ${body.project_type}`,
          body.problem && `Problem: ${body.problem}`,
          body.desired_outcome && `Desired outcome: ${body.desired_outcome}`,
          body.budget && `Budget: ${body.budget}`,
          body.timeline && `Timeline: ${body.timeline}`,
          body.existing_system && `Existing system: ${body.existing_system}`,
          body.phone && `Phone: ${body.phone}`,
          body.additional_info && `Additional information: ${body.additional_info}`,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 5000)

    if (!name || !EMAIL_RE.test(email) || !message) {
      return new Response(JSON.stringify({ error: 'Please provide your name, a valid email, and a description of the project.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await admin.from('leads').insert({ name, email, company, message, source, status: 'new' })
    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to submit right now.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
