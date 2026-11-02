import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Users } from 'lucide-react'
import {
  Avatar, Badge, Button, EmptyState, FieldWrap, Input, Modal, SearchInput, Select, Table, useToast,
} from '../../components/ui'
import { CredentialsPanel } from '../../components/CredentialsPanel'
import { DeleteButton } from '../../components/DeleteButton'
import { createWorker, deleteAccount, listDepartmentSummaries, listMembershipsByWorker, listWorkers, updateWorkerStatus, type WorkerRow } from '../../lib/services'
import { departmentBySlug } from '../../workspaces/definitions'
import { workerStatusInfo } from '../../lib/workerStatus'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminWorkers.css'

export function AdminWorkers() {
  const { data: workers, loading, reload } = useAsyncData('once', listWorkers)
  const depts = useAsyncData('departments', listDepartmentSummaries)
  const deptName = new Map((depts.data?.departments ?? []).map((d) => [d.id, d.name]))
  const memberships = useAsyncData('worker-memberships', listMembershipsByWorker)
  const placed = (id: string) => memberships.data?.get(id) ?? []
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (workers ?? []).filter((w) =>
      (deptFilter === 'all' || (deptFilter === 'none' ? (memberships.data?.get(w.user_id) ?? []).length === 0 : (memberships.data?.get(w.user_id) ?? []).some((m) => m.department_id === deptFilter)))
      && (statusFilter === 'all' || w.status === statusFilter)
      && (!q || [w.display_name, w.worker_id, w.position].some((v) => (v ?? '').toLowerCase().includes(q))))
  }, [workers, query, deptFilter, statusFilter, memberships.data])
  const filtering = query.trim() !== '' || deptFilter !== 'all' || statusFilter !== 'all'

  const { push } = useToast()
  const toggleStatus = async (w: WorkerRow) => {
    const info = workerStatusInfo(w.status)
    if (!info.action) return
    const next = info.action === 'suspend' ? 'suspended' : 'active'
    const { error } = await updateWorkerStatus(w.user_id, next)
    // Previously the result was thrown away, so a failed suspend looked like nothing had happened.
    if (error) push(error.message, 'error')
    else push(next === 'suspended' ? `${w.display_name} suspended.` : `${w.display_name} reactivated.`)
    reload()
  }

  return (
    <div>
      <div className="ctf-admin-workers__head">
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>Create worker</Button>
      </div>

      {(workers?.length ?? 0) > 0 && (
        <div className="ctf-admin-workers__filters">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, ID or position" aria-label="Search workers" />
          <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {(depts.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">No department</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">Any status</option>
            {['active', 'invited', 'suspended', 'offboarded'].map((s) => <option key={s} value={s}>{workerStatusInfo(s).label}</option>)}
          </Select>
          <span className="ctf-admin-workers__count" aria-live="polite">{filtering ? `${visible.length} of ${workers?.length}` : `${workers?.length} worker${workers?.length === 1 ? '' : 's'}`}</span>
        </div>
      )}

      <Table
        loading={loading}
        rows={visible}
        onRowClick={(w) => navigate(`/admin/workers/${w.user_id}`)}
        rowKey={(w) => w.user_id}
        emptyState={filtering ? <EmptyState icon={Users} title="No workers match" description="Try a different search, or clear the filters." /> : (
          <EmptyState
            icon={Users}
            title="No workers yet"
            description="Create your first worker account to start building your team."
            action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create worker</Button>}
          />
        )}
        columns={[
          { key: 'worker', header: 'Worker', render: (w) => (
            <div className="ctf-admin-workers__who"><Avatar name={w.display_name} size={32} /><div><strong>{w.display_name}</strong><small>{w.position || 'No position set'}</small></div></div>
          ) },
          { key: 'id', header: 'Worker ID', render: (w) => w.worker_id },
                    { key: 'department', header: 'Departments', render: (w) => {
            const list = [...placed(w.user_id)].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
            if (list.length === 0) return '—'
            return (
              <div className="ctf-admin-workers__depts">
                {list.map((m) => <span key={m.department_id} className={`ctf-admin-workers__dept ${m.department_role === 'admin' ? 'is-admin' : ''}`} title={m.department_role === 'admin' ? 'Department Admin' : undefined}>{deptName.get(m.department_id) ?? '—'}</span>)}
              </div>
            )
          } },
          { key: 'status', header: 'Status', render: (w) => { const i = workerStatusInfo(w.status); return <Badge tone={i.tone}>{i.label}</Badge> } },
          {
            key: 'actions',
            header: 'Actions',
            render: (w) => (
              <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/workers/${w.user_id}`)}>View</Button>
                {workerStatusInfo(w.status).action
                  ? <Button variant="ghost" size="sm" onClick={() => void toggleStatus(w)}>{workerStatusInfo(w.status).action === 'suspend' ? 'Suspend' : 'Reactivate'}</Button>
                  : workerStatusInfo(w.status).managedByCase && <Button variant="ghost" size="sm" onClick={() => navigate('/admin/approvals')}>Open case</Button>}
                <DeleteButton what="worker" name={w.display_name} label="" typeToConfirm={w.worker_id} onDelete={() => deleteAccount(w.user_id)} onDeleted={reload}>
                  <p>Their account is permanently removed and they can no longer sign in. Their chat messages are deleted; shared work they created stays and is handed to you.</p>
                  <p>To pause access without losing anything, suspend them instead.</p>
                </DeleteButton>
              </div>
            ),
          },
        ]}
      />

      <CreateWorkerModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
    </div>
  )
}

function CreateWorkerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [result, setResult] = useState<{ worker_id: string; temp_password: string } | null>(null)
  const close = () => { onClose(); setResult(null) }
  return (
    <Modal open={open} onClose={close} dismissible={!result} title={result ? 'Worker account created' : 'Create worker'}>
      {result ? (
        <CredentialsPanel idLabel="Worker ID" id={result.worker_id} password={result.temp_password} onDone={close} />
      ) : (
        <CreateWorkerForm onCancel={close} onCreated={(r) => { setResult(r); onCreated() }} />
      )}
    </Modal>
  )
}

function CreateWorkerForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: { worker_id: string; temp_password: string }) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<'worker' | 'manager'>('worker')
  const [departmentId, setDepartmentId] = useState('')
  const [isDepartmentAdmin, setIsDepartmentAdmin] = useState(false)
  const departments = useAsyncData('create-worker-departments', listDepartmentSummaries)
  // Only the Codex departments (they have environments); hand-made legacy ones are not assignable.
  const assignable = (departments.data?.departments ?? []).filter((d) => d.slug)
  const chosen = assignable.find((d) => d.id === departmentId)
  const suggestedRoles = departmentBySlug(chosen?.slug)?.roles ?? []
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    const { data, error: err } = await createWorker({ name: name.trim(), email: email.trim(), position: position.trim(), role, department_id: departmentId, department_role: isDepartmentAdmin ? 'admin' : 'member' })
    setSubmitting(false)
    if (err || !data) { setError(err?.message ?? 'Could not create this worker.'); return }
    onCreated({ worker_id: data.worker_id, temp_password: data.temp_password })
  }

  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Full name" htmlFor="cw-name" required>
        <Input id="cw-name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label="Email" htmlFor="cw-email" required>
        <Input id="cw-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label="Primary department" htmlFor="cw-department" required hint={chosen ? `They will get the ${chosen.name} workspace automatically. You can add more departments from their profile.` : 'Their workspace, tools and boards follow from this. You can add more departments afterwards.'}>
        <Select id="cw-department" required value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setIsDepartmentAdmin(false) }}>
          <option value="" disabled>Select a department</option>
          {assignable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </FieldWrap>
      <div className="ctf-form-row">
        <FieldWrap label="Position" htmlFor="cw-position">
          <Input id="cw-position" list="cw-position-options" value={position} onChange={(e) => setPosition(e.target.value)} placeholder={suggestedRoles[0] ? `e.g. ${suggestedRoles[0]}` : 'e.g. Product Engineer'} autoComplete="off" />
          <datalist id="cw-position-options">{suggestedRoles.map((r) => <option key={r} value={r} />)}</datalist>
        </FieldWrap>
        <FieldWrap label="Account type" htmlFor="cw-role" hint="Managers have broader operational access.">
          <Select id="cw-role" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'manager')}>
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </Select>
        </FieldWrap>
      </div>
      <label className="ctf-form-check">
        <input type="checkbox" checked={isDepartmentAdmin} disabled={!departmentId} onChange={(e) => setIsDepartmentAdmin(e.target.checked)} />
        <span>Make them the Department Admin{chosen ? ` of ${chosen.name}` : ''}</span>
      </label>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting} disabled={!name.trim() || !email.trim() || !departmentId}>Create worker</Button>
      </div>
    </form>
  )
}
