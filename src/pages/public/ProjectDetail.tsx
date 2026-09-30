import { useParams } from 'react-router'
import { CalendarClock, ExternalLink } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ErrorState, ProgressBar, SkeletonRows, StatusBadge } from '../../components/ui'
import { getPublishedProjectBySlug, listProjectMilestones, listProjectUpdates } from '../../lib/services'
import type { Project, ProjectMilestone, ProjectUpdate } from '../../lib/types'
import { ProjectGlyph } from './ProjectsList'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './ProjectDetail.css'

interface ProjectDetailData {
  project: Project | null
  milestones: ProjectMilestone[]
  updates: ProjectUpdate[]
}

async function fetchProjectDetail(slug: string): Promise<{ data: ProjectDetailData; error: Error | null }> {
  const { data: project, error } = await getPublishedProjectBySlug(slug)
  if (error || !project) return { data: { project: null, milestones: [], updates: [] }, error }

  const [milestones, updates] = await Promise.all([listProjectMilestones(project.id), listProjectUpdates(project.id)])
  return {
    data: {
      project,
      milestones: milestones.data.filter((m) => m.is_public),
      updates: updates.data.filter((u) => u.published_at),
    },
    error: null,
  }
}

export function ProjectDetail() {
  const { slug } = useParams()
  const { data, error, loading } = useAsyncData(slug ?? '', () => fetchProjectDetail(slug ?? ''))
  const project = data?.project ?? null
  useDocumentTitle(project ? project.name : undefined)

  if (error) {
    return (
      <PublicLayout>
        <main className="container ctf-project-detail"><ErrorState /></main>
      </PublicLayout>
    )
  }

  if (loading) {
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

  const milestones = data?.milestones ?? []
  const updates = data?.updates ?? []
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
