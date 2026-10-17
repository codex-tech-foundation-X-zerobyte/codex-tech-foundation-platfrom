import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, FolderKanban, ListChecks, MessageSquare, Pencil } from 'lucide-react'
import { Avatar, Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, ReadMore, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { DeleteButton } from '../../components/DeleteButton'
import { ResetPasswordButton } from '../../components/ResetPasswordButton'
import {
  deleteAccount, getAccountDetails, getOrCreateDm, getWorkerById, getWorkerOverview, listDepartmentSummaries, updateWorkerDetails, updateWorkerStatus,
  type WorkerOverview, type WorkerRow,
} from '../../lib/services'
import { humanizeAction, tenure, timeAgo } from '../../lib/format'
import { workerStatusInfo } from '../../lib/workerStatus'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminWorkerProfile.css'

const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' }
const TASK_STATUS_LABEL: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }

export function AdminWorkerProfile() {
  const { id } = useParams()
  const { profile } = useAuth()
  const canManage = profile?.role === 'superadmin'
  const { data: worker, error, loading, reload } = useAsyncData(id ?? '', () => getWorkerById(id ?? ''))
  const overview = useAsyncData(`overview:${id}`, () => getWorkerOverview(id ?? ''))
  const account = useAsyncData(`account:${id}`, () => (canManage ? getAccountDetails(id ?? '') : Promise.resolve({ data: null, error: null })))
  const depts = useAsyncData('departments', listDepartmentSummaries)
  const navigate = useNavigate()
  const { push } = useToast()
  const [editOpen, setEditOpen] = useState(false)

  if (error) return <ErrorState onRetry={reload} />
  if (loading) return <SkeletonRows rows={4} height="50px" />
  if (!worker) return <ErrorState title="Worker not found" />

  const info = workerStatusInfo(worker.status)
  const dept = (depts.data?.departments ?? []).find((d) => d.id === worker.department_id)
  const o = overview.data
  const acct = account.data
  const length = tenure(worker.join_date)

  const toggleStatus = async () => {
    if (!info.action) return
    const next = info.action === 'suspend' ? 'suspended' : 'active'
    const { error: err } = await updateWorkerStatus(worker.user_id, next)
    push(err ? err.message : next === 'suspended' ? `${worker.display_name} suspended.` : `${worker.display_name} reactivated.`, err ? 'error' : 'success')
    reload()
  }

  const message = async () => {
    const { data: channelId, error: err } = await getOrCreateDm(worker.user_id)
    if (err || !channelId) { push(err?.message ?? "Couldn't open a chat with them.", 'error'); return }
    navigate(`/admin/chat?channel=${encodeURIComponent(channelId)}`)
  }

  return (
    <div className="ctf-wp">
      <Link to="/admin/workers" className="ctf-wp__back"><ArrowLeft size={15} /> All workers</Link>

      <header className="ctf-wp__head">
        <Avatar name={worker.display_name} size={64} />
        <div className="ctf-wp__title">
          <h1>{worker.display_name}</h1>
          <p>{worker.position || 'No position set'}</p>
          <div className="ctf-wp__badges">
            <Badge tone={info.tone}>{info.label}</Badge>
            {o?.role === 'manager' && <Badge tone="neutral">Manager</Badge>}
            {worker.department_role === 'admin' && <Badge tone="success">Department Admin</Badge>}
            <code className="ctf-wp__id" title="Worker ID">{worker.worker_id}</code>
          </div>
        </div>
        <div className="ctf-wp__actions">
          <Button variant="secondary" icon={<MessageSquare size={14} />} onClick={() => void message()}>Message</Button>
          {canManage && <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditOpen(true)}>Edit</Button>}
        </div>
      </header>

      <section className="ctf-wp__stats" aria-label="Workload">
        <Figure icon={ListChecks} label="Open tasks" value={o ? o.taskCounts.total - o.taskCounts.done : null} />
        <Figure icon={CheckCircle2} label="Completed" value={o ? o.taskCounts.done : null} />
        <Figure icon={AlertTriangle} label="Overdue" value={o ? o.taskCounts.overdue : null} tone={o && o.taskCounts.overdue > 0 ? 'warning' : undefined} />
        <Figure icon={FolderKanban} label="Projects" value={o ? o.projects.length : null} />
      </section>

      <div className="ctf-wp__cols">
        <div className="ctf-wp__col">
          <Card title="Details">
            <dl className="ctf-wp__dl">
              <Row label="Email" value={account.loading ? 'Loading…' : acct?.email ?? (canManage ? 'Not available' : 'Main Admin only')} mono />
              <Row label="Phone" value={worker.phone || '—'} />
              <Row label="Department" value={dept ? `${dept.name}${worker.department_role === 'admin' ? ' · Department Admin' : ''}` : 'Not assigned'} />
              <Row label="Joined" value={worker.join_date ? `${worker.join_date}${length ? ` · ${length}` : ''}` : '—'} />
              {canManage && <Row label="Last sign-in" value={account.loading ? 'Loading…' : acct ? timeAgo(acct.last_sign_in_at) : '—'} />}
              {canManage && acct && <Row label="Account created" value={new Date(acct.created_at).toLocaleDateString()} />}
              {worker.status === 'invited' && <Row label="Invitation" value="Hasn't signed in yet" />}
            </dl>
          </Card>

          <Card title="About">
            {worker.bio ? <ReadMore text={worker.bio} lines={4} /> : <p className="ctf-wp__muted">No bio yet.</p>}
            <div className="ctf-wp__skills" aria-label="Skills">
              {worker.skills.length ? worker.skills.map((s) => <span key={s} className="ctf-wp__chip">{s}</span>) : <span className="ctf-wp__muted">No skills listed.</span>}
            </div>
          </Card>

          <Card title="Recent activity">
            <ActivityList overview={o} loading={overview.loading} />
          </Card>
        </div>

        <div className="ctf-wp__col">
          <Card title="Current work">
            <TaskList overview={o} loading={overview.loading} />
          </Card>

          <Card title="Projects">
            {overview.loading ? <SkeletonRows rows={2} height="36px" /> : o && o.projects.length ? (
              <ul className="ctf-wp__list">
                {o.projects.map((p) => (
                  <li key={p.id}><Link to={`/admin/projects/${p.id}`}>{p.name}</Link><Badge tone="neutral">{p.status.replace('_', ' ')}</Badge></li>
                ))}
              </ul>
            ) : <p className="ctf-wp__muted">Not on any project yet.</p>}
          </Card>
        </div>
      </div>

      {canManage && (
        <section className="ctf-wp__danger" aria-label="Account actions">
          <div>
            <h2>Account</h2>
            <p>
              {info.action ? 'Suspend to pause access without losing anything. ' : ''}
              Reset the password if they are locked out. Delete removes the account for good.
            </p>
          </div>
          <div className="ctf-wp__danger-actions">
            <ResetPasswordButton userId={worker.user_id} name={worker.display_name} idLabel="Worker ID" id={worker.worker_id} size="md" />
            {info.action ? (
              <Button variant={info.action === 'suspend' ? 'secondary' : 'primary'} onClick={() => void toggleStatus()}>{info.action === 'suspend' ? 'Suspend' : 'Reactivate'}</Button>
            ) : info.managedByCase ? (
              <Button variant="secondary" onClick={() => navigate('/admin/approvals')}>Open suspension case</Button>
            ) : null}
            <DeleteButton what="worker" name={worker.display_name} label="Delete worker" size="md" typeToConfirm={worker.worker_id} onDelete={() => deleteAccount(worker.user_id)} onDeleted={() => navigate('/admin/workers')}>
              <p>Their account is permanently removed and they can no longer sign in. This cannot be undone.</p>
              <ul>
                <li>Their chat messages and call history are deleted.</li>
                <li>Shared work they created (meetings, records, tasks) stays and is handed to you.</li>
                <li>Tasks assigned to them become unassigned.</li>
              </ul>
              <p>If you only need them gone for now, suspend them instead — nothing is lost.</p>
            </DeleteButton>
          </div>
        </section>
      )}

      {editOpen && <EditWorkerModal worker={worker} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload() }} />}
    </div>
  )
}

