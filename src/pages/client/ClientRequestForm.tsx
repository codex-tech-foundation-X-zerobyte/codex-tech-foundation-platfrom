import { useEffect, useState, type FormEvent } from 'react'
import { Button, EmptyState, FieldWrap, Input, Select, StatusBadge, Textarea } from '../../components/ui'
import { createProjectRequest, listProjectRequests } from '../../lib/services'
import type { ProjectRequest } from '../../lib/types'
import { Inbox } from 'lucide-react'

export function ClientRequestForm({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<ProjectRequest[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState('normal')
  const [submitting, setSubmitting] = useState(false)

  const load = () => void listProjectRequests({ projectId }).then((r) => setRequests(r.data))
  useEffect(load, [projectId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await createProjectRequest({ project_id: projectId, title, body: `[${priority}] ${body}` })
    setTitle('')
    setBody('')
    setSubmitting(false)
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FieldWrap label="Subject" htmlFor="req-title" required>
          <Input id="req-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Priority" htmlFor="req-priority">
          <Select id="req-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </FieldWrap>
        <FieldWrap label="Description" htmlFor="req-body" required>
          <Textarea id="req-body" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </FieldWrap>
        <Button type="submit" variant="primary" loading={submitting}>Submit request</Button>
      </form>

      <div>
        {requests !== null && requests.length === 0 && (
          <EmptyState icon={Inbox} title="No requests yet" description="Requests you submit for this project will be tracked here." />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requests?.map((r) => (
            <div key={r.id} style={{ padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.title}</strong>
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
