import { useState } from 'react'
import { ChevronRight, File as FileIcon, Folder, GitBranch, GitCommit } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SkeletonRows, Surface } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import {
  githubBranches, githubCapabilities, githubCommit, githubCommits, githubContents, githubReadme, isGithubUrl, listGithubActivity,
  type CommitDetail, type CommitListItem, type GithubActivityRow, type RepoContents, type RepoFile,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Viewer } from '../DepartmentWork'
import { ago, useRepositories } from './githubHooks'
import { Open, RepoSelect } from './GithubParts'
import { IssuesView, PullsView } from './GithubWork'
import { DeploymentsView } from './GithubDeployments'

type Tab = 'files' | 'commits' | 'pulls' | 'issues' | 'deployments' | 'activity'
const TABS: { id: Tab; label: string }[] = [{ id: 'files', label: 'Files' }, { id: 'commits', label: 'Commits' }, { id: 'pulls', label: 'Pull requests' }, { id: 'issues', label: 'Issues' }, { id: 'deployments', label: 'Deployments' }, { id: 'activity', label: 'Activity' }]

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

/** Code, pull request, issue and deployment browser for linked repositories. GitHub stays the source of truth; nothing here writes to a repository. */
export function GithubCode({ base, viewer }: { base: '/worker' | '/admin'; viewer: Viewer }) {
  const { gate, repos } = useRepositories(base, viewer)
  const [pick, setPick] = useState('')
  const [tab, setTab] = useState<Tab>('files')
  const [ref, setRef] = useState('')
  const repo = pick || repos[0]?.full_name || ''
  const caps = useAsyncData(`gh-caps:${repo}`, async () => { if (!repo) return { data: { comment: false, issue: false }, error: null }; return githubCapabilities(repo) })
  const capabilities = caps.data ?? { comment: false, issue: false }
  const branches = useAsyncData(`gh-branches:${repo}`, async () => { if (!repo) return { data: [] as { name: string; protected: boolean }[], error: null }; const r = await githubBranches(repo); return { data: r.data?.branches ?? [], error: r.error } })
  if (gate) return <>{gate}</>
  const choose = (v: string) => { setPick(v); setRef('') }
  const activeRef = ref || null
  return (
    <div className="ctf-denv__stack">
      <div className="ctf-code__bar">
        <RepoSelect repos={repos} value={repo} onChange={choose} />
        <div className="ctf-code__ref">
          <label htmlFor="gh-ref" className="ctf-code__label"><GitBranch size={14} aria-hidden="true" /> Branch</label>
          <select id="gh-ref" className="ctf-code__select" value={ref} onChange={(e) => setRef(e.target.value)} disabled={branches.loading || !!branches.error}>
            <option value="">Default branch</option>
            {(branches.data ?? []).map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>)}
          </select>
        </div>
      </div>
      <div className="ctf-code__tabs" role="group" aria-label="Repository view">
        {TABS.map((t) => <Button key={t.id} size="sm" variant={tab === t.id ? 'primary' : 'secondary'} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</Button>)}
      </div>
      {/* Keyed by repository and branch so switching either starts from a clean state instead of showing the previous repo's path. */}
      {tab === 'files' && <FilesView key={`${repo}@${ref}`} repo={repo} gitRef={activeRef} />}
      {tab === 'commits' && <CommitsView key={`${repo}@${ref}`} repo={repo} gitRef={activeRef} />}
      {tab === 'pulls' && <PullsView key={repo} repo={repo} caps={capabilities} />}
      {tab === 'issues' && <IssuesView key={repo} repo={repo} caps={capabilities} />}
      {tab === 'deployments' && <DeploymentsView key={repo} repo={repo} />}
      {tab === 'activity' && <ActivityView key={repo} repo={repo} />}
    </div>
  )
}

/* ---- Files -------------------------------------------------------------------------------------------------------------------- */

