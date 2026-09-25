import { useEffect, useState } from 'react'
import { FileText, Inbox } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, Select, SkeletonRows, Table, useToast } from '../../components/ui'
import { listApplications, updateApplicationStatus } from '../../lib/services'
import { storage } from '../../lib/services/shared'
import type { ApplicationStatus, JobApplication } from '../../lib/types'

const STATUS_TONE: Record<ApplicationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  received: 'neutral',
  reviewing: 'warning',
  interview: 'warning',
  declined: 'danger',
  hired: 'success',
}

export function AdminApplications() {
  const [items, setItems] = useState<JobApplication[] | null>(null)
  const [error, setError] = useState(false)
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listApplications().then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
  }
  useEffect(load, [])

  const changeStatus = async (application: JobApplication, status: ApplicationStatus) => {
    setItems((prev) => prev?.map((a) => (a.id === application.id ? { ...a, status } : a)) ?? prev)
    const { error: err } = await updateApplicationStatus(application.id, status)
    if (err) { push('Could not update status.', 'error'); load(); return }
    push('Status updated')
  }

  // Resumes live in a private bucket; this mints a short-lived signed URL on
  // click rather than ever storing/exposing a public resume link (§28).
  const openResume = async (path: string) => {
    const { url, error: err } = await storage.getSignedUrl('applications', path, 120)
    if (err || !url) { push('Could not open this resume.', 'error'); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      {items === null && <SkeletonRows rows={4} />}
      {items !== null && (
        <Table
          rows={items}
          rowKey={(a) => a.id}
          emptyState={<EmptyState icon={Inbox} title="No applications yet" description="Applications submitted through the Careers page will appear here." />}
          columns={[
            { key: 'name', header: 'Candidate', render: (a) => <strong>{a.name}</strong> },
            { key: 'email', header: 'Email', render: (a) => a.email },
            { key: 'applied', header: 'Applied', render: (a) => new Date(a.created_at).toLocaleDateString() },
            {
              key: 'resume',
              header: 'Resume',
              render: (a) =>
                a.resume_path ? (
                  <Button variant="ghost" size="sm" icon={<FileText size={14} />} onClick={() => void openResume(a.resume_path!)}>View</Button>
                ) : '—',
            },
            {
              key: 'status',
              header: 'Status',
              render: (a) => (
                <Select value={a.status} onChange={(e) => void changeStatus(a, e.target.value as ApplicationStatus)} aria-label={`Status for ${a.name}`}>
                  {(['received', 'reviewing', 'interview', 'declined', 'hired'] as ApplicationStatus[]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              ),
            },
            { key: 'badge', header: '', render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
          ]}
        />
      )}
    </div>
  )
}
