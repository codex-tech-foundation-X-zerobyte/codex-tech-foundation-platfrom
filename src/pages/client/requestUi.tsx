import { useState, type FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge, Button, FieldWrap, Input, Modal, Select, StatusBadge, Textarea, useToast } from '../../components/ui'
import { createProjectRequest } from '../../lib/services'
import type { Project, ProjectRequest, RequestKind, RequestPriority } from '../../lib/types'
import { KIND_LABEL } from '../../lib/requestMeta'
import './requestUi.css'

const PRIORITIES: { id: RequestPriority; label: string }[] = [
  { id: 'low', label: 'Low — whenever suits' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High — blocking something' },
  { id: 'urgent', label: 'Urgent — something is broken now' },
]

interface NewRequestModalProps {
  open: boolean
  onClose: () => void
  projects: Project[]
  /** Which kinds this entry point offers (Requests page vs Maintenance page). */
  kinds: RequestKind[]
  title: string
  description: string
  /** When set the project is fixed (e.g. opened from inside a project). */
  projectId?: string
  onCreated: () => void
}

export function NewRequestModal({ open, onClose, projects, kinds, title, description, projectId, onCreated }: NewRequestModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      {/* Own component so the form's state resets every time the dialog is opened. */}
      <NewRequestForm projects={projects} kinds={kinds} projectId={projectId} onClose={onClose} onCreated={onCreated} />
    </Modal>
  )
}

function NewRequestForm({ projects, kinds, projectId, onClose, onCreated }: Pick<NewRequestModalProps, 'projects' | 'kinds' | 'projectId' | 'onClose' | 'onCreated'>) {
  const { push } = useToast()
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '')
  const [kind, setKind] = useState<RequestKind>(kinds[0])
  const [priority, setPriority] = useState<RequestPriority>('normal')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!project) { setError('Choose a project first.'); return }
    setSubmitting(true)
    setError('')
    const { error: err } = await createProjectRequest({ project_id: project, title: subject.trim(), body: details.trim(), kind, priority })
    setSubmitting(false)
    if (err) {
      // Never pretend it worked: the old form cleared itself and said nothing when the insert was rejected.
      setError(err.message.includes('row-level security') ? "You don't have access to file a request on that project." : `Your request wasn't sent: ${err.message}`)
      return
    }
    push('Request sent — the team has been notified.')
    onCreated()
    onClose()
  }

  if (projects.length === 0) {
    return <p className="ctf-muted">You don't have a project yet, so there's nothing to raise a request against. Once one is set up for your account, you can file requests here.</p>
  }

  return (
    <form className="ctf-req-form" onSubmit={(e) => void submit(e)}>
      {error && <div className="ctf-form-error" role="alert">{error}</div>}
      {projects.length > 1 && !projectId && (
        <FieldWrap label="Project" htmlFor="req-project">
          <Select id="req-project" value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FieldWrap>
      )}
      <div className="ctf-form-row">
        {kinds.length > 1 && (
          <FieldWrap label="Type" htmlFor="req-kind">
            <Select id="req-kind" value={kind} onChange={(e) => setKind(e.target.value as RequestKind)}>
              {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </FieldWrap>
        )}
        <FieldWrap label="Priority" htmlFor="req-priority">
          <Select id="req-priority" value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority)}>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </FieldWrap>
      </div>
      <FieldWrap label="Subject" htmlFor="req-subject" required>
        <Input id="req-subject" required maxLength={140} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One line the team can scan" />
      </FieldWrap>
      <FieldWrap label="Details" htmlFor="req-details" required hint="What should happen, what happens instead, and any links or steps to reproduce.">
        <Textarea id="req-details" required rows={5} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </FieldWrap>
      <div className="ctf-req-form__actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting}>Send request</Button>
      </div>
    </form>
  )
}

export function RequestCard({ request, projectName }: { request: ProjectRequest; projectName?: string }) {
  const [open, setOpen] = useState(false)
  const resolved = request.status === 'complete' || request.status === 'declined' || request.status === 'approved'
  return (
    <article className={`ctf-req-card ${resolved ? 'is-resolved' : ''}`}>
      <button className="ctf-req-card__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <div className="ctf-req-card__main">
          <strong>{request.title}</strong>
          <span>
            {projectName && <>{projectName} · </>}
            {KIND_LABEL[request.kind] ?? 'Request'} · {new Date(request.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        {(request.priority === 'high' || request.priority === 'urgent') && <Badge tone={request.priority === 'urgent' ? 'danger' : 'warning'}>{request.priority}</Badge>}
        <StatusBadge status={request.status} />
        <ChevronDown size={16} className="ctf-req-card__chevron" aria-hidden="true" />
      </button>
      {open && <p className="ctf-req-card__body">{request.body || 'No further details.'}</p>}
    </article>
  )
}
