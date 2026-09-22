import { useEffect, useState, type FormEvent } from 'react'
import { Button, FieldWrap, Input, Modal, Select, Textarea, useToast } from './ui'
import { createProject } from '../lib/services/projects'
import { listWorkers } from '../lib/services/workers'
import { listClients } from '../lib/services/clients'
import type { Client, Project } from '../lib/types'
import type { WorkerRow } from '../lib/services/workers'

export function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const { push } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [clientId, setClientId] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null)
  const [clients, setClients] = useState<Client[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    void listWorkers().then((r) => setWorkers(r.data))
    void listClients().then((r) => setClients(r.data))
  }, [open])

  const reset = () => {
    setName(''); setDescription(''); setDueDate(''); setClientId(''); setSelectedMembers(new Set()); setError('')
  }

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const { data, error: createError } = await createProject({
      name: name.trim(),
      description: description.trim(),
      due_date: dueDate || null,
      client_account_id: clientId || null,
      member_user_ids: Array.from(selectedMembers),
    })
    setSubmitting(false)
    if (createError || !data) {
      setError(createError?.message ?? 'Could not create the project.')
      push('Could not create the project.', 'error')
      return
    }
    push('Project created.')
    reset()
    onCreated(data)
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Create project"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button variant="primary" form="create-project-form" type="submit" loading={submitting}>Create project</Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <FieldWrap label="Project name" htmlFor="cp-name" required>
          <Input id="cp-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Description" htmlFor="cp-description">
          <Textarea id="cp-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Due date" htmlFor="cp-due">
          <Input id="cp-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FieldWrap>
        {clients && clients.length > 0 && (
          <FieldWrap label="Client" htmlFor="cp-client" hint="Optional — you can assign one later">
            <Select id="cp-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.organization}</option>
              ))}
            </Select>
          </FieldWrap>
        )}
        {workers && workers.length > 0 && (
          <FieldWrap label="Team members" htmlFor="cp-members" hint="You're added automatically">
            <div style={{ display: 'grid', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
              {workers.map((w) => (
                <label key={w.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={selectedMembers.has(w.user_id)} onChange={() => toggleMember(w.user_id)} />
                  {w.display_name}
                </label>
              ))}
            </div>
          </FieldWrap>
        )}
        {error && <p className="ctf-form-error">{error}</p>}
      </form>
    </Modal>
  )
}
