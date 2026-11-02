// Read-only security checks against GitHub, Vercel and the live website, for the superadmin Security monitor.
//
// Tokens are Edge Function SECRETS (supabase secrets set ...) — they never reach the browser and are never returned.
//   GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)       -> dependency alerts, leaked secrets, code scanning, branch protection, CI
//   VERCEL_TOKEN, VERCEL_PROJECT_ID, [VERCEL_TEAM_ID]  -> production deployment health
//   SITE_URL (https://...)                             -> security headers of the live site (defaults to the caller's own origin)
// Anything not configured is reported with the exact commands to set it up. Nothing here writes to any of those services.
import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'
import { checkGithub, checkSecurityHeaders, checkVercel } from '../_shared/securityProviders.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const env = (name: string) => Deno.env.get(name) || undefined

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()

  // Each scan makes several outbound API calls, so keep a lid on how often it can be triggered.
  if (!(await enforceRateLimit(admin, request, 'security-monitor', { maxEvents: 20, windowSeconds: 600 }))) return rateLimitedResponse(cors)

  // Superadmin only: this reveals how well the system is defended.
  const caller = await authorizeCaller(admin, request)
  if (!caller || caller.role !== 'superadmin') return forbiddenResponse(cors)

  const origin = request.headers.get('origin')
  const siteUrl = env('SITE_URL') ?? (origin && origin.startsWith('https://') ? origin : undefined)

  const providers = await Promise.all([
    checkGithub({ token: env('GITHUB_TOKEN'), repository: env('GITHUB_REPOSITORY') }),
    checkVercel({ token: env('VERCEL_TOKEN'), projectId: env('VERCEL_PROJECT_ID'), teamId: env('VERCEL_TEAM_ID') }),
    checkSecurityHeaders(siteUrl),
  ])
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), providers }), {
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
})
