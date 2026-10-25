import { Linkify } from '../components/Linkify'
import { useRef, useState } from 'react'
import { ExternalLink, Link2, Paperclip, Trash2 } from 'lucide-react'
import { Badge, Button, ErrorState, FieldWrap, Input, Select, SkeletonRows, Textarea, useToast } from '../components/ui'
import {
  addChecklistItem, addTaskComment, addTaskDependency, addTaskLink, getProjectFileUrl, loadTaskDetail, moveTaskToStage, removeChecklistItem, removeTaskDependency,
  removeTaskLink, setChecklistDone, setReviewState, setWatching, uploadProjectFile, type DepartmentTask,
} from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import type { Viewer } from './DepartmentWork'

const REVIEW_LABEL = { none: 'Not in review', requested: 'Waiting for review', approved: 'Approved', changes_requested: 'Changes requested' } as const
const REVIEW_TONE = { none: 'neutral', requested: 'warning', approved: 'success', changes_requested: 'danger' } as const
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const MAX_MB = 20

/** Everything about one department task: review, checklist, dependencies, GitHub links, files and the conversation. */
export function TaskDrawer({ task, stages, siblings, viewer, onChanged }: { task: DepartmentTask; stages: string[]; siblings: DepartmentTask[]; viewer: Viewer; onChanged: () => void }) {
  const detail = useAsyncData(`task-detail:${task.id}`, () => loadTaskDetail(task.id, viewer.id))
  const { push } = useToast()
  const [item, setItem] = useState('')
  const [comment, setComment] = useState('')
  const [link, setLink] = useState('')
  const [dep, setDep] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const isAssignee = !!viewer.id && task.assignee_id === viewer.id
  const isAdmin = viewer.isDepartmentAdmin || viewer.isMainAdmin
  const canWork = isAssignee || isAdmin
  const review = (task.review_state ?? 'none') as keyof typeof REVIEW_LABEL

  const run = async (fn: () => Promise<{ error: Error | null }>, ok?: string, after?: () => void) => {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    if (ok) push(ok)
    detail.reload(); after?.(); onChanged()
  }
  const d = detail.data
  const taken = new Set([task.id, ...(d?.dependencies ?? []).map((x) => x.depends_on_task_id)])

  if (detail.loading) return <SkeletonRows rows={5} height="48px" />
  if (detail.error || !d) return <ErrorState title="This task couldn't load" description={detail.errorDetail?.message ?? 'Try again.'} onRetry={detail.reload} />
  const doneCount = d.checklist.filter((c) => c.done).length

  return (
    <div className="ctf-td">
      <div className="ctf-td__meta">
        <Badge tone={REVIEW_TONE[review]}>{REVIEW_LABEL[review]}</Badge>
        <span>{task.project_name}</span>
        <span>{task.assignee_id === viewer.id ? 'Assigned to you' : task.assignee_name ? `Assigned to ${task.assignee_name}` : 'Unassigned'}</span>
        {task.due_date && <span>Due {new Date(`${task.due_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
        <Badge tone="neutral">{task.priority}</Badge>
        {viewer.id && <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => setWatching(task.id, viewer.id as string, !d.watching), d.watching ? 'You stopped watching.' : 'You are watching this task.')}>{d.watching ? 'Stop watching' : 'Watch'}</Button>}
      </div>
      {task.description && <p className="ctf-td__desc"><Linkify text={task.description} /></p>}

      <section aria-label="Stage and review">
        <div className="ctf-td__row">
          {canWork && <FieldWrap label="Stage" htmlFor="td-stage"><Select id="td-stage" value={task.stage && stages.includes(task.stage) ? task.stage : stages[0]} disabled={busy} onChange={(e) => void run(() => moveTaskToStage(task.id, stages, e.target.value), 'Moved.')}>{stages.map((s) => <option key={s}>{s}</option>)}</Select></FieldWrap>}
          <div className="ctf-td__review">
            {isAssignee && (review === 'none' || review === 'changes_requested') && <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => setReviewState(task.id, 'requested'), 'Submitted for review.')}>Submit for review</Button>}
            {isAdmin && review === 'requested' && (<><Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => setReviewState(task.id, 'approved'), 'Approved.')}>Approve</Button><Button variant="secondary" size="sm" loading={busy} onClick={() => void run(() => setReviewState(task.id, 'changes_requested'), 'Changes requested.')}>Request changes</Button></>)}
          </div>
        </div>
      </section>

      <section aria-label="Checklist">
        <h4>Checklist {d.checklist.length > 0 && <small>{doneCount}/{d.checklist.length}</small>}</h4>
        {d.checklist.length === 0 && <p className="ctf-denv__muted">No checklist yet.</p>}
        <ul className="ctf-td__list">
          {d.checklist.map((c) => (
            <li key={c.id}>
              <label className="ctf-form-check"><input type="checkbox" checked={c.done} disabled={!canWork || busy} onChange={(e) => void run(() => setChecklistDone(c.id, e.target.checked))} /><span className={c.done ? 'is-done' : ''}>{c.body}</span></label>
              {canWork && <button type="button" className="ctf-hq__icon-btn" aria-label={`Remove ${c.body}`} onClick={() => void run(() => removeChecklistItem(c.id))}><Trash2 size={13} /></button>}
            </li>
          ))}
        </ul>
        {canWork && <div className="ctf-lab__row"><Input aria-label="New checklist item" value={item} maxLength={300} placeholder="Add a step" onChange={(e) => setItem(e.target.value)} autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter' && item.trim()) { e.preventDefault(); void run(() => addChecklistItem(task.id, item, d.checklist.length), undefined, () => setItem('')) } }} /><Button variant="secondary" disabled={!item.trim() || busy} onClick={() => void run(() => addChecklistItem(task.id, item, d.checklist.length), undefined, () => setItem(''))}>Add</Button></div>}
      </section>

      <section aria-label="Dependencies">
        <h4>Depends on</h4>
        {d.dependencies.length === 0 ? <p className="ctf-denv__muted">Nothing blocks this task.</p> : (
          <ul className="ctf-td__list">{d.dependencies.map((x) => <li key={x.depends_on_task_id}><span>{x.title} <Badge tone={x.done ? 'success' : 'warning'}>{x.done ? 'Done' : 'Open'}</Badge></span>{canWork && <button type="button" className="ctf-hq__icon-btn" aria-label={`Remove dependency ${x.title}`} onClick={() => void run(() => removeTaskDependency(task.id, x.depends_on_task_id))}><Trash2 size={13} /></button>}</li>)}</ul>
        )}
        {canWork && siblings.filter((s) => !taken.has(s.id) && s.project_id === task.project_id).length > 0 && (
          <div className="ctf-lab__row"><Select aria-label="Add a dependency" value={dep} onChange={(e) => setDep(e.target.value)}><option value="">Choose a task it waits for</option>{siblings.filter((s) => !taken.has(s.id) && s.project_id === task.project_id).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select><Button variant="secondary" disabled={!dep || busy} onClick={() => void run(() => addTaskDependency(task.id, dep), undefined, () => setDep(''))}>Add</Button></div>
        )}
      </section>

      <section aria-label="GitHub and links">
        <h4><Link2 size={14} aria-hidden="true" /> GitHub links</h4>
        {d.links.length === 0 && <p className="ctf-denv__muted">No pull request, issue or branch linked.</p>}
        <ul className="ctf-td__list">{d.links.map((l) => <li key={l.id}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url} <ExternalLink size={12} aria-hidden="true" /></a><Badge tone="neutral">{l.kind.replace('_', ' ')}</Badge>{canWork && <button type="button" className="ctf-hq__icon-btn" aria-label={`Remove link ${l.label}`} onClick={() => void run(() => removeTaskLink(l.id))}><Trash2 size={13} /></button>}</li>)}</ul>
        {canWork && <div className="ctf-lab__row"><Input aria-label="GitHub link" value={link} placeholder="https://github.com/owner/repo/pull/42" onChange={(e) => setLink(e.target.value)} autoComplete="off" /><Button variant="secondary" disabled={!link.trim() || busy} onClick={() => void run(() => addTaskLink(task.id, link), 'Linked.', () => setLink(''))}>Link</Button></div>}
      </section>

      <section aria-label="Attachments">
        <h4><Paperclip size={14} aria-hidden="true" /> Attachments</h4>
        {d.files.length === 0 && <p className="ctf-denv__muted">No files attached.</p>}
        <ul className="ctf-td__list">{d.files.map((f) => <li key={f.id}><button type="button" className="ctf-cal__link" onClick={async () => { const { url } = await getProjectFileUrl(f.storage_path); if (url) window.open(url, '_blank', 'noopener'); else push('Could not open that file.', 'error') }}>{f.name}</button><small>{when(f.created_at)}</small></li>)}</ul>
        {canWork && <div><input ref={fileInput} aria-label="Attach a file" type="file" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > MAX_MB * 1024 * 1024) { push(`That file is over ${MAX_MB} MB.`, 'error'); e.target.value = ''; return } void run(() => uploadProjectFile(task.project_id, f, task.id), 'File attached.', () => { if (fileInput.current) fileInput.current.value = '' }) }} /></div>}
      </section>

      <section aria-label="Comments">
        <h4>Comments</h4>
        {d.comments.length === 0 ? <p className="ctf-denv__muted">No comments yet. Mention a colleague with @Name to notify them.</p> : (
          <ul className="ctf-td__comments">{d.comments.map((c) => <li key={c.id}><strong>{c.author_name}</strong><time>{when(c.created_at)}</time><p><Linkify text={c.body} /></p></li>)}</ul>
        )}
        <Textarea aria-label="Write a comment" rows={3} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" />
        <div><Button variant="primary" size="sm" disabled={!comment.trim() || busy} onClick={() => void run(() => addTaskComment(task.id, comment), undefined, () => setComment(''))}>Comment</Button></div>
      </section>
    </div>
  )
}

