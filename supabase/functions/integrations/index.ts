// Integrations hub backend. GitHub is the first provider.
//
//   connect / disconnect / available     - Main Admin only
//   repos / repo-detail / pulls / runs   - any internal user, limited to repositories linked to their department or project
//
// The GitHub token is stored in `integration_secrets` (RLS on, no policies: unreachable from any browser session) and is only
// ever read here, with the service role. It is never returned. Repository access is decided by Row-Level Security on
// `integration_repositories`, queried with the CALLER's own token, so the database rules (department or project visibility)
// are the single source of truth.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'
import { GithubError, githubGet, isRepoFullName, slimBranch, slimCommit, slimDeployment, slimIssues, slimPull, slimRepo, slimRun } from '../_shared/github.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = adminClient()
  if (!(await enforceRateLimit(admin, request, 'integrations', { maxEvents: 120, windowSeconds: 600 }))) return rateLimitedResponse(cors)

  const caller = await authorizeCaller(admin, request)
  if (!caller || !['worker', 'manager', 'superadmin'].includes(caller.role)) return forbiddenResponse(cors)

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json({ error: 'Send a JSON body.' }, 400) }
  const action = String(body.action ?? '')
  const isMainAdmin = caller.role === 'superadmin'

  // A client acting as the caller: Row-Level Security applies exactly as it would in the browser.
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  })

  const getToken = async () => {
    const { data } = await admin.from('integration_secrets').select('secret').eq('provider', 'github').maybeSingle()
    return data?.secret as string | undefined
  }
  const markError = async (message: string) =>
    admin.from('integrations').update({ status: 'needs_authorization', last_error: message.slice(0, 300), last_checked_at: new Date().toISOString() }).eq('provider', 'github')

  try {
    // ---- Main Admin: connect, disconnect, list what the token can see ------------------------------------------------------------
    if (action === 'connect') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      const token = String(body.token ?? '').trim()
      if (token.length < 20 || token.length > 400 || /\s/.test(token)) return json({ error: 'That does not look like a GitHub token.' }, 400)
      const user = (await githubGet(token, '/user')) as { login?: string }
      await admin.from('integration_secrets').upsert({ provider: 'github', secret: token, updated_at: new Date().toISOString() })
      await admin.from('integrations').update({ status: 'connected', config: { account: user.login ?? '' }, connected_by: caller.userId, connected_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_error: '' }).eq('provider', 'github')
      return json({ ok: true, account: user.login ?? '' })
    }
    if (action === 'disconnect') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      await admin.from('integration_secrets').delete().eq('provider', 'github')
      await admin.from('integrations').update({ status: 'not_connected', config: {}, connected_by: null, connected_at: null, last_error: '' }).eq('provider', 'github')
      return json({ ok: true })
    }

    const token = await getToken()
    if (!token) return json({ error: 'GitHub is not connected.', code: 'not_connected' }, 409)

    if (action === 'available') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      const list = (await githubGet(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')) as Record<string, unknown>[]
      return json({ repos: list.map(slimRepo) })
    }

    // ---- Everyone else: only repositories the database says they may see ---------------------------------------------------------
    if (action === 'repos') {
      const { data: links } = await asCaller.from('integration_repositories').select('full_name, department_id, project_id')
      const repos = await Promise.all((links ?? []).map(async (l) => {
        try { return { ...slimRepo((await githubGet(token, `/repos/${l.full_name}`)) as Record<string, unknown>), department_id: l.department_id, project_id: l.project_id } }
        catch (e) { return { full_name: l.full_name, department_id: l.department_id, project_id: l.project_id, error: e instanceof GithubError ? e.message : 'Unavailable' } }
      }))
      return json({ repos })
    }

    const repo = body.repo
    if (!isRepoFullName(repo)) return json({ error: 'Choose a repository.' }, 400)
    const { data: allowed } = await asCaller.from('integration_repositories').select('full_name').eq('full_name', repo).maybeSingle()
    if (!allowed) return forbiddenResponse(cors)

    if (action === 'repo-detail') {
      const info = slimRepo((await githubGet(token, `/repos/${repo}`)) as Record<string, unknown>)
      const [branches, commits, issues] = (await Promise.all([
        githubGet(token, `/repos/${repo}/branches?per_page=20`),
        githubGet(token, `/repos/${repo}/commits?per_page=15&sha=${encodeURIComponent(info.default_branch)}`),
        githubGet(token, `/repos/${repo}/issues?state=open&per_page=30`),
      ])) as Record<string, unknown>[][]
      return json({ repo: info, branches: branches.map(slimBranch), commits: commits.map(slimCommit), issues: slimIssues(issues).slice(0, 15) })
    }
    if (action === 'pulls') {
      const pulls = (await githubGet(token, `/repos/${repo}/pulls?state=open&per_page=15&sort=updated&direction=desc`)) as Record<string, unknown>[]
      const out = await Promise.all(pulls.map(async (p) => {
        const reviews = (await githubGet(token, `/repos/${repo}/pulls/${p.number}/reviews?per_page=30`).catch(() => [])) as Record<string, unknown>[]
        return slimPull(p, reviews)
      }))
      return json({ pulls: out })
    }
    if (action === 'runs') {
      const [runs, deployments] = (await Promise.all([
        githubGet(token, `/repos/${repo}/actions/runs?per_page=15`), githubGet(token, `/repos/${repo}/deployments?per_page=10`).catch(() => []),
      ])) as [{ workflow_runs?: Record<string, unknown>[] }, Record<string, unknown>[]]
      return json({ runs: (runs.workflow_runs ?? []).map(slimRun), deployments: deployments.map(slimDeployment) })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    if (e instanceof GithubError) {
      if (e.kind === 'unauthorized') await markError(e.message)
      return json({ error: e.message, code: e.kind }, e.status === 401 ? 409 : e.status)
    }
    return json({ error: 'Something went wrong talking to GitHub.' }, 500)
  }
})
