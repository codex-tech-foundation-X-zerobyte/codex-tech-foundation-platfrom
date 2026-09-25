import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ErrorState, ProgressBar, SkeletonRows, StatusBadge, Tabs } from '../../components/ui'
import { getProject, listProjectMilestones, listProjectUpdates } from '../../lib/services'
import type { Project, ProjectMilestone, ProjectUpdate } from '../../lib/types'
import { ClientRequestForm } from './ClientRequestForm'

export function ClientProjectDetail() {
  const { id } = useParams()
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (!id) return
    void getProject(id).then(({ data }) => {
      setProject(data)
      if (data) {
        void listProjectMilestones(data.id).then((r) => setMilestones(r.data.filter((m) => m.is_public)))
        void listProjectUpdates(data.id).then((r) => setUpdates(r.data.filter((u) => u.published_at)))
      }
    })
  }, [id])

  if (project === undefined) return <SkeletonRows rows={3} height="80px" />
  if (project === null) return <ErrorState title="Project not found" description="This project isn't available on your account." />

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <StatusBadge status={project.status} />
        <h1 style={{ marginTop: 12 }}>{project.name}</h1>
        <p className="lead" style={{ marginTop: 8 }}>{project.description}</p>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'updates', label: 'Updates' },
          { id: 'requests', label: 'Requests' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 24 }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {milestones.map((m) => (
              <div key={m.id} style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong>{m.title}</strong>
                  <StatusBadge status={m.status} />
                </div>
                <ProgressBar value={m.percentage} />
              </div>
            ))}
            {milestones.length === 0 && <p className="ctf-muted">No public milestones yet.</p>}
          </div>
        )}
        {tab === 'updates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {updates.map((u) => (
              <div key={u.id} style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-1)' }}>
                <strong>{u.title}</strong>
                <p style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 14 }}>{u.body}</p>
              </div>
            ))}
            {updates.length === 0 && <p className="ctf-muted">No updates yet.</p>}
          </div>
        )}
        {tab === 'requests' && <ClientRequestForm projectId={project.id} />}
      </div>
    </div>
  )
}
