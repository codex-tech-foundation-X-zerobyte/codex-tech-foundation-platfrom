import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Users } from 'lucide-react'
import {
  Badge, Button, EmptyState, FieldWrap, Input, Modal, Select, Table,
} from '../../components/ui'
import { CredentialsPanel } from '../../components/CredentialsPanel'
import { createWorker, listWorkers, updateWorkerStatus, type WorkerRow } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminWorkers.css'

export function AdminWorkers() {
  const { data: workers, loading, reload } = useAsyncData('once', listWorkers)
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)

  const toggleStatus = async (w: WorkerRow) => {
    const next = w.status === 'active' ? 'suspended' : 'active'
    await updateWorkerStatus(w.user_id, next)
    reload()
  }

  return (
    <div>
      <div className="ctf-admin-workers__head">
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>Create worker</Button>
      </div>

      <Table
        loading={loading}
        rows={workers ?? []}
        rowKey={(w) => w.user_id}
        emptyState={
          <EmptyState
            icon={Users}
            title="No workers yet"
            description="Create your first worker account to start building your team."
            action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create worker</Button>}
          />
        }
        columns={[
          { key: 'worker', header: 'Worker', render: (w) => <strong>{w.display_name}</strong> },
          { key: 'id', header: 'Worker ID', render: (w) => w.worker_id },
          { key: 'position', header: 'Position', render: (w) => w.position || '—' },
          { key: 'status', header: 'Status', render: (w) => <Badge tone={w.status === 'active' ? 'success' : 'danger'}>{w.status}</Badge> },
          {
            key: 'actions',
            header: 'Actions',
            render: (w) => (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/workers/${w.user_id}`)}>View</Button>
                <Button variant="ghost" size="sm" onClick={() => void toggleStatus(w)}>
                  {w.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    const { data, error: err } = await createWorker({ name: name.trim(), email: email.trim(), position: position.trim(), role })
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
      <div className="ctf-form-row">
        <FieldWrap label="Position" htmlFor="cw-position">
          <Input id="cw-position" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Product Engineer" autoComplete="off" />
        </FieldWrap>
        <FieldWrap label="Account type" htmlFor="cw-role" hint="Managers have broader operational access.">
          <Select id="cw-role" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'manager')}>
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </Select>
        </FieldWrap>
      </div>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting} disabled={!name.trim() || !email.trim()}>Create worker</Button>
      </div>
    </form>
  )
}
