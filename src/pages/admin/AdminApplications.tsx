import { Download, FileText, UserCog } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, Select, SkeletonRows, Table, useToast } from '../../components/ui'
import { getResumeDownloadUrl, listApplications, updateApplicationStatus } from '../../lib/services'
import type { ApplicationStatus, JobApplication } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'

const STATUSES: ApplicationStatus[] = ['received', 'reviewing', 'interview', 'declined', 'hired']

export function AdminApplications() {
  const { data: applications, error, loading, reload } = useAsyncData('once', () => listApplications())
  const { push } = useToast()

  const changeStatus = async (app: JobApplication, status: ApplicationStatus) => {
    const { error: err } = await updateApplicationStatus(app.id, status)
    push(err ? 'Could not update status.' : 'Status updated', err ? 'error' : 'success')
    reload()
  }

  const downloadResume = async (app: JobApplication) => {
    if (!app.resume_path) { push('No résumé attached.', 'error'); return }
    const { url, error: err } = await getResumeDownloadUrl(app.resume_path)
    if (err || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="Hiring" title="Applications" />
      {loading && <SkeletonRows rows={4} />}
      {!loading && applications !== null && (
        <Table
          rows={applications}
          rowKey={(a) => a.id}
          emptyState={<EmptyState icon={UserCog} title="No applications yet" description="Job applications will appear here as candidates apply." />}
          columns={[
            { key: 'name', header: 'Candidate', render: (a) => <strong>{a.name}</strong> },
            { key: 'email', header: 'Email', render: (a) => a.email },
            { key: 'applied', header: 'Applied', render: (a) => new Date(a.created_at).toLocaleDateString() },
            {
              key: 'resume',
              header: 'Résumé',
              render: (a) => a.resume_path
                ? <button className="text-link" onClick={() => void downloadResume(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={13} /> Download</button>
                : <span style={{ color: 'var(--text-faint)' }}><FileText size={13} /> None</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (a) => (
                <Select value={a.status} onChange={(e) => void changeStatus(a, e.target.value as ApplicationStatus)} aria-label={`Status for ${a.name}`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
