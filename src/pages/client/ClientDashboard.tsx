import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, FolderKanban, Inbox } from 'lucide-react'
import { EmptyState, ProgressBar, SectionHeading, StatusBadge } from '../../components/ui'
import { listMyProjects, listProjectMilestones, listProjectRequests } from '../../lib/services'
import type { Project, ProjectMilestone, ProjectRequest } from '../../lib/types'
import './ClientDashboard.css'

export function ClientDashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [requests, setRequests] = useState<ProjectRequest[] | null>(null)

  useEffect(() => {
    void listMyProjects().then((r) => {
      setProjects(r.data)
      const current = r.data[0]
      if (current) void listProjectMilestones(current.id).then((m) => setMilestones(m.data.filter((x) => x.is_public)))
    })
    void listProjectRequests().then((r) => setRequests(r.data))
  }, [])

  const current = projects?.[0]
  const nextMilestone = milestones.find((m) => m.status !== 'complete')
  const openRequests = requests?.filter((r) => r.status === 'open' || r.status === 'in_review') ?? []

  return (
    <div className="ctf-client-dashboard">
      <SectionHeading eyebrow="Overview" title="Your project, at a glance." />

      {projects !== null && !current && (
        <EmptyState icon={FolderKanban} title="No active project yet" description="Once a project is set up for your account, its progress will appear here." />
      )}

      {current && (
        <div className="ctf-client-dashboard__grid">
          <Link to={`/client/projects/${current.id}`} className="ctf-client-project-card">
            <StatusBadge status={current.status} />
            <h2>{current.name}</h2>
            <p>{current.description}</p>
            {nextMilestone && (
              <div className="ctf-client-project-card__milestone">
                <span>Next milestone: {nextMilestone.title}</span>
                <ProgressBar value={nextMilestone.percentage} />
              </div>
            )}
          </Link>

          <div className="ctf-client-dashboard__side">
            <div className="ctf-client-side-block">
              <h3><Inbox size={15} /> Outstanding requests</h3>
              {openRequests.length === 0 ? (
                <p className="ctf-muted">No open requests.</p>
              ) : (
                <ul>{openRequests.slice(0, 4).map((r) => <li key={r.id}>{r.title}</li>)}</ul>
              )}
            </div>
            <div className="ctf-client-side-block">
              <h3><FileText size={15} /> Recent files</h3>
              <p className="ctf-muted">Shared files will appear here once uploaded to your project.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
