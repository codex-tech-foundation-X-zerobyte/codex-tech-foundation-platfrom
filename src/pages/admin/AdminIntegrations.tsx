import { useState } from 'react'
import { Cable, GitBranch, Link2 } from 'lucide-react'
import { GithubSetupGuide } from './GithubSetupGuide'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Surface, useToast } from '../../components/ui'
import {
  connectGithub, disconnectGithub, githubAvailable, clearDeploymentTarget, githubInstallations, runConnectionCheck, linkRepository, listDeploymentTargets, listGithubActions, listGithubPolicies, setDeploymentTarget, setGithubRepoPolicy, vercelStatus, listDepartmentSummaries, listLinkedRepositories, loadIntegrationState, saveLaunchUrl, selectGithubInstallation, unlinkRepository,
  type ConnectionReport, type DeploymentTarget, type GithubInstallation, type GithubRepo, type WriteLevel,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { INTEGRATIONS, type IntegrationStatus } from '../../workspaces/definitions'
import './AdminIntegrations.css'
import '../../workspaces/DepartmentEnvironment.css'

const TONE: Record<IntegrationStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { connected: 'success', needs_authorization: 'warning', error: 'danger', not_connected: 'neutral' }
const LABEL: Record<IntegrationStatus, string> = { connected: 'Connected', needs_authorization: 'Needs authorization', error: 'Error', not_connected: 'Not connected' }

/** The Main Admin's integrations hub. Tokens are sent to a server function and never kept in the browser. */
export function AdminIntegrations() {
  useDocumentTitle('Integrations')
  const state = useAsyncData('integration-state', loadIntegrationState)
  if (state.loading) return <SkeletonRows rows={3} height="120px" />
  if (state.error) return <ErrorState title="Integrations couldn't load" description={state.errorDetail?.message ?? 'Try again.'} onRetry={state.reload} />
  const s = state.data ?? {}
  return (
    <div className="ctf-int">
      <GithubCard status={s.github?.status ?? 'not_connected'} account={typeof s.github?.config?.account === 'string' ? s.github.config.account : ''} auth={s.github?.config?.auth === 'github_app' ? 'github_app' : 'personal_token'} installationId={typeof s.github?.config?.installation_id === 'number' ? s.github.config.installation_id : null} onChanged={state.reload} />
      <LaunchCard provider="figma" status={s.figma?.status ?? 'not_connected'} url={typeof s.figma?.config?.url === 'string' ? s.figma.config.url : ''} onChanged={state.reload} />
      <LaunchCard provider="canva" status={s.canva?.status ?? 'not_connected'} url={typeof s.canva?.config?.url === 'string' ? s.canva.config.url : ''} onChanged={state.reload} />
    </div>
  )
}

function GithubCard({ status, account, auth, installationId, onChanged }: { status: IntegrationStatus; account: string; auth: 'github_app' | 'personal_token'; installationId: number | null; onChanged: () => void }) {
  const { push } = useToast()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = status === 'connected'
  const [report, setReport] = useState<ConnectionReport | null>(null)

  const connect = async () => {
    setBusy(true)
    const { data, error } = await connectGithub(token)
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    setToken(''); push(`GitHub connected as ${data?.account ?? 'your account'}.`); onChanged()
  }
  const disconnect = async () => {
    setBusy(true)
    const { error } = await disconnectGithub()
    setBusy(false)
    if (error) push(error.message, 'error'); else { push('GitHub disconnected.'); onChanged() }
  }

  return (
    <Surface className="ctf-int__card">
      <header><span className="ctf-int__icon" aria-hidden="true"><GitBranch size={18} /></span><div><h2>GitHub</h2><p>{INTEGRATIONS.github.purpose}</p></div><Badge tone={TONE[status]}>{LABEL[status]}</Badge></header>
      {connected ? (
        <>
          {auth === 'github_app'
            ? <p className="ctf-denv__muted">Connected through the GitHub App installed on <strong>{account || 'your organization'}</strong>. Access is limited to the repositories chosen when the App was installed.</p>
            : <p className="ctf-denv__muted">Connected as <strong>{account || 'your account'}</strong> with a shared personal token, stored on the server and never shown again. The GitHub App below is the safer option.</p>}
          <GithubSetupGuide report={report} connected />
          <GithubAppPanel activeId={auth === 'github_app' ? installationId : null} onChanged={onChanged} />
          <ConnectionCheckPanel onReport={setReport} />
          <RepositoryLinking appMode={auth === 'github_app'} />
          {auth === 'github_app' && <GithubActionsLog />}
          <div><Button variant="ghost" loading={busy} onClick={() => void disconnect()}>Disconnect GitHub</Button></div>
        </>
      ) : (
        <>
          <GithubSetupGuide report={report} connected={false} />
          <GithubAppPanel activeId={null} onChanged={onChanged} />
          <ConnectionCheckPanel onReport={setReport} />
          {status === 'needs_authorization' && <p className="ctf-int__warn" role="alert">GitHub rejected the saved token. Create a new one and reconnect.</p>}
          <ol className="ctf-int__steps">
            <li>In GitHub, open <strong>Settings → Developer settings → Fine-grained personal access tokens</strong> and create a token for your organization.</li>
            <li>Give it <strong>read-only</strong> access to the repositories you want to show: Metadata, Contents, Issues, Pull requests, Actions and Deployments.</li>
            <li>Paste it below. It goes straight to the server and cannot be read back.</li>
          </ol>
          <div className="ctf-lab__row">
            <FieldWrap label="Access token" htmlFor="gh-token"><Input id="gh-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" spellCheck={false} /></FieldWrap>
            <div className="ctf-lab__save"><Button variant="primary" loading={busy} disabled={token.trim().length < 20} onClick={() => void connect()}>Connect GitHub</Button></div>
          </div>
        </>
      )}
    </Surface>
  )
}

/**
 * GitHub App installations. The App's id, private key and webhook secret are server secrets; this panel only lists the installations
 * GitHub has reported through the signed webhook and lets the Main Admin choose which one the Workspace uses.
 */
function GithubAppPanel({ activeId, onChanged }: { activeId: number | null; onChanged: () => void }) {
  const { push } = useToast()
  const list = useAsyncData('github-installations', githubInstallations)
  const [busy, setBusy] = useState<number | null>(null)
  const use = async (i: GithubInstallation) => {
    setBusy(i.installation_id)
    const { data, error } = await selectGithubInstallation(i.installation_id)
    setBusy(null)
    if (error) { push(error.message, 'error'); return }
    push(`Now using the GitHub App on ${data?.account ?? i.account_login}.`); list.reload(); onChanged()
  }
  return (
    <section aria-labelledby="gh-app-h" className="ctf-int__app">
      <p id="gh-app-h" className="ctf-int__subhead">GitHub App</p>
      {list.loading ? <p className="ctf-denv__muted">Checking for installations…</p>
        : list.error || !list.data ? <p className="ctf-denv__muted" role="status">GitHub App status could not be loaded.</p>
        : !list.data.app_configured ? <p className="ctf-denv__muted">The GitHub App is not set up on the server yet. Add <code>GITHUB_APP_ID</code>, <code>GITHUB_APP_PRIVATE_KEY</code> and <code>GITHUB_WEBHOOK_SECRET</code> as Edge Function secrets, deploy <code>github-webhook</code>, then install the App on your organization.</p>
        : list.data.installations.length === 0 ? <p className="ctf-denv__muted">No installations reported yet. Install the App on your GitHub organization; it appears here as soon as GitHub tells the webhook.</p>
        : (
          <ul className="ctf-rec__list">
            {list.data.installations.map((i) => {
              const usable = !i.suspended && !i.removed
              const active = i.installation_id === activeId
              return (
                <li key={i.installation_id} className="ctf-rec__row">
                  <div className="ctf-rec__main"><strong>{i.account_login || `Installation ${i.installation_id}`}</strong><span className="ctf-denv__muted">{i.account_type || 'Account'} · {i.repository_selection === 'all' ? 'all repositories' : i.repository_selection === 'selected' ? 'selected repositories' : 'repositories unknown'}</span></div>
                  {i.removed ? <Badge tone="danger">Removed</Badge> : i.suspended ? <Badge tone="warning">Suspended</Badge> : active ? <Badge tone="success">In use</Badge> : null}
                  {usable && !active && <Button size="sm" variant="secondary" loading={busy === i.installation_id} onClick={() => void use(i)}>Use this installation</Button>}
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}

/** Connect a linked repository to the Vercel project that deploys it (read-only status; the Vercel token is a server secret). */
function DeploymentTargetForm({ repo, target, onSaved }: { repo: string; target: DeploymentTarget | undefined; onSaved: () => void }) {
  const { push } = useToast()
  const [project, setProject] = useState(target?.project_ref ?? '')
  const [team, setTeam] = useState(target?.team_ref ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const { error } = await setDeploymentTarget(repo, project, team)
    setBusy(false)
    if (error) push(error.message, 'error'); else { push('Deployments connected.'); onSaved() }
  }
  const clear = async () => {
    setBusy(true)
    const { error } = await clearDeploymentTarget(repo)
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    setProject(''); setTeam(''); push('Deployments disconnected.'); onSaved()
  }
  return (
    <div className="ctf-int__access" role="group" aria-label={`Vercel project for ${repo}`}>
      <FieldWrap label="Vercel project (name or id)" htmlFor={`vp-${repo}`}><Input id={`vp-${repo}`} value={project} maxLength={100} onChange={(e) => setProject(e.target.value)} /></FieldWrap>
      <FieldWrap label="Vercel team (optional)" htmlFor={`vt-${repo}`}><Input id={`vt-${repo}`} value={team} maxLength={100} onChange={(e) => setTeam(e.target.value)} /></FieldWrap>
      <div className="ctf-code__compose">
        <Button size="sm" variant="secondary" loading={busy} disabled={project.trim().length === 0} onClick={() => void save()}>{target ? 'Update deployments' : 'Connect deployments'}</Button>
        {target && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>Disconnect</Button>}
      </div>
    </div>
  )
}

const GROUPS: { id: ConnectionReport['checks'][number]['group']; label: string }[] = [{ id: 'server', label: 'Server settings' }, { id: 'github', label: 'GitHub' }, { id: 'database', label: 'Database' }, { id: 'vercel', label: 'Vercel' }]
const CHECK_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = { ok: 'success', fail: 'danger', warn: 'warning', skipped: 'neutral' }
const CHECK_LABEL: Record<string, string> = { ok: 'OK', fail: 'Needs fixing', warn: 'Check this', skipped: 'Not checked' }
const OVERALL: Record<string, string> = { ok: 'Everything that could be checked is working.', warn: 'Working, with things worth checking.', fail: 'Something needs fixing before this will work.' }

/** One button that asks GitHub, Vercel and the database how the connection is doing, and says what to do about each problem. It never shows a secret. */
function ConnectionCheckPanel({ onReport }: { onReport: (r: ConnectionReport) => void }) {
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ConnectionReport | null>(null)
  const run = async () => {
    setBusy(true)
    const { data, error } = await runConnectionCheck()
    setBusy(false)
    if (error || !data) { push(error?.message ?? 'The check could not run.', 'error'); return }
    setReport(data); onReport(data)
  }
  return (
    <section aria-labelledby="gh-check-h" className="ctf-int__app">
      <p id="gh-check-h" className="ctf-int__subhead">Connection check</p>
      <p className="ctf-denv__muted">Asks GitHub, Vercel and the database whether everything is set up, and tells you what to fix. It changes nothing.</p>
      <div><Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>{report ? 'Run the check again' : 'Run the check'}</Button></div>
      {report && (
        <div className="ctf-denv__stack" aria-live="polite">
          <p><Badge tone={report.overall.status === 'ok' ? 'success' : report.overall.status === 'warn' ? 'warning' : 'danger'}>{report.overall.status === 'ok' ? 'All clear' : report.overall.status === 'warn' ? 'Check this' : 'Needs fixing'}</Badge> {OVERALL[report.overall.status]} <span className="ctf-denv__muted">Checked {new Date(report.checked_at).toLocaleTimeString()}.</span></p>
          {GROUPS.map((g) => {
            const rows = report.checks.filter((c) => c.group === g.id)
            if (rows.length === 0) return null
            return (
              <div key={g.id}>
                <p className="ctf-int__subhead">{g.label}</p>
                <ul className="ctf-rec__list">
                  {rows.map((c) => (
                    <li key={c.id} className="ctf-rec__row">
                      <div className="ctf-rec__main"><strong>{c.label}</strong><span className="ctf-denv__muted">{c.detail}</span></div>
                      <Badge tone={CHECK_TONE[c.status] ?? 'neutral'}>{CHECK_LABEL[c.status] ?? c.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const LEVELS: { id: WriteLevel; label: string }[] = [{ id: 'off', label: 'Off' }, { id: 'admins', label: 'Admins only' }, { id: 'members', label: 'Everyone who can see it' }]

/** What people may DO to a linked repository from the Workspace. Everything starts Off; viewing never implies writing. */
function WriteAccess({ repo, policy, appMode, onSaved }: { repo: string; policy: { comment_level: WriteLevel; issue_level: WriteLevel } | undefined; appMode: boolean; onSaved: () => void }) {
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const comment = policy?.comment_level ?? 'off'
  const issue = policy?.issue_level ?? 'off'
  const save = async (c: WriteLevel, i: WriteLevel) => {
    setBusy(true)
    const { error } = await setGithubRepoPolicy(repo, c, i)
    setBusy(false)
    if (error) push(error.message, 'error'); else { push('Write access updated.'); onSaved() }
  }
  return (
    <div className="ctf-int__access" role="group" aria-label={`Write access for ${repo}`}>
      <FieldWrap label="Comments" htmlFor={`wa-c-${repo}`}><Select id={`wa-c-${repo}`} value={comment} disabled={busy || !appMode} onChange={(e) => void save(e.target.value as WriteLevel, issue)}>{LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></FieldWrap>
      <FieldWrap label="New issues" htmlFor={`wa-i-${repo}`}><Select id={`wa-i-${repo}`} value={issue} disabled={busy || !appMode} onChange={(e) => void save(comment, e.target.value as WriteLevel)}>{LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></FieldWrap>
      {!appMode && <p className="ctf-denv__muted">Writing needs the GitHub App connection above.</p>}
    </div>
  )
}

const OUTCOME_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = { success: 'success', failed: 'danger', denied: 'warning', pending: 'neutral' }

/** The last things anyone did to GitHub through the Workspace, including refused attempts. Visible to the Main Admin. */
function GithubActionsLog() {
  const log = useAsyncData('github-actions', () => listGithubActions(25))
  return (
    <section aria-labelledby="gh-log-h" className="ctf-int__app">
      <p id="gh-log-h" className="ctf-int__subhead">Recent GitHub changes made from the Workspace</p>
      {log.loading ? <p className="ctf-denv__muted">Loading…</p> : log.error ? <p className="ctf-denv__muted" role="status">The history could not be loaded.</p>
        : (log.data ?? []).length === 0 ? <p className="ctf-denv__muted">Nothing has been posted from the Workspace yet.</p>
        : (
          <ul className="ctf-rec__list">
            {(log.data ?? []).map((a) => (
              <li key={a.id} className="ctf-rec__row">
                <div className="ctf-rec__main"><strong>{a.actor} · {a.action === 'comment' ? `comment on #${a.target}` : 'new issue'}</strong><span className="ctf-denv__muted">{a.repo_full_name} · {new Date(a.created_at).toLocaleString()}{a.detail ? ` · ${a.detail}` : ''}</span></div>
                <Badge tone={OUTCOME_TONE[a.outcome] ?? 'neutral'}>{a.outcome}</Badge>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/** Choose which repositories each department can see. Workers only ever see repositories linked to their department. */
function RepositoryLinking({ appMode }: { appMode: boolean }) {
  const linked = useAsyncData('linked-repos', listLinkedRepositories)
  const policies = useAsyncData('github-policies', listGithubPolicies)
  const targets = useAsyncData('deployment-targets', listDeploymentTargets)
  const vercel = useAsyncData('vercel-status', vercelStatus)
  const depts = useAsyncData('hub-depts', listDepartmentSummaries)
  const [available, setAvailable] = useState<GithubRepo[] | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [repo, setRepo] = useState('')
  const [dept, setDept] = useState('')
  const { push } = useToast()

  const loadAvailable = async () => {
    setLoadingList(true)
    const { data, error } = await githubAvailable()
    setLoadingList(false)
    if (error) push(error.message, 'error'); else setAvailable(data?.repos ?? [])
  }
  const link = async () => {
    const { error } = await linkRepository(repo, dept || null, null)
    if (error) { push(/duplicate|unique/i.test(error.message) ? 'That repository is already linked.' : error.message, 'error'); return }
    push('Repository linked.'); setRepo(''); linked.reload()
  }
  const unlink = async (id: string) => { const { error } = await unlinkRepository(id); if (error) push(error.message, 'error'); else linked.reload() }
  const deptName = (id: string | null) => depts.data?.departments.find((d) => d.id === id)?.name ?? 'No department'

  return (
    <div className="ctf-denv__stack">
      <h4 className="ctf-denv__h3"><Link2 size={14} aria-hidden="true" /> Repositories shown in the Workspace</h4>
      {vercel.data && !vercel.data.configured && <p className="ctf-denv__muted" role="status">Vercel status is not switched on yet: add the <code>VERCEL_TOKEN</code> secret to the Edge Functions to see deployments.</p>}
      {linked.loading ? <SkeletonRows rows={2} /> : (linked.data ?? []).length === 0
        ? <EmptyState icon={Cable} title="No repositories linked yet" description="Link a repository to a department so its team can browse branches, pull requests and CI." />
        : <ul className="ctf-rec__list">{(linked.data ?? []).map((r) => <li key={r.id} className="ctf-rec__row ctf-int__repo"><div className="ctf-rec__main"><strong>{r.full_name}</strong><span className="ctf-denv__muted">{deptName(r.department_id)}</span><WriteAccess repo={r.full_name} policy={policies.data?.find((p) => p.repo_full_name === r.full_name)} appMode={appMode} onSaved={policies.reload} /><DeploymentTargetForm repo={r.full_name} target={targets.data?.find((t) => t.repo_full_name === r.full_name)} onSaved={targets.reload} /></div><Button size="sm" variant="ghost" onClick={() => void unlink(r.id)}>Unlink</Button></li>)}</ul>}
      <div className="ctf-lab__actions">{available === null && <Button variant="secondary" size="sm" loading={loadingList} onClick={() => void loadAvailable()}>Choose from my GitHub repositories</Button>}</div>
      {available !== null && (
        available.length === 0 ? <p className="ctf-denv__muted">The token can't see any repositories. Check which repositories it was granted.</p> : (
          <div className="ctf-lab__row">
            <FieldWrap label="Repository" htmlFor="hub-repo"><Select id="hub-repo" value={repo} onChange={(e) => setRepo(e.target.value)}><option value="">Select…</option>{available.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>)}</Select></FieldWrap>
            <FieldWrap label="Department" htmlFor="hub-dept"><Select id="hub-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Select…</option>{(depts.data?.departments ?? []).filter((d) => d.slug).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FieldWrap>
            <div className="ctf-lab__save"><Button variant="primary" disabled={!repo || !dept} onClick={() => void link()}>Link</Button></div>
          </div>
        )
      )}
    </div>
  )
}

function LaunchCard({ provider, status, url, onChanged }: { provider: 'figma' | 'canva'; status: IntegrationStatus; url: string; onChanged: () => void }) {
  const info = INTEGRATIONS[provider]
  const [value, setValue] = useState(url)
  const [busy, setBusy] = useState(false)
  const { push } = useToast()
  const save = async (next: string | null) => {
    setBusy(true)
    const { error } = await saveLaunchUrl(provider, next)
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(next ? `${info.name} link saved.` : `${info.name} link removed.`); if (!next) setValue(''); onChanged()
  }
  return (
    <Surface className="ctf-int__card">
      <header><span className="ctf-int__icon" aria-hidden="true"><Link2 size={18} /></span><div><h2>{info.name}</h2><p>{info.purpose}</p></div><Badge tone={TONE[status]}>{LABEL[status]}</Badge></header>
      <p className="ctf-denv__muted">{info.name} stays your design tool. This adds an <strong>Open in {info.name}</strong> button to the departments that use it, pointing at your team's own space.</p>
      <div className="ctf-lab__row">
        <FieldWrap label={`${info.name} team link`} htmlFor={`${provider}-url`} hint={provider === 'figma' ? 'e.g. https://www.figma.com/files/team/…' : 'e.g. https://www.canva.com/folder/…'}><Input id={`${provider}-url`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" autoComplete="off" /></FieldWrap>
        <div className="ctf-lab__actions ctf-lab__save"><Button variant="primary" loading={busy} disabled={!value.trim() || value.trim() === url} onClick={() => void save(value)}>Save</Button>{url && <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>Remove</Button>}</div>
      </div>
    </Surface>
  )
}
