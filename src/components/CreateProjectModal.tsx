import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button, FieldWrap, Input, Modal, Select, Textarea, useToast } from '../components/ui'
import { createProject, listClients } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import type { ProjectScope, ProjectStatus } from '../lib/types'

const STATUSES: ProjectStatus[] = ['planning', 'in_development', 'active', 'maintenance', 'paused', 'completed', 'archived']

/**
 * `scope="personal"` is a worker's own project: private to them, people they invite and Main Admins; no client, never published.
 * (The database also stops workers creating company projects, so this is not just a UI choice.)
 */
export function CreateProjectButton({ onCreated, scope = 'company' }: { onCreated: () => void; scope?: ProjectScope }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>{scope === 'personal' ? 'New personal project' : 'Create project'}</Button>
      <CreateProjectModal open={open} onClose={() => setOpen(false)} onCreated={onCreated} scope={scope} />
    </>
  )
}

function CreateProjectModal({ open, onClose, onCreated, scope }: { open: boolean; onClose: () => void; onCreated: () => void; scope: ProjectScope }) {
  return (
    <Modal open={open} onClose={onClose} title={scope === 'personal' ? 'New personal project' : 'Create project'}
      description={scope === 'personal' ? 'Your own space on the Workspace. Only you, people you invite and Main Admins can see it.' : 'Give it a name now; everything else can be changed later.'}>
      {/* The form is its own component so its state resets each time the dialog opens. */}
      <CreateProjectForm onClose={onClose} onCreated={onCreated} scope={scope} />
    </Modal>
  )
}

function CreateProjectForm({ onClose, onCreated, scope }: { onClose: () => void; onCreated: () => void; scope: ProjectScope }) {
  const { push } = useToast()
  const personal = scope === 'personal'
  const { data: clients } = useAsyncData(personal ? 'clients-skipped' : 'clients', () => (personal ? Promise.resolve({ data: [], error: null }) : listClients()))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('planning')
  const [clientAccountId, setClientAccountId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError('')
    const { data, error: err, memberWarning } = await createProject({
      name: name.trim(),
      description: description.trim(),
      status,
      client_account_id: personal ? null : clientAccountId || null,
      due_date: dueDate || null,
      scope,
    })
    setSubmitting(false)
    if (err || !data) {
      // Real failure, shown to the user — never claim success without a confirmed row back from the database.
      setError(err?.message ?? 'Could not create the project.')
      return
    }
    if (memberWarning) push('Project created, but adding you as a member failed — you still have access as the owner.', 'error')
    else push(personal ? 'Personal project created' : 'Project created')
    onCreated()
    onClose()
  }

  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Name" htmlFor="cp-name" required>
        <Input id="cp-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </FieldWrap>
      <FieldWrap label="Description" htmlFor="cp-description">
        <Textarea id="cp-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FieldWrap>
      <div className="ctf-form-row">
        <FieldWrap label="Status" htmlFor="cp-status">
          <Select id="cp-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </FieldWrap>
        <FieldWrap label="Due date" htmlFor="cp-due" hint="Optional">
          <Input id="cp-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FieldWrap>
      </div>
      {!personal && (
        <FieldWrap label="Client" htmlFor="cp-client" hint="Optional. Link this project to a client company now, or later.">
          <Select id="cp-client" value={clientAccountId} onChange={(e) => setClientAccountId(e.target.value)}>
            <option value="">No client yet</option>
            {clients?.map((c) => <option key={c.id} value={c.id}>{c.organization}</option>)}
          </Select>
        </FieldWrap>
      )}
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting} disabled={!name.trim()}>{personal ? 'Create personal project' : 'Create project'}</Button>
      </div>
    </form>
  )
}
