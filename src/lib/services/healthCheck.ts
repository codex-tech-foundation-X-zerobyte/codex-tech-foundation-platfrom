import { supabase } from '../supabase'

export type HealthStatus = 'checking' | 'healthy' | 'degraded' | 'unavailable'

export interface HealthCheckResult {
  status: HealthStatus
  latencyMs: number | null
  error?: string
}

const DEGRADED_THRESHOLD_MS = 2500

// Real database round trip — a minimal, RLS-scoped query (the caller's own
// profile row, via head+count so no actual row data transfers) rather than
// anything that could itself be slow or expensive. Replaces a hardcoded
// "Supabase connection: healthy" that never actually checked anything.
export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const start = performance.now()
  try {
    const { error } = await supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
    const latencyMs = Math.round(performance.now() - start)
    if (error) return { status: 'unavailable', latencyMs, error: error.message }
    return { status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'healthy', latencyMs }
  } catch (e) {
    return { status: 'unavailable', latencyMs: Math.round(performance.now() - start), error: e instanceof Error ? e.message : 'Network error' }
  }
}

// A CORS preflight OPTIONS request is side-effect-free — every deployed
// Edge Function in this project answers `200 ok` to OPTIONS before doing
// any real work (see any function's Deno.serve handler), so this is a
// genuine reachability check, not an action with consequences.
export async function checkEdgeFunctionHealth(): Promise<HealthCheckResult> {
  const start = performance.now()
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!baseUrl) return { status: 'unavailable', latencyMs: null, error: 'VITE_SUPABASE_URL is not configured' }
  try {
    const res = await fetch(`${baseUrl}/functions/v1/resolve-worker-login`, { method: 'OPTIONS' })
    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok) return { status: 'unavailable', latencyMs, error: `HTTP ${res.status}` }
    return { status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'healthy', latencyMs }
  } catch (e) {
    return { status: 'unavailable', latencyMs: Math.round(performance.now() - start), error: e instanceof Error ? e.message : 'Network error' }
  }
}
