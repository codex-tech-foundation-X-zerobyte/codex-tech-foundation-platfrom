import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Copy, Check } from 'lucide-react'
import { Badge, Button, EmptyState, FieldWrap, Input, Modal, Select, Table, Textarea, useToast } from '../../components/ui'
import { createWorker, listWorkers, updateWorkerStatus, type CreateWorkerResult, type WorkerRow } from '../../lib/services'
import { useAuth } from '../../lib/auth'

export function AdminWorkers() {
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentials, setCredentials] = useState<CreateWorkerResult | null>(null)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { push } = useToast()

  const load = () => void listWorkers().then((r) => setWorkers(r.data))
  useEffect(load, [])

  const toggleStatus = async (w: WorkerRow) => {
    const next = w.status === 'active' ? 'suspended' : 'active'
    setWorkers((prev) => prev?.map((row) => (row.user_id === w.user_id ? { ...row, status: next } : row)) ?? prev)
    const { error } = await updateWorkerStatus(w.user_id, next)
    if (error) {
      push('Could not update worker status.', 'error')
      load()
      return
    }
    push(next === 'active' ? 'Worker reactivated.' : 'Worker suspended.')
  }

  const handleCreated = (result: CreateWorkerResult) => {
    setCreateOpen(false)
    setCredentials(result)
    load()
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>Create worker</Button>
      </div>
      <Table
        loading={workers === null}
        rows={workers ?? []}
        rowKey={(w) => w.user_id}
        emptyState={
          <EmptyState
            icon={Users}
            title="No workers yet"
            description="Create your first worker account to start building your team."
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

      <CreateWorkerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        canCreateManager={profile?.role === 'superadmin'}
      />

      <Modal open={credentials !== null} onClose={() => setCredentials(null)} title="Account created">
        {credentials && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0 }}>
              Share these credentials with {credentials.role === 'manager' ? 'the new manager' : 'the new worker'} through
              a secure channel. <strong>This temporary password is shown only once and is not stored anywhere.</strong>
            </p>
            <CredentialRow label="Worker ID" value={credentials.worker_id} />
            <CredentialRow label="Email" value={credentials.email} />
            <CredentialRow label="Temporary password" value={credentials.temporary_password} />
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
              The account is required to change this password on first sign-in.
            </p>
            <Button variant="primary" onClick={() => setCredentials(null)}>Done</Button>
          </div>
        )}
      </Modal>
    </>
  )
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', border: '1px solid var(--border, #2a2a2a)', borderRadius: 8 }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>{label}</div>
        <div style={{ fontFamily: 'monospace' }}>{value}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void copy()} aria-label={`Copy ${label}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  )
}

function CreateWorkerModal({
  open,
  onClose,
  onCreated,
  canCreateManager,
}: {
  open: boolean
  onClose: () => void
  onCreated: (result: CreateWorkerResult) => void
  canCreateManager: boolean
}) {
  const { push } = useToast()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState('')
  const [bio, setBio] = useState('')
  const [role, setRole] = useState<'worker' | 'manager'>('worker')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setDisplayName(''); setEmail(''); setPhone(''); setPosition(''); setBio(''); setRole('worker'); setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const { data, error: createError } = await createWorker({
      display_name: displayName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      position: position.trim() || undefined,
      bio: bio.trim() || undefined,
      role,
    })
    setSubmitting(false)
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create the account.')
      push('Could not create the account.', 'error')
      return
    }
    push(role === 'manager' ? 'Manager account created.' : 'Worker account created.')
    reset()
    onCreated(data)
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Create worker"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button variant="primary" form="create-worker-form" type="submit" loading={submitting}>Create account</Button>
        </>
      }
    >
      <form id="create-worker-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <FieldWrap label="Full name" htmlFor="cw-name" required>
          <Input id="cw-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Email" htmlFor="cw-email" required>
          <Input id="cw-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Phone" htmlFor="cw-phone">
          <Input id="cw-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Position" htmlFor="cw-position">
          <Input id="cw-position" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Frontend Engineer" />
        </FieldWrap>
        <FieldWrap label="Bio" htmlFor="cw-bio">
          <Textarea id="cw-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        </FieldWrap>
        {canCreateManager && (
          <FieldWrap label="Role" htmlFor="cw-role" hint="Manager grants operational admin access. Only Super Admin can create managers.">
            <Select id="cw-role" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'manager')}>
              <option value="worker">Worker</option>
              <option value="manager">Manager</option>
            </Select>
          </FieldWrap>
        )}
        {error && <p className="ctf-form-error">{error}</p>}
      </form>
    </Modal>
  )
}
