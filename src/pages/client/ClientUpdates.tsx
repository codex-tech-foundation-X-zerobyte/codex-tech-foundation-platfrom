import { Newspaper } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listMyClientProjects, listProjectUpdates } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

async function fetchAllUpdates() {
  const { data: projects, error } = await listMyClientProjects()
  if (error) return { data: [], error }
  const results = await Promise.all(projects.map(async (p) => {
    const { data } = await listProjectUpdates(p.id)
    return data.filter((u) => u.published_at).map((u) => ({ ...u, projectName: p.name }))
  }))
  const all = results.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return { data: all, error: null }
}

export function ClientUpdates() {
  const { data: updates, error, loading, reload } = useAsyncData('once', fetchAllUpdates)

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="Project" title="Updates" />
      {loading && <SkeletonRows rows={3} />}
      {!loading && updates?.length === 0 && (
        <EmptyState icon={Newspaper} title="No updates yet" description="Updates shared by the team will appear here." />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {updates?.map((u) => (
          <div key={u.id} style={{ padding: 20, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-1)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{u.projectName} · {new Date(u.created_at).toLocaleDateString()}</span>
            <strong style={{ display: 'block', marginTop: 6 }}>{u.title}</strong>
            <p style={{ marginTop: 6, fontSize: 14, color: 'var(--text-tertiary)' }}>{u.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
