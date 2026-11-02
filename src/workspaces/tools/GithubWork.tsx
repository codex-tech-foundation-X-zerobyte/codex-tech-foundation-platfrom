import { useState } from 'react'
import { GitPullRequest, CircleDot } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SkeletonRows, Surface } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import {
  githubIssue, githubIssues, githubPullDetail, githubPulls, isGithubUrl,
  type CheckSummary, type DiscussionComment, type GithubPull, type IssueDetail, type IssueListItem, type ListState, type PullDetail,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ago } from './githubHooks'
import { Open } from './GithubParts'
import { CommentBox, NewIssueForm } from './GithubCompose'
import type { GithubCapabilities } from '../../lib/services'

const STATES: { id: ListState; label: string }[] = [{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }]

function StateFilter({ value, onChange, label }: { value: ListState; onChange: (v: ListState) => void; label: string }) {
  return (
    <div className="ctf-code__tabs" role="group" aria-label={label}>
      {STATES.map((s) => <Button key={s.id} size="sm" variant={value === s.id ? 'primary' : 'secondary'} aria-pressed={value === s.id} onClick={() => onChange(s.id)}>{s.label}</Button>)}
    </div>
  )
}

/** Untrusted text from GitHub, shown through the safe Markdown renderer (no raw HTML ever reaches the page). */
function Body({ text, truncated }: { text: string; truncated: boolean }) {
  if (!text.trim()) return <p className="ctf-denv__muted">No description was written.</p>
  return <><Markdown source={text} />{truncated && <p className="ctf-denv__muted">This text is cut short here. Open it on GitHub to read the rest.</p>}</>
}

function Discussion({ items, title }: { items: DiscussionComment[]; title: string }) {
  if (items.length === 0) return null
  return (
    <Surface>
      <h4 className="ctf-code__h">{title}</h4>
      <ul className="ctf-code__thread">
        {items.map((c) => (
          <li key={c.id}>
            <p className="ctf-denv__muted"><strong>{c.author}</strong> · {ago(c.created_at)}{isGithubUrl(c.html_url) && <> · <Open href={c.html_url} /></>}</p>
            <Body text={c.body} truncated={c.body_truncated} />
          </li>
        ))}
      </ul>
    </Surface>
  )
}

const checkTone = (o: CheckSummary['overall']): 'success' | 'danger' | 'warning' | 'neutral' => (o === 'passing' ? 'success' : o === 'failing' ? 'danger' : o === 'pending' ? 'warning' : 'neutral')
const checkText = (c: CheckSummary) => (c.overall === 'passing' ? `Checks passing (${c.total})` : c.overall === 'failing' ? `${c.failed} check${c.failed === 1 ? '' : 's'} failing` : c.overall === 'pending' ? `${c.pending} check${c.pending === 1 ? '' : 's'} running` : c.overall === 'none' ? 'No checks reported' : 'Checks unavailable')

/* ---- Pull requests ------------------------------------------------------------------------------------------------------------ */

