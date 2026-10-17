import { useState } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SkeletonRows, Surface, Textarea, useToast } from '../../components/ui'
import {
  CASE_STATUS_LABEL, decideSuspensionCase, isOpenCase, listSuspensionCases, loadApprovals, setAssignmentStatus, setReviewState, type CaseStatus, type SuspensionCase,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import '../../workspaces/DepartmentEnvironment.css'
import './CompanyHQ.css'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const TONE: Record<CaseStatus, 'warning' | 'danger' | 'accent' | 'success' | 'neutral'> = { pending: 'warning', suspended: 'danger', under_review: 'accent', restored: 'success', offboarded: 'neutral' }

/** What is waiting on you: suspension reviews, assignments to accept or sign off, work to review, work sent back. */
export function ApprovalsPage() {
  useDocumentTitle('Approvals')
  const { profile } = useAuth()
  const isMainAdmin = profile?.role === 'superadmin'
  const items = useAsyncData(`approvals:${profile?.id}`, () => loadApprovals(profile?.id))
  const cases = useAsyncData('suspension-cases', listSuspensionCases)
  const { push } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (key: string, fn: () => Promise<{ error: Error | null }>, ok: string) => {
    setBusy(key)
    const { error } = await fn()
    setBusy(null)
    if (error) push(error.message, 'error'); else { push(ok); items.reload() }
  }

  if (items.loading || cases.loading) return <SkeletonRows rows={4} height="72px" />
  if (items.error || cases.error) return <ErrorState title="Approvals couldn't load" description={(items.errorDetail ?? cases.errorDetail)?.message ?? 'Try again.'} onRetry={() => { items.reload(); cases.reload() }} />
  const a = items.data
  const allCases = cases.data ?? []
  const open = allCases.filter((c) => isOpenCase(c.status))
  const closed = allCases.filter((c) => !isOpenCase(c.status))
  const nothing = !a || (a.assignmentsToAccept.length + a.assignmentsInReview.length + a.tasksToReview.length + a.myChanges.length === 0 && open.length === 0)

  return (
    <div className="ctf-denv__stack">
      {nothing && <EmptyState icon={CheckCircle2} title="You're all caught up" description="Nothing is waiting on a decision from you." />}

      {open.length > 0 && (
        <section aria-labelledby="ap-cases">
          <h3 id="ap-cases" className="ctf-denv__h3"><ShieldAlert size={15} aria-hidden="true" /> Suspension reviews</h3>
          <ul className="ctf-ap__list">{open.map((c) => <li key={c.id}><CaseCard c={c} canDecide={isMainAdmin} onDone={() => { cases.reload() }} /></li>)}</ul>
        </section>
      )}

      {a && a.assignmentsToAccept.length > 0 && (
        <section aria-labelledby="ap-accept">
          <h3 id="ap-accept" className="ctf-denv__h3">Assignments to accept</h3>
          <ul className="ctf-ap__list">{a.assignmentsToAccept.map((x) => (
            <li key={x.id}><Surface><div className="ctf-denv__asg-top"><div><strong>{x.project_name}</strong><span className="ctf-denv__muted"> · {x.department_name}{x.deadline ? ` · due ${x.deadline}` : ''}</span></div><Button size="sm" variant="primary" loading={busy === x.id} onClick={() => void act(x.id, () => setAssignmentStatus(x.id, 'accepted'), 'Assignment accepted.')}>Accept</Button></div>{x.objective && <p className="ctf-denv__objective">{x.objective}</p>}</Surface></li>
          ))}</ul>
        </section>
      )}

      {a && a.assignmentsInReview.length > 0 && isMainAdmin && (
        <section aria-labelledby="ap-signoff">
          <h3 id="ap-signoff" className="ctf-denv__h3">Department work to sign off</h3>
          <ul className="ctf-ap__list">{a.assignmentsInReview.map((x) => (
            <li key={x.id}><Surface><div className="ctf-denv__asg-top"><div><strong>{x.project_name}</strong><span className="ctf-denv__muted"> · {x.department_name}</span></div>
              <div className="ctf-denv__asg-actions"><Button size="sm" variant="secondary" loading={busy === x.id} onClick={() => void act(x.id, () => setAssignmentStatus(x.id, 'changes_requested'), 'Changes requested.')}>Request changes</Button><Button size="sm" variant="primary" loading={busy === x.id} onClick={() => void act(x.id, () => setAssignmentStatus(x.id, 'completed'), 'Marked completed.')}>Mark completed</Button></div></div>{x.objective && <p className="ctf-denv__objective">{x.objective}</p>}</Surface></li>
          ))}</ul>
        </section>
      )}

      {a && a.tasksToReview.length > 0 && (
        <section aria-labelledby="ap-review">
          <h3 id="ap-review" className="ctf-denv__h3">Tasks waiting for your review</h3>
          <ul className="ctf-ap__list">{a.tasksToReview.map((t) => (
            <li key={t.id}><Surface><div className="ctf-denv__asg-top"><div><strong>{t.title}</strong><span className="ctf-denv__muted"> · {t.project_name}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span></div>
              <div className="ctf-denv__asg-actions"><Button size="sm" variant="secondary" loading={busy === t.id} onClick={() => void act(t.id, () => setReviewState(t.id, 'changes_requested'), 'Changes requested.')}>Request changes</Button><Button size="sm" variant="primary" loading={busy === t.id} onClick={() => void act(t.id, () => setReviewState(t.id, 'approved'), 'Approved.')}>Approve</Button></div></div></Surface></li>
          ))}</ul>
        </section>
      )}

      {a && a.myChanges.length > 0 && (
        <section aria-labelledby="ap-mine">
          <h3 id="ap-mine" className="ctf-denv__h3">Sent back to you</h3>
          <ul className="ctf-ap__list">{a.myChanges.map((t) => <li key={t.id}><Surface><strong>{t.title}</strong><span className="ctf-denv__muted"> · {t.project_name} · changes were requested. Open the task on your department board.</span></Surface></li>)}</ul>
        </section>
      )}

      {closed.length > 0 && (
        <section aria-labelledby="ap-history">
          <h3 id="ap-history" className="ctf-denv__h3">Earlier cases</h3>
          <ul className="ctf-ap__list">{closed.map((c) => <li key={c.id}><CaseCard c={c} canDecide={false} onDone={() => undefined} /></li>)}</ul>
        </section>
      )}
    </div>
  )
}

function CaseCard({ c, canDecide, onDone }: { c: SuspensionCase; canDecide: boolean; onDone: () => void }) {
  const { push } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOffboard, setConfirmOffboard] = useState(false)
  const decide = async (status: Exclude<CaseStatus, 'pending'>, ok: string) => {
    setBusy(true)
    const { error } = await decideSuspensionCase(c.id, status, note)
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(ok); setNote(''); setConfirmOffboard(false); onDone()
  }
  const open = isOpenCase(c.status)
  return (
    <Surface>
      <div className="ctf-denv__asg-top">
        <div><strong>{c.worker_name}</strong><span className="ctf-denv__muted"> · {c.department_name || 'No department'} · requested by {c.requester_name} · {when(c.created_at)}</span></div>
        <Badge tone={TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</Badge>
      </div>
      <dl className="ctf-ap__facts"><div><dt>Reason</dt><dd>{c.reason}</dd></div>{c.evidence && <div><dt>Evidence and notes</dt><dd>{c.evidence}</dd></div>}</dl>
      <details><summary>History ({c.events.length})</summary>
        <ol className="ctf-ap__events">{c.events.map((e) => <li key={e.id}><strong>{e.action}</strong> · {e.actor_name} · {when(e.created_at)}{e.note && <span>{e.note}</span>}</li>)}</ol>
      </details>
      {canDecide && open && (
        <div className="ctf-ap__decide">
          <Textarea aria-label={`Decision note for ${c.worker_name}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)" />
          <div className="ctf-denv__asg-actions">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void decide('restored', `${c.worker_name} restored.`)}>Restore worker</Button>
            {c.status !== 'suspended' && <Button size="sm" variant="secondary" loading={busy} onClick={() => void decide('suspended', 'Suspension continued.')}>Continue suspension</Button>}
            {c.status !== 'under_review' && <Button size="sm" variant="secondary" loading={busy} onClick={() => void decide('under_review', 'Moved to review.')}>Move to review</Button>}
            {confirmOffboard
              ? <Button size="sm" variant="danger" loading={busy} onClick={() => void decide('offboarded', `${c.worker_name} offboarded.`)}>Confirm offboard</Button>
              : <Button size="sm" variant="ghost" onClick={() => setConfirmOffboard(true)}>Offboard worker</Button>}
          </div>
          <p className="ctf-denv__muted">Offboarding ends their access. Their tasks, comments, files and history stay on the record.</p>
        </div>
      )}
      {!canDecide && open && <p className="ctf-denv__muted">Waiting for a Main Admin to decide.</p>}
      {c.decision_note && !open && <p className="ctf-denv__muted">Decision note: {c.decision_note}</p>}
    </Surface>
  )
}
