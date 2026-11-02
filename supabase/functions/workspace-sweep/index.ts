import { adminClient } from '../_shared/rateLimit.ts'
import { deliver, type Delivery } from '../_shared/callbackDelivery.ts'

/**
 * The workspace's periodic work, in one place. Call it every minute or two:
 *   - Super Monitor: open an incident for a project that stopped sending heartbeats, escalate unacknowledged incidents, delete old raw events;
 *   - Customer Service: tell people about tickets that are late or unassigned (once each), and about resolved incidents behind tickets;
 *   - callbacks: deliver the queued, signed messages to connected projects' backends, retry the ones that failed, purge the old ones.
 *
 *   POST /functions/v1/workspace-sweep        x-sweep-secret: <WORKSPACE_SWEEP_SECRET>
 *
 * Deploy with --no-verify-jwt: the shared secret is the authentication, and without WORKSPACE_SWEEP_SECRET set the function refuses to run.
 * Each part runs on its own: one failing never stops the others. Replaces the earlier monitor-sweep function.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a), y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** Every address the name has, v4 and v6. A lookup that fails for one family is fine as long as the other answers. */
async function resolveAll(host: string): Promise<string[]> {
  const settled = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')])
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('WORKSPACE_SWEEP_SECRET') ?? ''
  if (secret.length < 24) return json({ error: 'Not configured: set WORKSPACE_SWEEP_SECRET (at least 24 characters).' }, 503)
  if (!safeEqual(request.headers.get('x-sweep-secret') ?? '', secret)) return json({ error: 'Unauthorised.' }, 401)

  const admin = adminClient()
  const result: Record<string, unknown> = {}
  const part = async (name: string, run: () => Promise<unknown>) => { try { result[name] = await run() } catch { console.error('workspace-sweep part failed:', name); result[name] = { error: 'failed' } } }

  await part('monitor', async () => { const { data, error } = await admin.rpc('monitor_sweep'); if (error) throw error; return data })
  await part('support', async () => { const { data, error } = await admin.rpc('support_sweep'); if (error) throw error; return data })
  // GitHub delivery log and activity feed are not an archive: keep 90 days. Cheap and idempotent, so it runs on every sweep.
  await part('github', async () => { const { data, error } = await admin.rpc('prune_github_data', { p_days: 90 }); if (error) throw error; const { data: expired, error: e2 } = await admin.rpc('expire_github_actions'); if (e2) throw e2; return { pruned: data ?? 0, expired: expired ?? 0 } })
  await part('callbacks', async () => {
    const { data, error } = await admin.rpc('support_callbacks_claim', { p_limit: 20 })
    if (error) throw error
    let delivered = 0, failed = 0
    for (const row of (data ?? []) as { event_id: string; url: string; secret: string; event: string; payload: unknown; attempts: number }[]) {
      const d: Delivery = { event_id: row.event_id, url: row.url, secret: row.secret, event: row.event, payload: row.payload, attempts: row.attempts }
      const r = await deliver(d, { fetch, resolve: resolveAll, nowMs: () => Date.now() })
      await admin.rpc('support_callback_report', { p_event: row.event_id, p_ok: r.ok, p_http: r.http, p_error: r.error })
      if (r.ok) delivered++; else failed++
    }
    const purge = await admin.rpc('support_callbacks_purge')
    return { delivered, failed, purged: purge.data ?? 0 }
  })
  return json(result)
})
