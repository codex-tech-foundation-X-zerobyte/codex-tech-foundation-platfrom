import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, FolderKanban } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows, StatusBadge } from '../../components/ui'
import { listPublishedProjects } from '../../lib/services'
import type { Project } from '../../lib/types'
import './ProjectsList.css'

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'planning', label: 'In development' },
  { id: 'active', label: 'Active' },
  { id: 'review', label: 'Maintenance' },
  { id: 'complete', label: 'Completed' },
]

export function ProjectsList() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const load = () => {
    setError(false)
    setProjects(null)
    void listPublishedProjects().then(({ data, error: err }) => {
      if (err) setError(true)
      else setProjects(data)
    })
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    if (!projects) return []
    return projects.filter((p) => {
      const matchesStatus = filter === 'all' || p.status === filter
      const matchesQuery = query.trim() === '' || p.name.toLowerCase().includes(query.toLowerCase())
      return matchesStatus && matchesQuery
    })
  }, [projects, filter, query])

  const [featured, ...rest] = filtered

  return (
    <PublicLayout>
      <main className="container ctf-projects-page">
        <SectionHeading eyebrow="Selected work" title="Projects we've shipped and are shipping." />

        <div className="ctf-projects-toolbar">
          <input
            type="search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search projects"
          />
          <div className="ctf-projects-filters">
            {STATUS_FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorState onRetry={load} />}
        {!error && projects === null && <SkeletonRows rows={4} height="140px" />}
        {!error && projects !== null && filtered.length === 0 && (
          <EmptyState
            icon={FolderKanban}
            title="No published projects match yet"
            description="Published, publicly-visible projects will appear here as soon as they go live."
          />
        )}

        {featured && (
          <Link to={`/projects/${featured.slug}`} className="ctf-featured-project">
            <div className="ctf-featured-project__visual" aria-hidden="true">
              <ProjectGlyph seed={featured.id} />
            </div>
            <div className="ctf-featured-project__copy">
              <StatusBadge status={featured.status} />
              <h2>{featured.name}</h2>
              <p>{featured.description}</p>
              <span className="ctf-featured-project__link">View project <ArrowUpRight size={14} /></span>
            </div>
          </Link>
        )}

        {rest.length > 0 && (
          <div className="ctf-project-grid">
            {rest.map((project) => (
              <Link className="ctf-project-card" to={`/projects/${project.slug}`} key={project.id}>
                <div className="ctf-project-card__visual" aria-hidden="true"><ProjectGlyph seed={project.id} compact /></div>
                <StatusBadge status={project.status} />
                <h3>{project.name}</h3>
                <p>{project.description}</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </PublicLayout>
  )
}

/** Elegant metadata-derived placeholder visual — never a fabricated product screenshot. */
export function ProjectGlyph({ seed, compact = false }: { seed: string; compact?: boolean }) {
  const hash = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const bars = Array.from({ length: compact ? 5 : 8 }, (_, i) => 20 + ((hash * (i + 3)) % 60))
  return (
    <svg viewBox={`0 0 ${bars.length * 24} 80`} width="100%" height="100%">
      {bars.map((h, i) => (
        <rect key={i} x={i * 24 + 4} y={80 - h} width="12" height={h} rx="3" fill={i % 3 === 0 ? '#5170ff' : '#1c2333'} />
      ))}
    </svg>
  )
}
