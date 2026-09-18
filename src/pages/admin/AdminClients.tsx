import { useEffect, useState, type FormEvent } from 'react'
import { Briefcase, Check, Copy } from 'lucide-react'
import { Badge, Button, EmptyState, FieldWrap, Input, Modal, SkeletonRows, Table, Textarea, useToast } from '../../components/ui'
import { createClientAccount, listClients, listMyProjects, updateClientStatus, type CreateClientResult } from '../../lib/services'
import type { Client, Project } from '../../lib/types'

const STATUS_TONE: Record<Client['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  prospect: 'neutral',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
}

export function AdminClients() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentials, setCredentials] = useState<CreateClientResult | null>(null)
  const { push } = useToast()

  const load = () => void listClients().then((r) => setClients(r.data))
  useEffect(load, [])

  const changeStatus = async (client: Client, status: Client['status']) => {
    setClients((prev) => prev?.map((c) => (c.id === client.id ? { ...c, status } : c)) ?? prev)
    const { error } = await updateClientStatus(client.id, status)
    if (error) { push('Could not update client status.', 'error'); load(); return }
    push('Status updated')
  }

  const handleCreated = (result: CreateClientResult) => {
    setCreateOpen(false)
    setCredentials(result)
    load()
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>Create client</Button>
      </div>
      {clients === null && <SkeletonRows rows={4} />}
      {clients !== null && (
        <Table
          rows={clients}
          rowKey={(c) => c.id}
          emptyState={<EmptyState icon={Briefcase} title="No clients yet" description="Create your first client to grant portal access to a project." />}
          columns={[
            { key: 'org', header: 'Organization', render: (c) => <strong>{c.organization}</strong> },
            { key: 'code', header: 'Client ID', render: (c) => c.client_code ?? '—' },
            { key: 'contact', header: 'Contact', render: (c) => c.contact_name || c.contact_email || '—' },
            { key: 'status', header: 'Status', render: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> },
            {
              key: 'actions',
              header: 'Actions',
              render: (c) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  {c.status !== 'paused' && (
                    <Button variant="ghost" size="sm" onClick={() => void changeStatus(c, 'paused')}>Pause access</Button>
                  )}
                  {c.status === 'paused' && (
                    <Button variant="ghost" size="sm" onClick={() => void changeStatus(c, 'active')}>Resume access</Button>
                  )}
                  {c.status !== 'archived' && (
                    <Button variant="ghost" size="sm" onClick={() => void changeStatus(c, 'archived')}>Archive</Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />

      <Modal open={credentials !== null} onClose={() => setCredentials(null)} title="Client account created">
        {credentials && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0 }}>
              Share these credentials with the client through a secure channel.{' '}
              <strong>This temporary password is shown only once and is not stored anywhere.</strong>
            </p>
            <CredentialRow label="Client ID" value={credentials.client_code} />
            <CredentialRow label="Email" value={credentials.email} />
            <CredentialRow label="Temporary password" value={credentials.temporary_password} />
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

function CreateClientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (result: CreateClientResult) => void
}) {
  const { push } = useToast()
  const [organization, setOrganization] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    void listMyProjects().then((r) => setProjects(r.data))
  }, [open])

  const reset = () => {
    setOrganization(''); setContactName(''); setEmail(''); setNotes(''); setSelectedProjects(new Set()); setError('')
  }

  const toggleProject = (id: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const { data, error: createError } = await createClientAccount({
      organization: organization.trim(),
      contact_name: contactName.trim(),
      email: email.trim(),
      project_ids: Array.from(selectedProjects),
    })
    setSubmitting(false)
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create the client.')
      push('Could not create the client.', 'error')
      return
    }
    push('Client account created.')
    reset()
    onCreated(data)
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Create client"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button variant="primary" form="create-client-form" type="submit" loading={submitting}>Create account</Button>
        </>
      }
    >
      <form id="create-client-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <FieldWrap label="Organization" htmlFor="cc-org" required>
          <Input id="cc-org" required value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Contact name" htmlFor="cc-name" required>
          <Input id="cc-name" required value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Email" htmlFor="cc-email" required>
          <Input id="cc-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FieldWrap>
        {projects && projects.length > 0 && (
          <FieldWrap label="Grant access to projects" htmlFor="cc-projects" hint="Optional — you can assign projects later too">
            <div style={{ display: 'grid', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {projects.map((p) => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={selectedProjects.has(p.id)} onChange={() => toggleProject(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </FieldWrap>
        )}
        <FieldWrap label="Notes" htmlFor="cc-notes" hint="Not saved yet — internal notes storage is planned for a follow-up pass">
          <Textarea id="cc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled />
        </FieldWrap>
        {error && <p className="ctf-form-error">{error}</p>}
      </form>
    </Modal>
  )
}
