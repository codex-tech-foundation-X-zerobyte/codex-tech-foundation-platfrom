import { useState } from 'react'
import { Inbox, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, SkeletonRows } from '../../components/ui'
import { listProjectRequests } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Project } from '../../lib/types'
import { NewRequestModal, RequestCard } from './requestUi'
import './requestUi.css'

/** The "Requests" tab inside a single project. */
export function ClientRequestForm({ projectId, project }: { projectId: string; project?: Project }) {
  const { data: requests, error, loading, reload } = useAsyncData(projectId, () => listProjectRequests({ projectId }))
  const [creating, setCreating] = useState(false)
  const fallbackProject = { id: projectId, name: project?.name ?? 'This project' } as Project

  if (error) return <ErrorState title="Requests didn't load" description="Check your connection and try again." onRetry={reload} />
  if (loading) return <SkeletonRows rows={3} height="60px" />

  return (
    <div>
      <div className="ctf-req-toolbar">
        <span className="ctf-muted">{requests?.length ?? 0} request{requests?.length === 1 ? '' : 's'} on this project</span>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New request</Button>
      </div>
      {requests && requests.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests yet" description="Requests you send for this project are tracked here, from open to done." />
      ) : (
        <div className="ctf-req-list">{requests?.map((r) => <RequestCard key={r.id} request={r} />)}</div>
      )}
      <NewRequestModal
        open={creating}
        onClose={() => setCreating(false)}
        projects={[fallbackProject]}
        projectId={projectId}
        kinds={['request', 'change', 'bug', 'maintenance']}
        title="New request"
        description="Ask for new work, a change, or report a problem."
        onCreated={reload}
      />
    </div>
  )
}
