import { supabase } from '../supabase'
import { toError } from './shared'
import type { Posture, ProviderReport } from '../securityChecks'

/** The database's own security configuration (RLS coverage, buckets, accounts, recent activity). Superadmin only, enforced in SQL. */
export async function getSecurityPosture() {
  const { data, error, status } = await supabase.rpc('security_posture')
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    return { data: null as Posture | null, error: new Error('The security report is not installed yet. Apply migration 20260925000000_chat_dm_uploads_security_posture.sql.') }
  }
  return { data: (data as Posture | null) ?? null, error: toError(error, status) }
}

export interface IntegrationScan { generated_at: string; providers: ProviderReport[] }

/** GitHub / Vercel / website-header checks, run server-side so no token ever reaches the browser. */
export async function getIntegrationScan() {
  const { data, error } = await supabase.functions.invoke('security-monitor')
  if (error) {
    const status = (error as { context?: Response }).context?.status
    const message =
      status === 403 ? 'Only a superadmin can run the integration scan.'
      : status === 404 ? 'The security-monitor function is not deployed yet. Run: supabase functions deploy security-monitor'
      : status === 429 ? 'Scanned too often — wait a few minutes and try again.'
      : 'The integration scan could not run. Check that the security-monitor function is deployed.'
    return { data: null as IntegrationScan | null, error: new Error(message) }
  }
  return { data: data as IntegrationScan, error: null as Error | null }
}
