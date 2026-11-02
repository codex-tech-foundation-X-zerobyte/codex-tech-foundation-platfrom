import { adminClient, enforceRateLimit, enforceRateLimitByKey, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { readTextLimited } from '../_shared/http.ts'
import { KEY_SHAPE, sha256Hex } from '../_shared/supportIntake.ts'
import { CUSTOMER_LIMITS, answerForDbError, parseCustomerRequest } from '../_shared/supportCustomer.ts'

/**
 * What a customer may see and do about THEIR ticket, called by the connected project's BACKEND (never a browser: the key would be public).
 *
 *   POST /functions/v1/support-ticket        x-support-key: ctfs_…        (the same key as support-intake)
 *   { "action": "status",     "external_ref": "ORD-77" }
 *   { "action": "reply",      "external_ref": "ORD-77", "body": "Thanks, still broken." }
 *   { "action": "rating",     "external_ref": "ORD-77", "rating": 5, "note": "Quick!" }
 *   { "action": "attachment", "external_ref": "ORD-77", "attachment_id": "<id from status>" }   -> a link that works for 60 seconds
 *
 * Deploy with --no-verify-jwt: the project key is the authentication, and it only reaches that project's own tickets by external_ref.
 * Internal notes, assignees, escalations and internal attachments never appear in any answer. An unknown key and an unknown reference
 * get the same 404, so a caller learns nothing about what exists.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const key = (request.headers.get('x-support-key') ?? '').trim()
  if (!KEY_SHAPE.test(key)) return json({ error: 'Missing or malformed x-support-key.' }, 401)

  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, 'support-ticket', { maxEvents: 240, windowSeconds: 60 }))) return rateLimitedResponse({})
  const keyHash = await sha256Hex(key)
  if (!(await enforceRateLimitByKey(admin, `support-ticket:key:${keyHash.slice(0, 16)}`, { maxEvents: 600, windowSeconds: 60 }))) return rateLimitedResponse({})

  const raw = await readTextLimited(request, CUSTOMER_LIMITS.body)
  if (raw === null) return json({ error: 'Body too large.' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'Body must be JSON.' }, 400) }
  const parsed = parseCustomerRequest(body)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const r = parsed.request

  if (r.action === 'status') {
    const { data, error } = await admin.rpc('support_ticket_view', { p_key_hash: keyHash, p_external_ref: r.external_ref })
    if (error) { console.error('support-ticket status', error.code); return json({ error: 'Something went wrong. Try again.' }, 500) }
    return data ? json(data) : json({ error: 'Ticket not found.' }, 404)
  }
  if (r.action === 'reply' || r.action === 'rating') {
    const { error } = r.action === 'reply'
      ? await admin.rpc('support_customer_reply', { p_key_hash: keyHash, p_external_ref: r.external_ref, p_body: r.body })
      : await admin.rpc('support_customer_rating', { p_key_hash: keyHash, p_external_ref: r.external_ref, p_rating: r.rating, p_note: r.note })
    if (error) { const a = answerForDbError(error); if (a.status === 500) console.error('support-ticket', r.action, error.code); return json({ error: a.message }, a.status) }
    return json({ ok: true })
  }
  // attachment: only a file shared with the customer, on their own ticket, and only as a link that expires in a minute
  const { data: file, error: fileError } = await admin.rpc('support_attachment_path', { p_key_hash: keyHash, p_external_ref: r.external_ref, p_attachment: r.attachment_id })
  if (fileError) { console.error('support-ticket attachment', fileError.code); return json({ error: 'Something went wrong. Try again.' }, 500) }
  if (!file) return json({ error: 'Attachment not found.' }, 404)
  const { data: signed, error: signError } = await admin.storage.from('support-attachments').createSignedUrl((file as { path: string }).path, 60)
  if (signError || !signed) { console.error('support-ticket sign'); return json({ error: 'Something went wrong. Try again.' }, 500) }
  return json({ url: signed.signedUrl, name: (file as { name: string }).name, mime_type: (file as { mime_type: string }).mime_type, expires_in: 60 })
})
