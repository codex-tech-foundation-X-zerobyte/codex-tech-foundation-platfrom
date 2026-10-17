import { useState } from 'react'
import { Cable, GitBranch, Link2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Surface, useToast } from '../../components/ui'
import {
  connectGithub, disconnectGithub, githubAvailable, linkRepository, listDepartmentSummaries, listLinkedRepositories, loadIntegrationState, saveLaunchUrl, unlinkRepository,
  type GithubRepo,
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
      <GithubCard status={s.github?.status ?? 'not_connected'} account={typeof s.github?.config?.account === 'string' ? s.github.config.account : ''} onChanged={state.reload} />
      <LaunchCard provider="figma" status={s.figma?.status ?? 'not_connected'} url={typeof s.figma?.config?.url === 'string' ? s.figma.config.url : ''} onChanged={state.reload} />
      <LaunchCard provider="canva" status={s.canva?.status ?? 'not_connected'} url={typeof s.canva?.config?.url === 'string' ? s.canva.config.url : ''} onChanged={state.reload} />
    </div>
  )
}

function GithubCard({ status, account, onChanged }: { status: IntegrationStatus; account: string; onChanged: () => void }) {
  const { push } = useToast()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = status === 'connected'

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
      <header><span className="ctf-int__icon" aria-hidden="true"><GitBranch size={18} /></span><div><h3>GitHub</h3><p>{INTEGRATIONS.github.purpose}</p></div><Badge tone={TONE[status]}>{LABEL[status]}</Badge></header>
      {connected ? (
        <>
          <p className="ctf-denv__muted">Connected as <strong>{account || 'your account'}</strong>. The token is stored on the server and is never shown again.</p>
          <RepositoryLinking />
          <div><Button variant="ghost" loading={busy} onClick={() => void disconnect()}>Disconnect GitHub</Button></div>
        </>
      ) : (
        <>
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

/** Choose which repositories each department can see. Workers only ever see repositories linked to their department. */
function RepositoryLinking() {
  const linked = useAsyncData('linked-repos', listLinkedRepositories)
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
      {linked.loading ? <SkeletonRows rows={2} /> : (linked.data ?? []).length === 0
        ? <EmptyState icon={Cable} title="No repositories linked yet" description="Link a repository to a department so its team can browse branches, pull requests and CI." />
        : <ul className="ctf-rec__list">{(linked.data ?? []).map((r) => <li key={r.id} className="ctf-rec__row"><div className="ctf-rec__main"><strong>{r.full_name}</strong><span className="ctf-denv__muted">{deptName(r.department_id)}</span></div><Button size="sm" variant="ghost" onClick={() => void unlink(r.id)}>Unlink</Button></li>)}</ul>}
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
      <header><span className="ctf-int__icon" aria-hidden="true"><Link2 size={18} /></span><div><h3>{info.name}</h3><p>{info.purpose}</p></div><Badge tone={TONE[status]}>{LABEL[status]}</Badge></header>
      <p className="ctf-denv__muted">{info.name} stays your design tool. This adds an <strong>Open in {info.name}</strong> button to the departments that use it, pointing at your team's own space.</p>
      <div className="ctf-lab__row">
        <FieldWrap label={`${info.name} team link`} htmlFor={`${provider}-url`} hint={provider === 'figma' ? 'e.g. https://www.figma.com/files/team/…' : 'e.g. https://www.canva.com/folder/…'}><Input id={`${provider}-url`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" autoComplete="off" /></FieldWrap>
        <div className="ctf-lab__actions ctf-lab__save"><Button variant="primary" loading={busy} disabled={!value.trim() || value.trim() === url} onClick={() => void save(value)}>Save</Button>{url && <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>Remove</Button>}</div>
      </div>
    </Surface>
  )
}
