// Integrations hub backend. GitHub is the first provider.
//
//   connect / disconnect / available / installations / select-installation   - Main Admin only
//   repos / repo-detail / pulls / runs / contents / readme / commits / commit / branches / pull-detail / issues / issue-detail   - any internal user,
//                                                                         limited to repositories linked to their department or project
//   deployments   - any internal user, for repositories they can see: READ-ONLY Vercel status (needs no GitHub credential, only the VERCEL_TOKEN secret)
//   vercel-status   - Main Admin only: is the VERCEL_TOKEN secret set?
//   health   - Main Admin only: runs the connection check (secrets present, App sign-in and permissions, installation, webhook deliveries,
//              database migrations, Vercel projects) and returns plain-language findings. Never returns a secret or any part of one.
//   comment / create-issue   - WRITES. Off until the Main Admin enables them per repository; always as the GitHub App, never the shared token.
//
// Credentials, in order of preference: (1) a GitHub App installation token, minted here from GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
// (Edge Function secrets) once the Main Admin has selected an installation; (2) the legacy shared token in `integration_secrets`
// (RLS on, no policies: unreachable from any browser session). Neither is ever returned. The App token can reach every repository
// the installation covers, so the gate for WHICH repository a person may open is Row-Level Security on `integration_repositories`,
// queried with the CALLER's own token: the database rules (department or project visibility) are the single source of truth.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adminClient, enforceRateLimit, rateLimitedResponse } from '../_shared/rateLimit.ts'
import { authorizeCaller, forbiddenResponse } from '../_shared/auth.ts'
import {
  GithubError, githubGet, githubPost, isRepoFullName, slimBranch, slimCommit, slimDeployment, slimIssues, slimPull, slimRepo, slimRun,
  clampPage, encodePath, isCommitSha, isItemNumber, isListState, isSafeRef, isSafeRepoPath, slimCommitDetail, slimCommitListItem, slimFile, slimIssueDetail, slimIssueListItem, slimPullDetail, slimTreeEntry, sortTree,
} from '../_shared/github.ts'
import { createTokenCache, isAppId, isInstallationId, mintInstallationToken, resolveCredential, signAppJwt } from '../_shared/githubApp.ts'
import { runWrite } from '../_shared/githubWrite.ts'
import {
  REQUIRED_TABLES, appChecks, databaseChecks, deliveryCheck, installationChecks, overall, secretChecks, skippedCheck, vercelChecks, type Check,
} from '../_shared/health.ts'
import { VercelError, slimVercelDeployment, summariseProduction, vercelListDeployments } from '../_shared/vercel.ts'