function Figure({ icon: Icon, label, value, tone }: { icon: typeof ListChecks; label: string; value: number | null; tone?: 'warning' }) {
  return (
    <div className={`ctf-wp__figure ${tone ? `is-${tone}` : ''}`}>
      <Icon size={16} aria-hidden />
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ctf-wp__card"><h2>{title}</h2>{children}</section>
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? 'is-mono' : undefined}>{value}</dd></div>
}

function TaskList({ overview, loading }: { overview: WorkerOverview | null; loading: boolean }) {
  if (loading) return <SkeletonRows rows={3} height="44px" />
  if (!overview || overview.openTasks.length === 0) return <EmptyState icon={ListChecks} title="Nothing assigned" description="Open tasks assigned to them will show up here." />
  const today = new Date().toISOString().slice(0, 10)
  return (
    <ul className="ctf-wp__tasks">
      {overview.openTasks.map((t) => {
        const late = t.due_date !== null && t.due_date < today
        return (
          <li key={t.id}>
            <div>
              <strong>{t.title}</strong>
              <span>{t.project_name} · {TASK_STATUS_LABEL[t.status] ?? t.status}</span>
            </div>
            <div className="ctf-wp__task-meta">
              {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority] ?? 'neutral'}>{t.priority}</Badge>}
              {t.due_date && <span className={late ? 'is-late' : undefined}><CalendarClock size={12} aria-hidden /> {late ? 'Overdue · ' : ''}{t.due_date}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ActivityList({ overview, loading }: { overview: WorkerOverview | null; loading: boolean }) {
  if (loading) return <SkeletonRows rows={3} height="28px" />
  if (!overview || overview.activity.length === 0) return <p className="ctf-wp__muted">No recorded activity yet.</p>
  return (
    <ul className="ctf-wp__activity">
      {overview.activity.map((a) => (
        <li key={a.id}><span>{humanizeAction(a.action)}</span><time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</time></li>
      ))}
    </ul>
  )
}

function EditWorkerModal({ worker, onClose, onSaved }: { worker: WorkerRow; onClose: () => void; onSaved: () => void }) {
  const [position, setPosition] = useState(worker.position)
  const [phone, setPhone] = useState(worker.phone ?? '')
  const [bio, setBio] = useState(worker.bio)
  const [skills, setSkills] = useState(worker.skills.join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { push } = useToast()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await updateWorkerDetails(worker.user_id, { position, phone, bio, skills: skills.split(',') })
    setSaving(false)
    if (err) { setError(err.message); return }
    push('Worker details saved.')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${worker.display_name}`} size="md">
      <form className="ctf-form" onSubmit={(e) => void submit(e)}>
        <FieldWrap label="Position" htmlFor="ew-position"><Input id="ew-position" value={position} maxLength={120} onChange={(e) => setPosition(e.target.value)} /></FieldWrap>
        <FieldWrap label="Phone" htmlFor="ew-phone"><Input id="ew-phone" type="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} /></FieldWrap>
        <FieldWrap label="Skills" htmlFor="ew-skills" hint="Separate with commas."><Input id="ew-skills" value={skills} onChange={(e) => setSkills(e.target.value)} /></FieldWrap>
        <FieldWrap label="Bio" htmlFor="ew-bio" hint={`${bio.length}/2000`}><Textarea id="ew-bio" rows={5} value={bio} maxLength={2000} onChange={(e) => setBio(e.target.value)} /></FieldWrap>
        {error && <p className="ctf-form-error" role="alert">{error}</p>}
        <div className="ctf-form__actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  )
}
