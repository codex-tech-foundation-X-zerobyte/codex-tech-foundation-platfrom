import { useState, type FormEvent } from 'react'
import { Badge, Button, ErrorState, FieldWrap, Select, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { addIncidentNote, assignIncident, getIncident, listAssignable, markDuplicate, setIncidentSeverity, setIncidentStatus, setRootCause, type IncidentRow } from '../../lib/services'
import { MIN_ROOT_CAUSE, NOTE_KIND_LABEL, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, ackLabel, nextSteps, type IncidentStatus, type Severity } from '../../lib/monitorRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { timeAgo } from '../../lib/format'

/** One incident: who has it, where it stands, what to do next, and everything that happened to it. */
export function IncidentPanel({ id, siblings, onChanged }: { id: string; siblings: IncidentRow[]; onChanged: () => void }) {
  const detail = useAsyncData(`monitor-incident:${id}`, () => getIncident(id))
  const d = detail.data
  const projectId = d?.incident.project_id ?? ''
  const people = useAsyncData(`monitor-assignable:${projectId}`, async () => (projectId ? listAssignable(projectId) : { data: [], error: null }))
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [cause, setCause] = useState('')
  const [note, setNote] = useState('')
  const [dupOf, setDupOf] = useState('')

  if (detail.loading) return <SkeletonRows rows={4} />
  if (detail.error || !d) return <ErrorState title="This incident couldn't load" description={detail.errorDetail?.message ?? 'It may have been removed, or you may not have access.'} onRetry={detail.reload} />
  const i = d.incident
  const live = i.status !== 'resolved'
  const clock = ackLabel(i)
  const others = siblings.filter((s) => s.project_id === i.project_id && s.id !== i.id && s.status !== 'resolved' && !s.duplicate_of_ref)

  const run = async (action: () => Promise<{ error: Error | null }>, done?: () => void) => {
    setBusy(true)
    const r = await action()
    setBusy(false)
    if (r.error) { push(r.error.message, 'error'); return false }
    done?.(); detail.reload(); onChanged(); return true
  }
  const move = (to: IncidentStatus) => {
    if (to === 'resolved') { setResolving(true); setCause(i.root_cause ?? ''); return }
    void run(() => setIncidentStatus(i.id, to))
  }
  const resolve = (e: FormEvent) => { e.preventDefault(); void run(() => setIncidentStatus(i.id, 'resolved', cause), () => { setResolving(false); setCause('') }) }
  const addNote = (e: FormEvent) => { e.preventDefault(); if (note.trim()) void run(() => addIncidentNote(i.id, note.trim()), () => setNote('')) }

  return (
    <div className="ctf-inc">
      <div className="ctf-inc__badges">
        <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
        <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
        <Badge>{SOURCE_LABEL[i.source] ?? i.source}</Badge>
        {i.reopen_count > 0 && <Badge tone="warning">Reopened {i.reopen_count}×</Badge>}
        {clock && <Badge tone={clock.tone}>{clock.text}</Badge>}
      </div>
      <dl className="ctf-inc__facts">
        <div><dt>Project</dt><dd>{i.project_name}</dd></div>
        <div><dt>Opened</dt><dd>{timeAgo(i.opened_at)}</dd></div>
        <div><dt>Assigned to</dt><dd>{i.assignee_name ?? 'Nobody yet'}</dd></div>
        <div><dt>{i.resolved_at ? 'Resolved' : 'Acknowledged'}</dt><dd>{i.resolved_at ? timeAgo(i.resolved_at) : i.acknowledged_at ? timeAgo(i.acknowledged_at) : 'Not yet'}</dd></div>
      </dl>
      {i.duplicate_of_ref && <p className="ctf-inc__note">Closed as a duplicate of <strong>{i.duplicate_of_ref}</strong>.</p>}
      {d.duplicates.length > 0 && <p className="ctf-inc__note">Duplicates closed into this one: {d.duplicates.join(', ')}.</p>}
      {i.root_cause && <div className="ctf-inc__cause"><strong>Root cause</strong><p>{i.root_cause}</p></div>}

      <div className="ctf-inc__actions" role="group" aria-label="Move this incident forward">
        {nextSteps(i.status).map((s) => <Button key={s} size="sm" variant={s === 'resolved' ? 'primary' : 'secondary'} disabled={busy} onClick={() => move(s)}>{s === 'reopened' ? 'Reopen' : s === 'acknowledged' ? 'Acknowledge' : s === 'resolved' ? 'Resolve…' : `Mark ${STATUS_LABEL[s].toLowerCase()}`}</Button>)}
      </div>
      {resolving && (
        <form className="ctf-inc__form" onSubmit={resolve}>
          <FieldWrap label="What caused it?" htmlFor="inc-cause" required hint={`At least ${MIN_ROOT_CAUSE} characters. This is what the next person will search for.`}>
            <Textarea id="inc-cause" rows={3} value={cause} onChange={(e) => setCause(e.target.value)} maxLength={4000} autoFocus />
          </FieldWrap>
          <div className="ctf-inc__row"><Button type="submit" variant="primary" disabled={busy || cause.trim().length < MIN_ROOT_CAUSE}>Resolve incident</Button><Button type="button" variant="ghost" onClick={() => setResolving(false)}>Cancel</Button></div>
        </form>
      )}

      {live && (
        <div className="ctf-inc__controls">
          <FieldWrap label="Assign to" htmlFor="inc-assign">
            <Select id="inc-assign" value={i.assignee_id ?? ''} disabled={busy} onChange={(e) => void run(() => assignIncident(i.id, e.target.value || null))}>
              <option value="">Nobody</option>
              {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FieldWrap>
          <FieldWrap label="Severity" htmlFor="inc-sev">
            <Select id="inc-sev" value={i.severity} disabled={busy} onChange={(e) => void run(() => setIncidentSeverity(i.id, e.target.value as Severity))}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </Select>
          </FieldWrap>
          {others.length > 0 && (
            <FieldWrap label="Close as a duplicate of" htmlFor="inc-dup">
              <div className="ctf-inc__row">
                <Select id="inc-dup" value={dupOf} onChange={(e) => setDupOf(e.target.value)}><option value="">Choose the original…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.title.slice(0, 50)}</option>)}</Select>
                <Button size="sm" variant="secondary" disabled={busy || !dupOf} onClick={() => void run(() => markDuplicate(i.id, dupOf), () => setDupOf(''))}>Link</Button>
              </div>
            </FieldWrap>
          )}
        </div>
      )}

      <form className="ctf-inc__form" onSubmit={addNote}>
        <FieldWrap label="Add a note" htmlFor="inc-note" hint="Notes cannot be edited or deleted. Do not paste secrets or customer details.">
          <Textarea id="inc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
        </FieldWrap>
        <div className="ctf-inc__row"><Button type="submit" size="sm" variant="secondary" disabled={busy || !note.trim()}>Add note</Button>{live && !i.root_cause && <Button type="button" size="sm" variant="ghost" disabled={busy || note.trim().length < MIN_ROOT_CAUSE} onClick={() => void run(() => setRootCause(i.id, note.trim()), () => setNote(''))}>Save as root cause</Button>}</div>
      </form>

      <h3 className="ctf-inc__h">History</h3>
      <ol className="ctf-inc__timeline">
        {d.notes.map((n) => (
          <li key={n.id} className={`ctf-inc__event ctf-inc__event--${n.kind}`}>
            <div className="ctf-inc__meta"><Badge tone={n.kind === 'escalation' ? 'danger' : n.kind === 'system' ? 'neutral' : 'accent'}>{NOTE_KIND_LABEL[n.kind] ?? n.kind}</Badge><span>{n.author_name ?? 'Automatic'}</span><span>{timeAgo(n.created_at)}</span></div>
            <p>{n.body}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
