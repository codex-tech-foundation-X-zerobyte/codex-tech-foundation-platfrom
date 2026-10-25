import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { readTextLimited } from '../_shared/http.ts'
import { KEY_SHAPE, LIMITS, findSensitive, parseReport, sha256Hex } from '../_shared/supportIntake.ts'

/**
 * Receives a customer's report from a connected project's BACKEND and turns it into a support ticket.
 *
 *   POST /functions/v1/support-intake
 *   x-support-key: ctfs_…            (the project's key, made in Workspace → Support desk → Connected projects)
 *   { "external_ref": "ORD-77", "customer_ref": "user_9", "customer_name": "Ada", "subject": "...", "description": "...", "category": "bug", "priority": "high" }
 *
 * Deploy with --no-verify-jwt: the project key is the authentication. Never call this from a browser: the key would be public.
 * Sending the same external_ref again returns the same ticket ({ duplicate: true }), so retries are safe.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const key = (request.headers.get('x-support-key') ?? '').trim()
  if (!KEY_SHAPE.test(key)) return json({ error: 'Missing or malformed x-support-key.' }, 401)

  const admin = adminClient()
  // Throttle by IP first (cheap), so guessing keys is not free. The database adds a per-project limit on top.
  if (!(await enforceRateLimit(admin, request, 'support-intake', { maxEvents: 120, windowSeconds: 60 }))) return rateLimitedResponse({})

  const raw = await readTextLimited(request, LIMITS.body)
  if (raw === null) return json({ error: 'Body too large.' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'Body must be JSON.' }, 400) }

  const parsed = parseReport(body)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const sensitive = findSensitive(parsed.report)
  if (sensitive) return json({ error: `The report seems to contain ${sensitive}. Remove it and resend: tickets must not carry card numbers, passwords or secret keys.` }, 422)

  const r = parsed.report
  const { data, error } = await admin.rpc('support_intake', {
    p_key_hash: await sha256Hex(key), p_external_ref: r.external_ref, p_customer_ref: r.customer_ref, p_customer_name: r.customer_name,
    p_subject: r.subject, p_description: r.description, p_category: r.category, p_priority: r.priority,
  })
  if (error) {
    if (error.code === '28000') return json({ error: 'Unknown or revoked project key.' }, 401)
    if (error.code === '54000') return json({ error: 'Too many tickets from this project. Try again in a minute.' }, 429)
    console.error('support-intake', error.code, error.message)
    return json({ error: 'Could not record the report.' }, 500)
  }
  const row = Array.isArray(data) ? data[0] : data
  return json({ ticket: row?.ticket_ref, duplicate: Boolean(row?.duplicate) }, row?.duplicate ? 200 : 201)
})