function FilesView({ repo, gitRef }: { repo: string; gitRef: string | null }) {
  const [path, setPath] = useState('')
  const node = useAsyncData(`gh-contents:${repo}:${gitRef}:${path}`, async () => { const r = await githubContents(repo, path, gitRef); return { data: r.data as RepoContents | null, error: r.error } })
  const readme = useAsyncData(`gh-readme:${repo}:${gitRef}`, async () => { const r = await githubReadme(repo, gitRef); return { data: r.data?.file ?? null, error: r.error } })
  const parts = path ? path.split('/') : []
  const crumbs = (
    <nav className="ctf-code__crumbs" aria-label="Path">
      <button type="button" className="ctf-code__crumb" onClick={() => setPath('')} aria-current={path === '' ? 'page' : undefined}>{repo.split('/')[1]}</button>
      {parts.map((p, i) => {
        const to = parts.slice(0, i + 1).join('/')
        return <span key={to} className="ctf-code__crumbwrap"><ChevronRight size={12} aria-hidden="true" /><button type="button" className="ctf-code__crumb" onClick={() => setPath(to)} aria-current={i === parts.length - 1 ? 'page' : undefined}>{p}</button></span>
      })}
    </nav>
  )
  return (
    <div className="ctf-denv__stack">
      {crumbs}
      {node.loading ? <SkeletonRows rows={4} /> : node.error ? <ErrorState title="This couldn't load" description={node.errorDetail?.message ?? 'Try again.'} onRetry={node.reload} />
        : node.data?.type === 'file' ? <FileView file={node.data.file} />
        : node.data?.type === 'dir' ? (
          <>
            {node.data.entries.length === 0 ? <EmptyState title="This folder is empty" description="There is nothing in this folder on this branch." /> : (
              <ul className="ctf-code__tree">
                {node.data.entries.map((e) => (
                  <li key={e.path}>
                    <button type="button" className="ctf-code__entry" disabled={e.type !== 'dir' && e.type !== 'file'} onClick={() => setPath(e.path)}>
                      {e.type === 'dir' ? <Folder size={15} aria-hidden="true" /> : <FileIcon size={15} aria-hidden="true" />}
                      <span className="ctf-code__name">{e.name}</span>
                      {e.type === 'file' && <span className="ctf-denv__muted">{kb(e.size)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {node.data.truncated && <p className="ctf-denv__muted">Only the first 300 entries are shown. Open the folder on GitHub for the rest.</p>}
            {path === '' && readme.data && readme.data.kind === 'text' && readme.data.text && (
              <Surface><h4 className="ctf-code__h">{readme.data.name}</h4><Markdown source={readme.data.text} /></Surface>
            )}
          </>
        ) : null}
    </div>
  )
}

function FileView({ file }: { file: RepoFile }) {
  return (
    <Surface>
      <div className="ctf-denv__asg-top"><div><strong>{file.name}</strong><p className="ctf-denv__muted">{kb(file.size)}</p></div>{isGithubUrl(file.html_url) && <Open href={file.html_url} />}</div>
      {file.kind === 'text' && file.text !== null
        ? <pre className="ctf-code__pre" tabIndex={0} aria-label={`Contents of ${file.name}`}><code>{file.text}</code></pre>
        : <p className="ctf-denv__muted" role="status">{file.reason}</p>}
    </Surface>
  )
}

/* ---- Commits ------------------------------------------------------------------------------------------------------------------ */

function CommitsView({ repo, gitRef }: { repo: string; gitRef: string | null }) {
  const [pages, setPages] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const list = useAsyncData(`gh-commits:${repo}:${gitRef}:${pages}`, async () => {
    const all: CommitListItem[] = []
    let hasMore = false
    for (let p = 1; p <= pages; p++) {
      const r = await githubCommits(repo, gitRef, p)
      if (r.error || !r.data) return { data: null, error: r.error ?? new Error('Commits could not load.') }
      all.push(...r.data.commits); hasMore = r.data.has_more
    }
    return { data: { commits: all, hasMore }, error: null }
  })
  if (open) return <CommitView repo={repo} sha={open} onBack={() => setOpen(null)} />
  if (list.loading) return <SkeletonRows rows={4} />
  if (list.error) return <ErrorState title="Commits couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} />
  const commits = list.data?.commits ?? []
  if (commits.length === 0) return <EmptyState icon={GitCommit} title="No commits" description="This branch has no commits yet." />
  return (
    <div className="ctf-denv__stack">
      <ul className="ctf-rec__list">
        {commits.map((c) => (
          <li key={c.sha} className="ctf-rec__row">
            <div className="ctf-rec__main"><button type="button" className="ctf-code__link" onClick={() => setOpen(c.sha)}><code>{c.short}</code> {c.message}</button><span className="ctf-denv__muted">{c.author} · {ago(c.date)}</span></div>
          </li>
        ))}
      </ul>
      {list.data?.hasMore && <div><Button variant="secondary" onClick={() => setPages(pages + 1)}>Load older commits</Button></div>}
    </div>
  )
}

const statusTone = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => (s === 'added' ? 'success' : s === 'removed' ? 'danger' : s === 'modified' || s === 'renamed' ? 'warning' : 'neutral')

function CommitView({ repo, sha, onBack }: { repo: string; sha: string; onBack: () => void }) {
  const d = useAsyncData(`gh-commit:${repo}:${sha}`, async () => { const r = await githubCommit(repo, sha); return { data: (r.data?.commit ?? null) as CommitDetail | null, error: r.error } })
  return (
    <div className="ctf-denv__stack">
      <div><Button variant="ghost" size="sm" onClick={onBack}>Back to commits</Button></div>
      {d.loading ? <SkeletonRows rows={4} /> : d.error || !d.data ? <ErrorState title="This commit couldn't load" description={d.errorDetail?.message ?? 'Try again.'} onRetry={d.reload} /> : (
        <>
          <Surface>
            <div className="ctf-denv__asg-top"><div><strong>{d.data.message}</strong><p className="ctf-denv__muted"><code>{d.data.short}</code> · {d.data.author} · {ago(d.data.date)}</p></div>{isGithubUrl(d.data.html_url) && <Open href={d.data.html_url} />}</div>
            {d.data.message_full.includes('\n') && <pre className="ctf-code__msg">{d.data.message_full}</pre>}
            <p className="ctf-denv__muted"><span className="ctf-code__add">+{d.data.stats.additions}</span> <span className="ctf-code__del">−{d.data.stats.deletions}</span> across {d.data.files_total} file{d.data.files_total === 1 ? '' : 's'}</p>
          </Surface>
          {d.data.files.map((f) => (
            <Surface key={f.filename}>
              <div className="ctf-code__filehead"><strong className="ctf-code__name">{f.filename}</strong><span className="ctf-gh__badges"><Badge tone={statusTone(f.status)}>{f.status}</Badge><span className="ctf-code__add">+{f.additions}</span><span className="ctf-code__del">−{f.deletions}</span></span></div>
              {f.patch === null ? <p className="ctf-denv__muted" role="status">GitHub did not provide a text diff for this file (binary or very large). Open the commit on GitHub to see it.</p> : (
                <pre className="ctf-code__pre ctf-code__diff" tabIndex={0} aria-label={`Changes to ${f.filename}`}>{f.patch.split('\n').map((line, i) => <span key={i} className={line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-del' : line.startsWith('@@') ? 'is-hunk' : undefined}>{line}{'\n'}</span>)}</pre>
              )}
              {f.patch_truncated && <p className="ctf-denv__muted">This diff is cut short here. Open the commit on GitHub for the full change.</p>}
            </Surface>
          ))}
          {d.data.files_truncated && <p className="ctf-denv__muted">Only the first {d.data.files.length} of {d.data.files_total} files are shown.</p>}
        </>
      )}
    </div>
  )
}

/* ---- Activity (fed by signed GitHub webhooks) --------------------------------------------------------------------------------- */

const activityTone = (a: GithubActivityRow): 'success' | 'danger' | 'warning' | 'neutral' =>
  a.state === 'failure' || a.state === 'error' || a.state === 'changes_requested' ? 'danger' : a.state === 'success' || a.state === 'merged' || a.state === 'approved' ? 'success' : a.state === 'opened' || a.state === 'reopened' ? 'warning' : 'neutral'

function ActivityView({ repo }: { repo: string }) {
  const feed = useAsyncData(`gh-activity:${repo}`, async () => listGithubActivity(repo))
  if (feed.loading) return <SkeletonRows rows={4} />
  if (feed.error) return <ErrorState title="Activity couldn't load" description={feed.errorDetail?.message ?? 'Try again.'} onRetry={feed.reload} />
  const rows = feed.data ?? []
  if (rows.length === 0) return <EmptyState icon={GitCommit} title="No activity yet" description="Pushes, pull requests, reviews, issues, builds and deployments appear here as GitHub reports them. Nothing shows until the GitHub App's webhook is connected and a new event happens." />
  return (
    <ul className="ctf-rec__list">
      {rows.map((a) => (
        <li key={a.id} className="ctf-rec__row">
          <div className="ctf-rec__main"><strong>{a.title}</strong><span className="ctf-denv__muted">{a.kind.replace('_', ' ')} · {a.actor || 'unknown'} · {ago(a.occurred_at)}</span></div>
          {a.state && <Badge tone={activityTone(a)}>{a.state.replace('_', ' ')}</Badge>}
          {isGithubUrl(a.url) && <Open href={a.url} />}
        </li>
      ))}
    </ul>
  )
}
