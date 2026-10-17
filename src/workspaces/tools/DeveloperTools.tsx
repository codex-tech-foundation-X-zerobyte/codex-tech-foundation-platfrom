import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink, GitBranch, GitCommit, GitPullRequest, Trash2 } from 'lucide-react'
import { Badge, Button, CopyButton, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Surface, useToast } from '../../components/ui'
import {
  clearCaptured, createInbox, deleteInbox, githubDetail, githubPulls, githubRepos, githubRuns, listCaptured, listInboxes, loadIntegrationState,
  subscribeToCaptured, webhookUrl, type DepartmentRow, type GithubDetail, type GithubPull, type GithubRepo, type GithubRun, type GithubDeployment, type WebhookRequest,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Viewer } from '../DepartmentWork'

const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/* ---- Webhook tester ------------------------------------------------------------------------------------------------------------- */

export function WebhookTester({ row }: { row: DepartmentRow }) {
  const inboxes = useAsyncData(`inboxes:${row.id}`, () => listInboxes(row.id))
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { push } = useToast()
  const selected = (inboxes.data ?? []).find((i) => i.id === open) ?? null

  const create = async () => {
    const { error } = await createInbox(row.id, name)
    if (error) { push(error.message, 'error'); return }
    setName(''); inboxes.reload()
  }
  const remove = async (id: string) => {
    const { error } = await deleteInbox(id)
    if (error) push(error.message, 'error'); else { if (open === id) setOpen(null); inboxes.reload() }
  }

  return (
    <div className="ctf-denv__stack">
      <p className="ctf-denv__muted">Create an inbox, point a service at its URL, and see every request it sends: method, headers and body. Anyone who has the URL can post to it, so never use it for real secrets.</p>
      <div className="ctf-lab__row">
        <FieldWrap label="New inbox" htmlFor="wh-name"><Input id="wh-name" value={name} maxLength={80} placeholder="e.g. Stripe test" onChange={(e) => setName(e.target.value)} autoComplete="off" /></FieldWrap>
        <div className="ctf-lab__save"><Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>Create inbox</Button></div>
      </div>
      {inboxes.loading ? <SkeletonRows rows={2} /> : inboxes.error ? <ErrorState title="Inboxes couldn't load" description={inboxes.errorDetail?.message ?? 'Try again.'} onRetry={inboxes.reload} /> : (inboxes.data ?? []).length === 0
        ? <EmptyState title="No inboxes yet" description="Create one to get a URL you can send test webhooks to." />
        : (
          <ul className="ctf-rec__list">
            {(inboxes.data ?? []).map((i) => (
              <li key={i.id} className="ctf-rec__row">
                <button type="button" className="ctf-rec__main" aria-pressed={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}><strong>{i.name}</strong><span className="ctf-denv__muted">Created {ago(i.created_at)}</span></button>
                <Button variant="ghost" size="sm" aria-label={`Delete ${i.name}`} icon={<Trash2 size={14} />} onClick={() => void remove(i.id)} />
              </li>
            ))}
          </ul>
        )}
      {selected && <InboxView key={selected.id} inbox={selected} />}
    </div>
  )
}

