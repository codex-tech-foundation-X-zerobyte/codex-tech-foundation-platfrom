import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Real rate limiting backed by the check_rate_limit() Postgres function
 * (see supabase/migrations/20260914000003_rate_limiting.sql). Call this
 * before doing any work in a public edge function.
 *
 * Keys by client IP (from the standard proxy header Supabase's edge runtime
 * sets) combined with the action name, so one IP hammering submit-lead
 * doesn't also throttle a different IP's job applications.
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  request: Request,
  action: string,
  opts: { maxEvents: number; windowSeconds: number },
): Promise<boolean> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  return enforceRateLimitByKey(admin, `${action}:${ip}`, opts)
}

/**
 * Lower-level variant for when the bucket must be keyed by something other
 * than IP — e.g. a specific Worker ID, so rotating source IPs doesn't bypass
 * a per-account brute-force limit.
 */
export async function enforceRateLimitByKey(
  admin: SupabaseClient,
  bucketKey: string,
  opts: { maxEvents: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_bucket_key: bucketKey,
    p_max_events: opts.maxEvents,
    p_window_seconds: opts.windowSeconds,
  })
  // Fail closed on an unexpected RPC error: better to reject a handful of
  // legitimate requests during a transient DB issue than to silently disable
  // rate limiting.
  if (error) return false
  return Boolean(data)
}

export function rateLimitedResponse(cors: Record<string, string>) {
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again in a few minutes.' }), {
    status: 429,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
