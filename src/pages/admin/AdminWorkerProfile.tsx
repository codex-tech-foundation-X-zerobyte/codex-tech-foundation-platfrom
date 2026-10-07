import { useParams } from 'react-router'
import { Badge, Button, ErrorState, SkeletonRows, useToast } from '../../components/ui'
import { getWorkerById, updateWorkerStatus } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminWorkerProfile.css'

export function AdminWorkerProfile() {
  const { id } = useParams()
  const { data: worker, error, loading, reload } = useAsyncData(id ?? '', () => getWorkerById(id ?? ''))
  const { push } = useToast()

  if (error) return <ErrorState onRetry={reload} />
  if (loading) return <SkeletonRows rows={4} height="50px" />
  if (!worker) return <ErrorState title="Worker not found" />

  const toggleStatus = async () => {
    const next = worker.status === 'active' ? 'suspended' : 'active'
    const { error: err } = await updateWorkerStatus(worker.user_id, next)
    push(err ? err.message : `Worker ${next}`, err ? 'error' : 'success')
    reload()
  }

  return (
    <div className="ctf-worker-profile">
      <div className="ctf-worker-profile__head">
        <div>
          <h1>{worker.display_name}</h1>
          <span>{worker.worker_id} · {worker.position || 'No position set'}</span>
        </div>
        <Badge tone={worker.status === 'active' ? 'success' : 'danger'}>{worker.status}</Badge>
      </div>

      <div className="ctf-worker-profile__grid">
        <div className="ctf-worker-profile__field"><span>Phone</span><strong>{worker.phone || '—'}</strong></div>
        <div className="ctf-worker-profile__field"><span>Join date</span><strong>{worker.join_date || '—'}</strong></div>
        <div className="ctf-worker-profile__field"><span>Skills</span><strong>{worker.skills.length ? worker.skills.join(', ') : '—'}</strong></div>
      </div>

      {worker.bio && (
        <div className="ctf-worker-profile__bio">
          <span>Bio</span>
          <p>{worker.bio}</p>
        </div>
      )}

      <Button variant={worker.status === 'active' ? 'danger' : 'primary'} onClick={() => void toggleStatus()}>
        {worker.status === 'active' ? 'Suspend worker' : 'Reactivate worker'}
      </Button>
    </div>
  )
}