function InboxView({ inbox }: { inbox: { id: string; name: string; token: string } }) {
  const requests = useAsyncData(`captured:${inbox.id}`, () => listCaptured(inbox.id))
  const { push } = useToast()
  const url = webhookUrl(inbox.token)
  useEffect(() => subscribeToCaptured(inbox.id, () => requests.reload()), [inbox.id, requests])
  const clear = async () => { const { error } = await clearCaptured(inbox.id); if (error) push(error.message, 'error'); else requests.reload() }
  const pretty = (b: string) => { try { return JSON.stringify(JSON.parse(b), null, 2) } catch { return b } }
  const list = requests.data ?? []

  return (
    <Surface>
      <h3 className="ctf-denv__h3">{inbox.name}</h3>
      <div className="ctf-wh__url"><code>{url}</code><CopyButton value={url} label="Copy URL" /></div>
      <p className="ctf-denv__muted">Try it: <code>curl -X POST {url} -H &quot;content-type: application/json&quot; -d &apos;{`{"hello":"world"}`}&apos;</code></p>
      <div className="ctf-denv__board-head"><h4>{list.length} captured {list.length === 1 ? 'request' : 'requests'} (latest 50 shown)</h4>{list.length > 0 && <Button variant="ghost" size="sm" onClick={() => void clear()}>Clear all</Button>}</div>
      {requests.loading ? <SkeletonRows rows={2} /> : list.length === 0 ? (
        <EmptyState title="Nothing received yet" description="Send a request to the URL above. If nothing ever arrives, check that the webhook-inbox function is deployed with --no-verify-jwt." />
      ) : (
        <ul className="ctf-wh__list">
          {list.map((r: WebhookRequest) => (
            <li key={r.id}>
              <details>
                <summary><Badge tone={r.method === 'GET' ? 'neutral' : 'accent'}>{r.method}</Badge> <span className="ctf-lab__mono">{r.path}{r.query ? `?${r.query}` : ''}</span> <time>{ago(r.received_at)}</time></summary>
                <h5>Headers</h5><pre>{Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                <h5>Body</h5><pre>{r.body ? pretty(r.body) : '(empty)'}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  )
}

/* ---- GitHub ----------------------------------------------------------------------------------------------------------------------- */

/** Shared gate: GitHub connected? Any repositories linked to this department? Otherwise say exactly what is missing. */
function useRepositories(base: '/worker' | '/admin', viewer: Viewer) {
  const state = useAsyncData('integration-state', loadIntegrationState)
  const connected = state.data?.github?.status === 'connected'
  const repos = useAsyncData(`gh-repos:${connected}`, async () => {
    if (!connected) return { data: { repos: [] as GithubRepo[] }, error: null }
    const r = await githubRepos()
    return { data: r.data ?? { repos: [] as GithubRepo[] }, error: r.error }
  })
  const hubLink = viewer.isMainAdmin ? <Link to={`${base}/integrations`}>Open Integrations</Link> : null

  let gate: React.ReactNode = null
  if (state.loading || (connected && repos.loading)) gate = <SkeletonRows rows={3} />
  else if (!connected) gate = <EmptyState icon={GitBranch} title="GitHub is not connected" description={viewer.isMainAdmin ? 'Connect GitHub in the Integrations hub to browse repositories, pull requests and CI here.' : 'A Main Admin needs to connect GitHub before repositories appear here.'} action={hubLink ?? undefined} />
  else if (repos.error) gate = <ErrorState title="GitHub couldn't be reached" description={repos.errorDetail?.message ?? 'Try again.'} onRetry={repos.reload} />
  else if ((repos.data?.repos ?? []).length === 0) gate = <EmptyState icon={GitBranch} title="No repositories linked to this department" description={viewer.isMainAdmin ? 'Link a repository to this department in the Integrations hub.' : 'Ask a Main Admin to link your department\u2019s repositories. You only see repositories linked to your department.'} action={hubLink ?? undefined} />
  return { gate, repos: (repos.data?.repos ?? []).filter((r) => !r.error), broken: (repos.data?.repos ?? []).filter((r) => r.error), reload: repos.reload }
}

function RepoSelect({ repos, value, onChange }: { repos: GithubRepo[]; value: string; onChange: (v: string) => void }) {
  return <FieldWrap label="Repository" htmlFor="gh-repo"><Select id="gh-repo" value={value} onChange={(e) => onChange(e.target.value)}>{repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}</Select></FieldWrap>
}
const Open = ({ href }: { href: string }) => <a className="ctf-gh__open" href={href} target="_blank" rel="noopener noreferrer">Open in GitHub <ExternalLink size={12} aria-hidden="true" /></a>

export function GithubRepos({ base, viewer }: { base: '/worker' | '/admin'; viewer: Viewer }) {
  const { gate, repos, broken } = useRepositories(base, viewer)
  const [pick, setPick] = useState('')
  const repo = pick || repos[0]?.full_name || ''
  const detail = useAsyncData(`gh-detail:${repo}`, async () => { if (!repo) return { data: null as GithubDetail | null, error: null }; const r = await githubDetail(repo); return { data: r.data, error: r.error } })
  if (gate) return <>{gate}</>
  const d = detail.data
  return (
    <div className="ctf-denv__stack">
      {broken.map((b) => <Surface key={b.full_name} variant="warning" className="ctf-denv__warn" role="alert"><span><strong>{b.full_name}</strong>: {b.error}</span></Surface>)}
      <RepoSelect repos={repos} value={repo} onChange={setPick} />
      {detail.loading ? <SkeletonRows rows={3} /> : detail.error ? <ErrorState title="Repository couldn't load" description={detail.errorDetail?.message ?? 'Try again.'} onRetry={detail.reload} /> : d && (
        <>
          <Surface>
            <div className="ctf-denv__asg-top"><div><strong>{d.repo.full_name}</strong>{d.repo.private && <> <Badge tone="neutral">Private</Badge></>}<p className="ctf-denv__muted">{d.repo.description || 'No description.'}</p></div><Open href={d.repo.html_url} /></div>
            <p className="ctf-denv__muted">Default branch <code>{d.repo.default_branch}</code>{d.repo.language ? ` · ${d.repo.language}` : ''} · last push {ago(d.repo.pushed_at)}</p>
          </Surface>
          <div className="ctf-lab__grid">
            <section><h4><GitBranch size={14} aria-hidden="true" /> Branches</h4><ul className="ctf-gh__list">{d.branches.map((b) => <li key={b.name}><code>{b.name}</code>{b.protected && <Badge tone="neutral">protected</Badge>}</li>)}</ul></section>
            <section><h4><GitCommit size={14} aria-hidden="true" /> Recent commits</h4><ul className="ctf-gh__list">{d.commits.map((c) => <li key={c.sha}><a href={c.html_url} target="_blank" rel="noopener noreferrer"><code>{c.sha}</code> {c.message}</a><span className="ctf-denv__muted">{c.author} · {ago(c.date)}</span></li>)}</ul></section>
            <section><h4>Open issues</h4>{d.issues.length === 0 ? <p className="ctf-denv__muted">No open issues.</p> : <ul className="ctf-gh__list">{d.issues.map((i) => <li key={i.number}><a href={i.html_url} target="_blank" rel="noopener noreferrer">#{i.number} {i.title}</a><span className="ctf-denv__muted">{i.author}{i.labels.length ? ` · ${i.labels.join(', ')}` : ''}</span></li>)}</ul>}</section>
          </div>
        </>
      )}
    </div>
  )
}

export function GithubPulls({ base, viewer }: { base: '/worker' | '/admin'; viewer: Viewer }) {
  const { gate, repos } = useRepositories(base, viewer)
  const [pick, setPick] = useState('')
  const repo = pick || repos[0]?.full_name || ''
  const pulls = useAsyncData(`gh-pulls:${repo}`, async () => { if (!repo) return { data: [] as GithubPull[], error: null }; const r = await githubPulls(repo); return { data: r.data?.pulls ?? [], error: r.error } })
  if (gate) return <>{gate}</>
  return (
    <div className="ctf-denv__stack">
      <RepoSelect repos={repos} value={repo} onChange={setPick} />
      {pulls.loading ? <SkeletonRows rows={3} /> : pulls.error ? <ErrorState title="Pull requests couldn't load" description={pulls.errorDetail?.message ?? 'Try again.'} onRetry={pulls.reload} /> : (pulls.data ?? []).length === 0
        ? <EmptyState icon={GitPullRequest} title="No open pull requests" description="Nothing is waiting for review in this repository." />
        : (
          <ul className="ctf-rec__list">
            {(pulls.data ?? []).map((p) => (
              <li key={p.number} className="ctf-rec__row">
                <div className="ctf-rec__main"><strong>#{p.number} {p.title}</strong><span className="ctf-denv__muted">{p.author} · {p.head} → {p.base} · updated {ago(p.updated_at)}</span></div>
                <span className="ctf-gh__badges">{p.draft && <Badge tone="neutral">Draft</Badge>}{p.approved > 0 && <Badge tone="success">{p.approved} approved</Badge>}{p.changes_requested > 0 && <Badge tone="danger">{p.changes_requested} changes requested</Badge>}{!p.draft && p.approved === 0 && p.changes_requested === 0 && <Badge tone="warning">Needs review</Badge>}</span>
                <Open href={p.html_url} />
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

const runTone = (r: GithubRun): 'success' | 'danger' | 'warning' | 'neutral' => (r.status !== 'completed' ? 'warning' : r.conclusion === 'success' ? 'success' : r.conclusion === 'failure' || r.conclusion === 'timed_out' ? 'danger' : 'neutral')

export function GithubActions({ base, viewer }: { base: '/worker' | '/admin'; viewer: Viewer }) {
  const { gate, repos } = useRepositories(base, viewer)
  const [pick, setPick] = useState('')
  const repo = pick || repos[0]?.full_name || ''
  const data = useAsyncData(`gh-runs:${repo}`, async () => { if (!repo) return { data: { runs: [] as GithubRun[], deployments: [] as GithubDeployment[] }, error: null }; const r = await githubRuns(repo); return { data: r.data ?? { runs: [], deployments: [] }, error: r.error } })
  if (gate) return <>{gate}</>
  const runs = data.data?.runs ?? [], deployments = data.data?.deployments ?? []
  return (
    <div className="ctf-denv__stack">
      <RepoSelect repos={repos} value={repo} onChange={setPick} />
      {data.loading ? <SkeletonRows rows={3} /> : data.error ? <ErrorState title="CI runs couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <>
          <h3 className="ctf-denv__h3">Workflow runs</h3>
          {runs.length === 0 ? <EmptyState title="No workflow runs" description="This repository has not run any GitHub Actions." /> : (
            <ul className="ctf-rec__list">{runs.map((r) => <li key={r.id} className="ctf-rec__row"><div className="ctf-rec__main"><strong>{r.name}</strong><span className="ctf-denv__muted">{r.branch} · {r.event} · {r.actor} · {ago(r.created_at)}</span></div><Badge tone={runTone(r)}>{r.status === 'completed' ? r.conclusion ?? 'done' : r.status.replace('_', ' ')}</Badge><Open href={r.html_url} /></li>)}</ul>
          )}
          <h3 className="ctf-denv__h3">Deployments</h3>
          {deployments.length === 0 ? <p className="ctf-denv__muted">No deployments recorded for this repository.</p> : (
            <ul className="ctf-rec__list">{deployments.map((d) => <li key={d.id} className="ctf-rec__row"><div className="ctf-rec__main"><strong>{d.environment}</strong><span className="ctf-denv__muted">{d.ref} · {d.creator} · {ago(d.created_at)}</span></div></li>)}</ul>
          )}
        </>
      )}
    </div>
  )
}