const tokenCache = createTokenCache()   // installation tokens live only in this instance's memory, for at most an hour

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

  const appId = Deno.env.get('GITHUB_APP_ID') ?? undefined
  const appKey = Deno.env.get('GITHUB_APP_PRIVATE_KEY') ?? undefined
  const getCredential = async () => {
    const [{ data: cfg }, { data: sec }] = await Promise.all([
      admin.from('integrations').select('config').eq('provider', 'github').maybeSingle(),
      admin.from('integration_secrets').select('secret').eq('provider', 'github').maybeSingle(),
    ])
    const installationId = (cfg?.config as { installation_id?: number } | null)?.installation_id ?? null
    return resolveCredential({ appId, privateKey: appKey, installationId, legacyToken: (sec?.secret as string | undefined) ?? null, cache: tokenCache, now: Date.now() })
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
      tokenCache.clear()
      await admin.from('integrations').update({ status: 'connected', config: { account: user.login ?? '', auth: 'personal_token' }, connected_by: caller.userId, connected_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_error: '' }).eq('provider', 'github')
      return json({ ok: true, account: user.login ?? '' })
    }
    if (action === 'disconnect') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      await admin.from('integration_secrets').delete().eq('provider', 'github')
      tokenCache.clear()
      await admin.from('integrations').update({ status: 'not_connected', config: {}, connected_by: null, connected_at: null, last_error: '' }).eq('provider', 'github')
      return json({ ok: true })
    }

    // ---- Main Admin: the GitHub App -----------------------------------------------------------------------------------------------
    if (action === 'installations') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      const { data } = await admin.from('github_installations').select('installation_id, account_login, account_type, repository_selection, suspended, removed').order('updated_at', { ascending: false })
      return json({ app_configured: !!(appId && appKey), installations: data ?? [] })
    }
    if (action === 'select-installation') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      if (!appId || !appKey) return json({ error: 'The GitHub App is not configured on the server yet (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY).', code: 'app_not_configured' }, 409)
      const id = body.installation_id
      if (!isInstallationId(id)) return json({ error: 'Choose an installation.' }, 400)
      const { data: row } = await admin.from('github_installations').select('account_login, suspended, removed').eq('installation_id', Number(id)).maybeSingle()
      if (!row || row.removed || row.suspended) return json({ error: 'That installation is unknown, suspended or removed.' }, 400)
      // Prove it works BEFORE saving: mint a token and make one real call. Nothing is stored if either fails.
      const cred = await resolveCredential({ appId, privateKey: appKey, installationId: Number(id), legacyToken: null, cache: tokenCache, now: Date.now() })
      if (!cred) return json({ error: 'Could not authenticate as the GitHub App.' }, 409)
      await githubGet(cred.token, '/installation/repositories?per_page=1')
      await admin.from('integrations').update({ status: 'connected', config: { account: row.account_login, installation_id: Number(id), auth: 'github_app' }, connected_by: caller.userId, connected_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_error: '' }).eq('provider', 'github')
      return json({ ok: true, account: row.account_login })
    }

    // ---- Connection check (Main Admin). Reads GitHub's and Vercel's own answers and the database; changes nothing. ----
    if (action === 'health') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      const now = Date.now()
      const vercelToken = Deno.env.get('VERCEL_TOKEN')
      const errText = (e: unknown, fallback: string) => (e instanceof GithubError || e instanceof VercelError ? e.message : fallback)
      let keyUsable: boolean | null = null
      if (appKey) { try { await signAppJwt(appId && isAppId(appId) ? appId : '1', appKey, Math.floor(now / 1000)); keyUsable = true } catch { keyUsable = false } }
      const checks: Check[] = secretChecks({ appId: !!appId, privateKey: !!appKey, privateKeyUsable: keyUsable, webhookSecret: Deno.env.get('GITHUB_WEBHOOK_SECRET'), vercelToken: !!vercelToken })

      const { data: cfg } = await admin.from('integrations').select('config').eq('provider', 'github').maybeSingle()
      const installationId = (cfg?.config as { installation_id?: number } | null)?.installation_id ?? null
      if (appId && appKey && keyUsable) {
        const jwt = await signAppJwt(appId, appKey, Math.floor(now / 1000))
        let app: Record<string, unknown> | null = null
        let appError: string | null = null
        try { app = (await githubGet(jwt, '/app')) as Record<string, unknown> } catch (e) { appError = e instanceof GithubError && e.kind === 'unauthorized' ? 'GitHub rejected the App\u2019s credentials. Check that GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY come from the same App.' : errText(e, 'GitHub could not be reached.') }
        checks.push(...appChecks(app, appError))
        if (app) {
          let deliveries: Record<string, unknown>[] | null = null
          let deliveryError: string | null = null
          try { deliveries = (await githubGet(jwt, '/app/hook/deliveries?per_page=10')) as Record<string, unknown>[] } catch (e) { deliveryError = `GitHub\u2019s delivery log could not be read (${errText(e, 'unknown error')}).` }
          checks.push(deliveryCheck(Array.isArray(deliveries) ? deliveries : null, deliveryError, now))
          if (installationId != null && isInstallationId(installationId)) {
            let minted: Awaited<ReturnType<typeof mintInstallationToken>> | null = null
            let mintError: string | null = null
            let reposReadable: boolean | null = null
            try { minted = await mintInstallationToken(jwt, installationId) } catch (e) { mintError = errText(e, 'A token could not be made.') }
            if (minted) { try { await githubGet(minted.token, '/installation/repositories?per_page=1'); reposReadable = true } catch { reposReadable = false } }
            checks.push(...installationChecks({ selected: true, minted, error: mintError, reposReadable, appPermissions: app.permissions }))
          } else checks.push(...installationChecks({ selected: false, minted: null, error: null, reposReadable: null, appPermissions: app.permissions }))
        } else checks.push(skippedCheck('github', 'webhook', 'Webhook deliveries', 'Needs the App to sign in first.'), skippedCheck('github', 'installation', 'Installation', 'Needs the App to sign in first.'))
      } else {
        checks.push(skippedCheck('github', 'app', 'GitHub App sign-in', 'Needs GITHUB_APP_ID and a usable GITHUB_APP_PRIVATE_KEY first.'), skippedCheck('github', 'webhook', 'Webhook deliveries', 'Needs the App to sign in first.'), skippedCheck('github', 'installation', 'Installation', 'Needs the App to sign in first.'))
      }

      const probes: Record<string, boolean> = {}
      await Promise.all(REQUIRED_TABLES.map(async (t) => { const { error } = await admin.from(t.table).select('*', { count: 'exact', head: true }).limit(1); probes[t.table] = !error }))
      checks.push(...databaseChecks(probes))

      const targets: { repo: string; ok: boolean; message: string }[] = []
      if (probes.deployment_targets) {
        const { data: rows } = await admin.from('deployment_targets').select('repo_full_name, project_ref, team_ref').limit(10)
        for (const r of rows ?? []) {
          if (!vercelToken) { targets.push({ repo: String(r.repo_full_name), ok: false, message: '' }); continue }
          try { await vercelListDeployments(vercelToken, { project: r.project_ref as string, team: (r.team_ref as string | null) ?? null, limit: 1 }); targets.push({ repo: String(r.repo_full_name), ok: true, message: '' }) }
          catch (e) { targets.push({ repo: String(r.repo_full_name), ok: false, message: errText(e, 'Vercel could not be reached.') }) }
        }
      }
      checks.push(...vercelChecks({ tokenSet: !!vercelToken, targets }))
      return json({ checked_at: new Date(now).toISOString(), overall: overall(checks), checks })
    }

    // ---- Deployments (read-only, Vercel). Same visibility rule as everything else: the caller must be able to see the repository. ----
    if (action === 'vercel-status') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      return json({ configured: !!Deno.env.get('VERCEL_TOKEN') })
    }
    if (action === 'deployments') {
      if (!isRepoFullName(body.repo)) return json({ error: 'Choose a repository.' }, 400)
      const { data: visible } = await asCaller.from('integration_repositories').select('full_name').eq('full_name', body.repo).maybeSingle()
      if (!visible) return forbiddenResponse(cors)
      const { data: target } = await asCaller.from('deployment_targets').select('provider, project_ref, team_ref').eq('repo_full_name', body.repo).maybeSingle()
      if (!target) return json({ status: 'not_mapped' })
      const vercelToken = Deno.env.get('VERCEL_TOKEN')
      if (!vercelToken) return json({ status: 'not_configured' })
      try {
        const [all, prod] = await Promise.all([
          vercelListDeployments(vercelToken, { project: target.project_ref as string, team: (target.team_ref as string | null) ?? null, limit: 20 }),
          vercelListDeployments(vercelToken, { project: target.project_ref as string, team: (target.team_ref as string | null) ?? null, target: 'production', limit: 10 }),
        ])
        return json({ status: 'ok', production: summariseProduction(prod.map(slimVercelDeployment)), deployments: all.map(slimVercelDeployment) })
      } catch (e) {
        if (e instanceof VercelError) return json({ error: e.message }, e.status === 429 ? 429 : e.status === 404 ? 404 : 502)
        return json({ error: 'Vercel could not be reached. Try again.' }, 502)
      }
    }

    const cred = await getCredential()
    if (!cred) return json({ error: 'GitHub is not connected.', code: 'not_connected' }, 409)
    const token = cred.token

    if (action === 'available') {
      if (!isMainAdmin) return forbiddenResponse(cors)
      if (cred.source === 'github_app') {
        const out = (await githubGet(token, '/installation/repositories?per_page=100')) as { repositories?: Record<string, unknown>[] }
        return json({ repos: (out.repositories ?? []).map(slimRepo), source: cred.source })
      }
      const list = (await githubGet(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')) as Record<string, unknown>[]
      return json({ repos: list.map(slimRepo), source: cred.source })
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

    // ---- Writes: authorised by the database (github_can, under the caller's own session), recorded before and after, App credential only ----
    if (action === 'comment' || action === 'create-issue') {
      const { data: prof } = await admin.from('profiles').select('display_name').eq('id', caller.userId).maybeSingle()
      const result = await runWrite({
        credentialSource: cred.source,
        displayName: String(prof?.display_name ?? ''),
        can: async (r, capability) => { const { data, error } = await asCaller.rpc('github_can', { p_repo: r, p_capability: capability }); return !error && data === true },
        begin: async (a) => {
          const { data, error } = await admin.rpc('begin_github_action', { p_request: a.requestId, p_actor: caller.userId, p_repo: a.repo, p_action: a.action, p_target: a.target, p_denied: a.denied ?? false })
          if (error) throw new Error('begin failed')   // nothing was sent to GitHub: surfaces as a plain failure below
          return data as 'ok' | 'denied' | 'duplicate' | 'rate_limited'
        },
        finish: async (id, outcome, detail, url) => { const { error } = await admin.rpc('finish_github_action', { p_request: id, p_outcome: outcome, p_detail: detail, p_url: url }); if (error) throw new Error('finish failed') },
        post: (path, payload) => githubPost(token, path, payload),
      }, { requestId: body.request_id, repo, action: action === 'comment' ? 'comment' : 'create_issue', number: body.number, text: body.text, title: body.title })
      return json(result.body, result.status)
    }

    if (action === 'repo-detail') {
      const info = slimRepo((await githubGet(token, `/repos/${repo}`)) as Record<string, unknown>)
      const [branches, commits, issues] = (await Promise.all([
        githubGet(token, `/repos/${repo}/branches?per_page=20`),
        githubGet(token, `/repos/${repo}/commits?per_page=15&sha=${encodeURIComponent(info.default_branch)}`),
        githubGet(token, `/repos/${repo}/issues?state=open&per_page=30`),
      ])) as Record<string, unknown>[][]
      return json({ repo: info, branches: branches.map(slimBranch), commits: commits.map(slimCommit), issues: slimIssues(issues).slice(0, 15) })
    }
    // ---- Repository browser (read-only) ----------------------------------------------------------------------------------------
    if (action === 'contents') {
      const path = body.path === undefined || body.path === '' ? '' : body.path
      const ref = body.ref === undefined || body.ref === '' ? null : body.ref
      if (path !== '' && !isSafeRepoPath(path)) return json({ error: 'That path is not valid.' }, 400)
      if (ref !== null && !isSafeRef(ref)) return json({ error: 'That branch or commit is not valid.' }, 400)
      const out = (await githubGet(token, `/repos/${repo}/contents${path ? `/${encodePath(path as string)}` : ''}${ref ? `?ref=${encodeURIComponent(ref as string)}` : ''}`)) as Record<string, unknown> | Record<string, unknown>[]
      if (Array.isArray(out)) return json({ type: 'dir', path, entries: sortTree(out.map(slimTreeEntry)).slice(0, 300), truncated: out.length > 300 })
      return json({ type: 'file', file: slimFile(out) })
    }
    if (action === 'readme') {
      const ref = body.ref === undefined || body.ref === '' ? null : body.ref
      if (ref !== null && !isSafeRef(ref)) return json({ error: 'That branch or commit is not valid.' }, 400)
      try { return json({ file: slimFile((await githubGet(token, `/repos/${repo}/readme${ref ? `?ref=${encodeURIComponent(ref as string)}` : ''}`)) as Record<string, unknown>) }) }
      catch (e) { if (e instanceof GithubError && e.kind === 'not_found') return json({ file: null }); throw e }
    }
    if (action === 'commits') {
      const ref = body.ref === undefined || body.ref === '' ? null : body.ref
      if (ref !== null && !isSafeRef(ref)) return json({ error: 'That branch or commit is not valid.' }, 400)
      const page = clampPage(body.page)
      const list = (await githubGet(token, `/repos/${repo}/commits?per_page=30&page=${page}${ref ? `&sha=${encodeURIComponent(ref as string)}` : ''}`)) as Record<string, unknown>[]
      return json({ commits: list.map(slimCommitListItem), page, has_more: list.length === 30 })
    }
    if (action === 'commit') {
      if (!isCommitSha(body.sha)) return json({ error: 'That commit id is not valid.' }, 400)
      return json({ commit: slimCommitDetail((await githubGet(token, `/repos/${repo}/commits/${body.sha}`)) as Record<string, unknown>) })
    }
    if (action === 'branches') {
      const page = clampPage(body.page)
      const list = (await githubGet(token, `/repos/${repo}/branches?per_page=50&page=${page}`)) as Record<string, unknown>[]
      return json({ branches: list.map(slimBranch), page, has_more: list.length === 50 })
    }
    if (action === 'pull-detail') {
      if (!isItemNumber(body.number)) return json({ error: 'That pull request number is not valid.' }, 400)
      const n = body.number
      const [pr, files, reviews, comments] = (await Promise.all([
        githubGet(token, `/repos/${repo}/pulls/${n}`), githubGet(token, `/repos/${repo}/pulls/${n}/files?per_page=100`),
        githubGet(token, `/repos/${repo}/pulls/${n}/reviews?per_page=100`), githubGet(token, `/repos/${repo}/issues/${n}/comments?per_page=100`),
      ])) as Record<string, unknown>[][] & Record<string, unknown>[]
      // CI status is best effort: a token without the Checks permission must show "unknown", never "passing".
      const sha = String((pr as unknown as { head?: { sha?: string } }).head?.sha ?? '')
      let runs: Record<string, unknown>[] | null = null
      if (isCommitSha(sha)) { try { runs = ((await githubGet(token, `/repos/${repo}/commits/${sha}/check-runs?per_page=50`)) as { check_runs?: Record<string, unknown>[] }).check_runs ?? [] } catch { runs = null } }
      return json({ pull: slimPullDetail(pr as unknown as Record<string, unknown>, files, reviews, comments, runs) })
    }
    if (action === 'issues') {
      const state = body.state === undefined ? 'open' : body.state
      if (!isListState(state)) return json({ error: 'That filter is not valid.' }, 400)
      const page = clampPage(body.page)
      const list = (await githubGet(token, `/repos/${repo}/issues?state=${state}&per_page=30&page=${page}&sort=updated&direction=desc`)) as Record<string, unknown>[]
      // GitHub lists pull requests as issues too; they have their own tab.
      return json({ issues: list.filter((i) => !i.pull_request).map(slimIssueListItem), page, has_more: list.length === 30 })
    }
    if (action === 'issue-detail') {
      if (!isItemNumber(body.number)) return json({ error: 'That issue number is not valid.' }, 400)
      const [issue, comments] = (await Promise.all([githubGet(token, `/repos/${repo}/issues/${body.number}`), githubGet(token, `/repos/${repo}/issues/${body.number}/comments?per_page=100`)])) as [Record<string, unknown>, Record<string, unknown>[]]
      if (issue.pull_request) return json({ error: 'That is a pull request. Open it from the Pull requests tab.' }, 400)
      return json({ issue: slimIssueDetail(issue, comments) })
    }
    if (action === 'pulls') {
      const pstate = body.state === undefined ? 'open' : body.state
      if (!isListState(pstate)) return json({ error: 'That filter is not valid.' }, 400)
      const pulls = (await githubGet(token, `/repos/${repo}/pulls?state=${pstate}&per_page=15&sort=updated&direction=desc`)) as Record<string, unknown>[]
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
