import { adminClient, enforceRateLimit } from '../_shared/rateLimit.ts'
import { readTextLimited } from '../_shared/http.ts'
import { MONITOR_KEY_SHAPE, MONITOR_LIMITS, parseBatch, sha256Hex } from '../_shared/monitorIngest.ts'

/**
 * Receives error, latency and heartbeat events from one of the company's OWN registered projects (Super Monitor).
 *
 *   POST /functions/v1/monitor-ingest
 *   x-monitor-key: ctfm_…       (made by a Main Admin in Workspace → Super Monitor → Projects; shown once)
 *   { "events": [ { "event_id": "…", "kind": "error|message|latency|heartbeat", "level": "fatal|error|warning|info", "message": "…", … } ] }
 *
 * Deploy with --no-verify-jwt: the key is the authentication. A key can only WRITE telemetry for its own project, within a quota; it
 * cannot read anything, so it is safe to use from a browser (CORS is open for that reason). It can be revoked at any time.
 * Re-sending an event_id is harmless: it is counted once. Secrets in messages and stacks are redacted by the database before storage.
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-monitor-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400' }
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const key = (request.headers.get('x-monitor-key') ?? '').trim()
  if (!MONITOR_KEY_SHAPE.test(key)) return json({ error: 'Missing or malformed x-monitor-key.' }, 401)

  const admin = adminClient()
  // By IP first (cheap, so guessing keys is not free). Generous: many browsers can share one office address. The database adds a per-project quota.
  if (!(await enforceRateLimit(admin, request, 'monitor-ingest', { maxEvents: 600, windowSeconds: 60 }))) return json({ error: 'Too many requests. Slow down.' }, 429, { 'Retry-After': '60' })

  const raw = await readTextLimited(request, MONITOR_LIMITS.body)
  if (raw === null) return json({ error: 'Body too large.' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: 'Body must be JSON.' }, 400) }

  const parsed = parseBatch(body)
  if (!parsed.ok) return json({ error: parsed.error, reasons: parsed.reasons }, 400)
  if (parsed.events.length === 0) return json({ accepted: 0, duplicates: 0, rejected: 0, out_of_scope: 0 }, 202)

  const { data, error } = await admin.rpc('monitor_ingest', { p_key_hash: await sha256Hex(key), p_events: parsed.events })
  if (error) {
    if (error.code === '28000') return json({ error: 'Unknown, revoked or expired key.' }, 401)
    if (error.code === '54000') return json({ error: 'Event quota exceeded for this project. Retry in a minute.' }, 429, { 'Retry-After': '60' })
    if (error.code === '23514') return json({ error: 'The request was refused.' }, 400)
    console.error('monitor-ingest', error.code, error.message)
    return json({ error: 'Could not record the events.' }, 500)
  }
  const r = (data ?? {}) as { accepted?: number; duplicates?: number; rejected?: number; out_of_scope?: number }
  return json({ accepted: r.accepted ?? 0, duplicates: r.duplicates ?? 0, rejected: (r.rejected ?? 0) + parsed.rejected, out_of_scope: r.out_of_scope ?? 0, reasons: parsed.reasons }, 202)
})
