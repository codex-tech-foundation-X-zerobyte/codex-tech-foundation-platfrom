// Webhook tester endpoint: anything sent to /functions/v1/webhook-inbox/<token> is stored against that inbox so a developer
// can see exactly what a service sends. PUBLIC by design (the sender has no Supabase session). Deploy with:
//   supabase functions deploy webhook-inbox --no-verify-jwt
// The unguessable token (two UUIDs) is the capability. Bodies are capped, credential and network-identity headers are dropped,
// and each inbox keeps only its latest 200 requests (database trigger).
import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { readTextLimited } from '../_shared/http.ts'
import { sanitizeHeaders, tokenFromPath, truncateBody } from '../_shared/webhook.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  const token = tokenFromPath(url.pathname)
  if (!token) return new Response(JSON.stringify({ error: 'Add your inbox token to the URL.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, `webhook-inbox:${token.slice(0, 8)}`, { maxEvents: 120, windowSeconds: 600 }))) return rateLimitedResponse(cors)

  const { data: inbox } = await admin.from('webhook_inboxes').select('id').eq('token', token).maybeSingle()
  if (!inbox) return new Response(JSON.stringify({ error: 'Unknown inbox.' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Read at most a little more than is kept: nobody needs to buffer a gigabyte to store 64 KB of it.
  const raw = request.method === 'GET' || request.method === 'HEAD' ? '' : ((await readTextLimited(request, 256 * 1024)) ?? null)
  if (raw === null) return new Response(JSON.stringify({ error: 'Body too large.' }), { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } })
  await admin.from('webhook_requests').insert({
    inbox_id: inbox.id, method: request.method, path: url.pathname.replace(/^.*\/webhook-inbox\/[^/]+/, '') || '/', query: url.search.slice(1, 2001),
    headers: sanitizeHeaders(request.headers), body: truncateBody(raw),
  })
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
})
