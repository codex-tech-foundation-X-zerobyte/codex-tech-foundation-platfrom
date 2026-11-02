import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { readTextLimited } from '../_shared/http.ts'
import { MAX_WEBHOOK_BYTES, processDelivery } from '../_shared/githubWebhook.ts'

/**
 * Receives GitHub App webhooks.
 *
 *   POST /functions/v1/github-webhook      x-hub-signature-256: sha256=<hmac of the raw body>   x-github-delivery: <uuid>   x-github-event: <name>
 *
 * Deploy with --no-verify-jwt: GitHub cannot send a Supabase JWT. The HMAC signature IS the authentication, checked before anything is
 * parsed or stored. The secret is GITHUB_WEBHOOK_SECRET (an Edge Function secret, never in a table). A repeated delivery id is answered
 * 200 "duplicate" and changes nothing, so GitHub's retries and any replay are harmless. Only repositories the Main Admin linked get feed rows.
 */
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const admin = adminClient()
  // GitHub delivers from a published set of addresses and is busy during pushes; this is a generous per-IP ceiling, not the security control.
  if (!(await enforceRateLimit(admin, request, 'github-webhook', { maxEvents: 600, windowSeconds: 60 }))) return rateLimitedResponse({})
  const raw = await readTextLimited(request, MAX_WEBHOOK_BYTES + 1)
  if (raw === null) return json({ error: 'Payload too large.' }, 413)

  try {
    const result = await processDelivery({
      secret: Deno.env.get('GITHUB_WEBHOOK_SECRET'),
      record: async (a) => {
        const row = a.row
        const { data, error } = await admin.rpc('record_github_delivery', {
          p_delivery: a.delivery, p_event: a.event, p_action: a.action, p_repo: a.repo, p_outcome: a.outcome, p_detail: a.detail,
          p_kind: row?.kind ?? null, p_title: row?.title ?? null, p_actor: row?.actor ?? null, p_url: row?.url ?? null, p_state: row?.state ?? null, p_occurred: row?.occurred_at ?? null,
        })
        if (error) throw new Error('record failed')   // surfaces as a 500 so GitHub retries; the message is never returned
        return data as 'recorded' | 'ignored' | 'duplicate'
      },
      upsertInstallation: async (c) => {
        const { error } = await admin.rpc('upsert_github_installation', { p_id: c.installation_id, p_login: c.account_login, p_type: c.account_type, p_selection: c.repository_selection, p_action: c.action })
        if (error) throw new Error('installation failed')
      },
    }, request.headers, raw)
    return json(result.body, result.status)
  } catch {
    return json({ error: 'Could not process the delivery.' }, 500)   // no detail: the body of a failure must not leak internals
  }
})
