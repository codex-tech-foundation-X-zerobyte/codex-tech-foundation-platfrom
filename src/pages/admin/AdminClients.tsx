import { useState, type FormEvent } from 'react'
import { Briefcase, Plus } from 'lucide-react'
import {
  Button, EmptyState, FieldWrap, Input, Modal, StatusBadge, Table,
} from '../../components/ui'
import { CredentialsPanel } from '../../components/CredentialsPanel'
import { createClient, listClients } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import '../admin/AdminWorkers.css'

export function AdminClients() {
  const { data: clients, loading, reload } = useAsyncData('once', listClients)
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div>
      <div className="ctf-admin-workers__head">
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>Create client</Button>
      </div>

      <Table
        loading={loading}
        rows={clients ?? []}
        rowKey={(c) => c.id}
        emptyState={
          <EmptyState
            icon={Briefcase}
            title="No clients yet"
            description="Create a client account to give them access to their project."
            action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create client</Button>}
          />
        }
        columns={[
          { key: 'org', header: 'Company', render: (c) => <strong>{c.organization}</strong> },
          { key: 'contact', header: 'Contact', render: (c) => c.contact_name ?? '—' },
          { key: 'email', header: 'Email', render: (c) => c.contact_email ?? '—' },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
        ]}
      />

      <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
    </div>
  )
}

function CreateClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [result, setResult] = useState<{ client_id: string; temp_password: string } | null>(null)
  const close = () => { onClose(); setResult(null) }
  return (
    <Modal open={open} onClose={close} dismissible={!result} title={result ? 'Client account created' : 'Create client'}>
      {result ? (
        <CredentialsPanel idLabel="Client ID" id={result.client_id} password={result.temp_password} onDone={close} />
      ) : (
        <CreateClientForm onCancel={close} onCreated={(r) => { setResult(r); onCreated() }} />
      )}
    </Modal>
  )
}

function CreateClientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: { client_id: string; temp_password: string }) => void }) {
  const [organization, setOrganization] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    const { data, error: err } = await createClient({ organization: organization.trim(), contact_name: contactName.trim(), email: email.trim() })
    setSubmitting(false)
    if (err || !data) { setError(err?.message ?? 'Could not create this client.'); return }
    onCreated({ client_id: data.client_id, temp_password: data.temp_password })
  }

  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Company / organization" htmlFor="cc-org" required>
        <Input id="cc-org" required value={organization} onChange={(e) => setOrganization(e.target.value)} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label="Contact name" htmlFor="cc-contact" required>
        <Input id="cc-contact" required value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label="Email" htmlFor="cc-email" required hint="Used for account recovery — the client signs in with their Client ID.">
        <Input id="cc-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </FieldWrap>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting} disabled={!organization.trim() || !contactName.trim() || !email.trim()}>Create client</Button>
      </div>
    </form>
  )
}
