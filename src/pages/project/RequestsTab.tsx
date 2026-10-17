import { Inbox } from 'lucide-react'
import { Badge, EmptyState, ErrorState, Select, SkeletonRows, StatusBadge, useToast } from '../../components/ui'
import { listProjectRequests, updateProjectRequestStatus } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { RequestStatus } from '../../lib/types'
import { KIND_LABEL } from '../../lib/requestMeta'
import '../client/requestUi.css'

const STATUSES: { id: RequestStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'in_review', label: 'In review' },
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
  { id: 'complete', label: 'Complete' },
]

/** Staff triage for the requests a client raises on this project. */
export function RequestsTab({ projectId }: { projectId: string }) {
  const { data: requests, error, loading, reload } = useAsyncData(projectId, () => listProjectRequests({ projectId }))
  const { push } = useToast()

  if (error) return <ErrorState title="Requests didn't load" description="Check your connection and try again." onRetry={reload} />
  if (loading) return <SkeletonRows rows={3} height="72px" />
  if (!requests || requests.length === 0) {
    return <EmptyState icon={Inbox} title="No requests from the client" description="When the client raises a request, change or bug on this project, it shows up here for you to triage." />
  }

  const change = async (id: string, status: RequestStatus) => {
    const { error: err } = await updateProjectRequestStatus(id, status)
    if (err) push(err.message, 'error')
    else push('Request updated.')
    reload()
  }

  return (
    <div className="ctf-req-list">
      {requests.map((r) => (
        <article key={r.id} className="ctf-req-card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ flex: 1, minWidth: 200 }}>{r.title}</strong>
            <Badge tone="neutral">{KIND_LABEL[r.kind] ?? 'Request'}</Badge>
            {(r.priority === 'high' || r.priority === 'urgent') && <Badge tone={r.priority === 'urgent' ? 'danger' : 'warning'}>{r.priority}</Badge>}
            <StatusBadge status={r.status} />
            <Select aria-label={`Status for ${r.title}`} value={r.status} onChange={(e) => void change(r.id, e.target.value as RequestStatus)} style={{ width: 140, height: 32 }}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.body || 'No further details.'}</p>
          <span className="ctf-muted">Raised {new Date(r.created_at).toLocaleString()}</span>
        </article>
      ))}
    </div>
  )
}