export function PullsView({ repo, caps }: { repo: string; caps: GithubCapabilities }) {
  const [state, setState] = useState<ListState>('open')
  const [open, setOpen] = useState<number | null>(null)
  const list = useAsyncData(`gh-pull-list:${repo}:${state}`, async () => { const r = await githubPulls(repo, state); return { data: r.data?.pulls ?? ([] as GithubPull[]), error: r.error } })
  if (open !== null) return <PullView repo={repo} number={open} canComment={caps.comment} onBack={() => setOpen(null)} />
  return (
    <div className="ctf-denv__stack">
      <StateFilter value={state} onChange={setState} label="Pull request filter" />
      {list.loading ? <SkeletonRows rows={3} /> : list.error ? <ErrorState title="Pull requests couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} />
        : (list.data ?? []).length === 0 ? <EmptyState icon={GitPullRequest} title="No pull requests" description={state === 'open' ? 'Nothing is waiting for review in this repository.' : 'No pull requests match this filter.'} />
        : (
          <ul className="ctf-rec__list">
            {(list.data ?? []).map((p) => (
              <li key={p.number} className="ctf-rec__row">
                <div className="ctf-rec__main"><button type="button" className="ctf-code__link" onClick={() => setOpen(p.number)}><strong>#{p.number} {p.title}</strong></button><span className="ctf-denv__muted">{p.author} · {p.head} → {p.base} · updated {ago(p.updated_at)}</span></div>
                <span className="ctf-gh__badges">{p.state !== 'open' && <Badge tone={p.state === 'merged' ? 'success' : 'neutral'}>{p.state}</Badge>}{p.draft && <Badge tone="neutral">Draft</Badge>}{p.approved > 0 && <Badge tone="success">{p.approved} approved</Badge>}{p.changes_requested > 0 && <Badge tone="danger">{p.changes_requested} changes requested</Badge>}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

function PullView({ repo, number, canComment, onBack }: { repo: string; number: number; canComment: boolean; onBack: () => void }) {
  const d = useAsyncData(`gh-pull:${repo}:${number}`, async () => { const r = await githubPullDetail(repo, number); return { data: (r.data?.pull ?? null) as PullDetail | null, error: r.error } })
  const p = d.data
  return (
    <div className="ctf-denv__stack">
      <div><Button variant="ghost" size="sm" onClick={onBack}>Back to pull requests</Button></div>
      {d.loading ? <SkeletonRows rows={4} /> : d.error || !p ? <ErrorState title="This pull request couldn't load" description={d.errorDetail?.message ?? 'Try again.'} onRetry={d.reload} /> : (
        <>
          <Surface>
            <div className="ctf-denv__asg-top"><div><strong>#{p.number} {p.title}</strong><p className="ctf-denv__muted">{p.author} · {p.head} → {p.base} · updated {ago(p.updated_at)}</p></div>{isGithubUrl(p.html_url) && <Open href={p.html_url} />}</div>
            <p className="ctf-gh__badges">
              <Badge tone={p.state === 'merged' ? 'success' : p.state === 'open' ? 'warning' : 'neutral'}>{p.state}</Badge>
              {p.draft && <Badge tone="neutral">Draft</Badge>}
              <Badge tone={checkTone(p.checks.overall)}>{checkText(p.checks)}</Badge>
              {p.approved > 0 && <Badge tone="success">{p.approved} approved</Badge>}
              {p.changes_requested > 0 && <Badge tone="danger">{p.changes_requested} changes requested</Badge>}
              {p.state === 'open' && <Badge tone={p.mergeable === false ? 'danger' : 'neutral'}>{p.mergeable === true ? 'No conflicts' : p.mergeable === false ? 'Has conflicts' : 'Conflict check not ready yet'}</Badge>}
              {p.labels.map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
            </p>
            {p.reviewers_requested.length > 0 && <p className="ctf-denv__muted">Review requested from {p.reviewers_requested.join(', ')}.</p>}
            <p className="ctf-denv__muted"><span className="ctf-code__add">+{p.additions}</span> <span className="ctf-code__del">−{p.deletions}</span> across {p.changed_files} file{p.changed_files === 1 ? '' : 's'}</p>
            <Body text={p.body} truncated={p.body_truncated} />
          </Surface>
          {p.checks.items.length > 0 && (
            <Surface><h4 className="ctf-code__h">Checks</h4>
              <ul className="ctf-rec__list">{p.checks.items.map((c) => <li key={c.name} className="ctf-rec__row"><div className="ctf-rec__main"><strong>{c.name}</strong></div><Badge tone={c.status !== 'completed' ? 'warning' : c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped' ? 'success' : 'danger'}>{c.status === 'completed' ? c.conclusion ?? 'done' : c.status.replace('_', ' ')}</Badge>{isGithubUrl(c.html_url) && <Open href={c.html_url} />}</li>)}</ul>
            </Surface>
          )}
          {p.reviews.length > 0 && (
            <Surface><h4 className="ctf-code__h">Reviews</h4>
              <ul className="ctf-code__thread">{p.reviews.map((r) => <li key={r.id}><p className="ctf-denv__muted"><strong>{r.author}</strong> <Badge tone={r.state === 'approved' ? 'success' : r.state === 'changes_requested' ? 'danger' : 'neutral'}>{r.state.replace('_', ' ') || 'commented'}</Badge> · {ago(r.submitted_at)}</p>{r.body.trim() && <Body text={r.body} truncated={false} />}</li>)}</ul>
            </Surface>
          )}
          <Discussion items={p.comments} title="Conversation" />
          <CommentBox repo={repo} number={number} allowed={canComment} onPosted={d.reload} />
          {p.files.map((f) => (
            <Surface key={f.filename}>
              <div className="ctf-code__filehead"><strong className="ctf-code__name">{f.filename}</strong><span className="ctf-gh__badges"><Badge tone={f.status === 'added' ? 'success' : f.status === 'removed' ? 'danger' : 'warning'}>{f.status}</Badge><span className="ctf-code__add">+{f.additions}</span><span className="ctf-code__del">−{f.deletions}</span></span></div>
              {f.patch === null ? <p className="ctf-denv__muted" role="status">GitHub did not provide a text diff for this file (binary or very large).</p> : (
                <pre className="ctf-code__pre ctf-code__diff" tabIndex={0} aria-label={`Changes to ${f.filename}`}>{f.patch.split('\n').map((line, i) => <span key={i} className={line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-del' : line.startsWith('@@') ? 'is-hunk' : undefined}>{line}{'\n'}</span>)}</pre>
              )}
              {f.patch_truncated && <p className="ctf-denv__muted">This diff is cut short here. Open the pull request on GitHub for the full change.</p>}
            </Surface>
          ))}
          {p.files_truncated && <p className="ctf-denv__muted">Only the first {p.files.length} of {p.changed_files} files are shown.</p>}
        </>
      )}
    </div>
  )
}

/* ---- Issues ------------------------------------------------------------------------------------------------------------------- */

export function IssuesView({ repo, caps }: { repo: string; caps: GithubCapabilities }) {
  const [state, setState] = useState<ListState>('open')
  const [pages, setPages] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const list = useAsyncData(`gh-issue-list:${repo}:${state}:${pages}:${tick}`, async () => {
    const all: IssueListItem[] = []
    let hasMore = false
    for (let pg = 1; pg <= pages; pg++) {
      const r = await githubIssues(repo, state, pg)
      if (r.error || !r.data) return { data: null, error: r.error ?? new Error('Issues could not load.') }
      all.push(...r.data.issues); hasMore = r.data.has_more
    }
    return { data: { issues: all, hasMore }, error: null }
  })
  if (open !== null) return <IssueView repo={repo} number={open} canComment={caps.comment} onBack={() => setOpen(null)} />
  const change = (v: ListState) => { setState(v); setPages(1) }
  return (
    <div className="ctf-denv__stack">
      {caps.issue && <NewIssueForm repo={repo} onCreated={() => { setState('open'); setPages(1); setTick((t) => t + 1) }} />}
      <StateFilter value={state} onChange={change} label="Issue filter" />
      {list.loading ? <SkeletonRows rows={3} /> : list.error ? <ErrorState title="Issues couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} />
        : (list.data?.issues ?? []).length === 0 ? <EmptyState icon={CircleDot} title="No issues" description={state === 'open' ? 'There are no open issues in this repository.' : 'No issues match this filter.'} />
        : (
          <>
            <ul className="ctf-rec__list">
              {(list.data?.issues ?? []).map((i) => (
                <li key={i.number} className="ctf-rec__row">
                  <div className="ctf-rec__main"><button type="button" className="ctf-code__link" onClick={() => setOpen(i.number)}><strong>#{i.number} {i.title}</strong></button><span className="ctf-denv__muted">{i.author} · {i.comments} comment{i.comments === 1 ? '' : 's'} · updated {ago(i.updated_at)}{i.assignees.length > 0 && ` · assigned to ${i.assignees.join(', ')}`}</span></div>
                  <span className="ctf-gh__badges">{i.state === 'closed' && <Badge tone="neutral">closed</Badge>}{i.labels.slice(0, 3).map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}</span>
                </li>
              ))}
            </ul>
            {list.data?.hasMore && <div><Button variant="secondary" onClick={() => setPages(pages + 1)}>Load more issues</Button></div>}
          </>
        )}
    </div>
  )
}

function IssueView({ repo, number, canComment, onBack }: { repo: string; number: number; canComment: boolean; onBack: () => void }) {
  const d = useAsyncData(`gh-issue:${repo}:${number}`, async () => { const r = await githubIssue(repo, number); return { data: (r.data?.issue ?? null) as IssueDetail | null, error: r.error } })
  const i = d.data
  return (
    <div className="ctf-denv__stack">
      <div><Button variant="ghost" size="sm" onClick={onBack}>Back to issues</Button></div>
      {d.loading ? <SkeletonRows rows={4} /> : d.error || !i ? <ErrorState title="This issue couldn't load" description={d.errorDetail?.message ?? 'Try again.'} onRetry={d.reload} /> : (
        <>
          <Surface>
            <div className="ctf-denv__asg-top"><div><strong>#{i.number} {i.title}</strong><p className="ctf-denv__muted">{i.author} · opened {ago(i.created_at)}</p></div>{isGithubUrl(i.html_url) && <Open href={i.html_url} />}</div>
            <p className="ctf-gh__badges"><Badge tone={i.state === 'open' ? 'warning' : 'neutral'}>{i.state}{i.state_reason ? ` (${i.state_reason.replace('_', ' ')})` : ''}</Badge>{i.milestone && <Badge tone="neutral">{i.milestone}</Badge>}{i.labels.map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}</p>
            {i.assignees.length > 0 && <p className="ctf-denv__muted">Assigned to {i.assignees.join(', ')}.</p>}
            <Body text={i.body} truncated={i.body_truncated} />
          </Surface>
          <Discussion items={i.comments_list} title="Conversation" />
          {i.comments_truncated && <p className="ctf-denv__muted">Only the newest {i.comments_list.length} comments are shown.</p>}
          <CommentBox repo={repo} number={number} allowed={canComment} onPosted={d.reload} />
        </>
      )}
    </div>
  )
}
