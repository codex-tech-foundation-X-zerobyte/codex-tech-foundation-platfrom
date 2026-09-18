import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarClock, ExternalLink } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ErrorState, ProgressBar, SkeletonRows, StatusBadge } from '../../components/ui'
import { getPublishedProjectBySlug, listProjectMilestones, listProjectUpdates } from '../../lib/services'
import type { Project, ProjectMilestone, ProjectUpdate } from '../../lib/types'
import { ProjectGlyph } from './ProjectsList'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './ProjectDetail.css'

export function ProjectDetail() {
  const { slug } = useParams()
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [error, setError] = useState(false)
  useDocumentTitle(project ? project.name : undefined)

  useEffect(() => {
    if (!slug) return
    setError(false)
    setProject(undefined)
    void getPublishedProjectBySlug(slug).then(({ data, error: err }) => {
      if (err) { setError(true); return }
      setProject(data)
      if (data) {
        void listProjectMilestones(data.id).then((r) => setMilestones(r.data.filter((m) => m.is_public)))
        void listProjectUpdates(data.id).then((r) => setUpdates(r.data.filter((u) => u.published_at)))
      }
    })
  }, [slug])

  if (error) {
    return (
      <PublicLayout>
        <main className="container ctf-project-detail"><ErrorState /></main>
      </PublicLayout>
    )
  }

  if (project === undefined) {
    return (
      <PublicLayout>
        <main className="container ctf-project-detail"><SkeletonRows rows={3} height="80px" /></main>
      </PublicLayout>
    )
  }

  if (project === null) {
    return (
      <PublicLayout>
        <main className="container ctf-project-detail">
          <ErrorState title="Project not found" description="This project isn't published, or the link has changed." />
        </main>
      </PublicLayout>
    )
  }

  const avgProgress = milestones.length
    ? Math.round(milestones.reduce((sum, m) => sum + m.percentage, 0) / milestones.length)
    : null

  return (
    <PublicLayout>
      <main className="ctf-project-detail">
        <section className="container ctf-project-detail__hero">
          <StatusBadge status={project.status} />
          <h1>{project.name}</h1>
          <p className="lead">{project.description}</p>
        </section>

        <section className="container ctf-project-detail__visual"><ProjectGlyph seed={project.id} /></section>

        {avgProgress !== null && (
          <section className="container ctf-project-detail__progress">
            <div className="ctf-project-detail__progress-head">
              <span>Overall progress</span>
              <strong>{avgProgress}%</strong>
            </div>
            <ProgressBar value={avgProgress} />
          </section>
        )}

        {milestones.length > 0 && (
          <section className="container">
            <h2>Milestones</h2>
            <ul className="ctf-milestones">
              {milestones.map((m) => (
                <li key={m.id}>
                  <StatusBadge status={m.status} />
                  <div>
                    <strong>{m.title}</strong>
                    {m.description && <p>{m.description}</p>}
                  </div>
                  {m.target_date && <span className="ctf-milestones__date"><CalendarClock size={13} /> {m.target_date}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {updates.length > 0 && (
          <section className="container">
            <h2>Updates</h2>
            <ul className="ctf-updates">
              {updates.map((u) => (
                <li key={u.id}>
                  <span>{new Date(u.created_at).toLocaleDateString()}</span>
                  <div>
                    <strong>{u.title}</strong>
                    <p>{u.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="container ctf-project-detail__actions">
          <a href="#" onClick={(e) => e.preventDefault()} className="text-link"><ExternalLink size={14} /> View product (link not configured)</a>
        </section>
      </main>
    </PublicLayout>
  )
}
