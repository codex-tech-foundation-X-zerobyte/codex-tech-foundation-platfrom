import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { archiveCareer, listAllCareers, setCareerPublished } from '../../lib/services'
import type { Career } from '../../lib/types'

function statusOf(c: Career): { label: string; tone: 'neutral' | 'success' | 'danger' } {
  if (c.archived_at) return { label: 'archived', tone: 'neutral' }
  if (c.published_at) return { label: 'published', tone: 'success' }
  return { label: 'draft', tone: 'neutral' }
}

export function CareersAdminList({ basePath }: { basePath: string }) {
  const [items, setItems] = useState<Career[] | null>(null)
  const [error, setError] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listAllCareers().then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
  }
  useEffect(load, [])

  const togglePublish = async (c: Career, event: MouseEvent) => {
    event.stopPropagation()
    const { error: err } = await setCareerPublished(c.id, !c.published_at)
    push(err ? 'Could not update publish status.' : c.published_at ? 'Unpublished' : 'Published', err ? 'error' : 'success')
    load()
  }

  const archive = async (c: Career, event: MouseEvent) => {
    event.stopPropagation()
    const { error: err } = await archiveCareer(c.id)
    push(err ? 'Could not archive this position.' : 'Archived', err ? 'error' : 'success')
    load()
  }

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      <SectionHeading
        eyebrow="Careers"
        title="Open positions"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New position</Button>}
      />
      {items === null && <SkeletonRows rows={4} />}
      {items !== null && (
        <Table
          rows={items}
          rowKey={(c) => c.id}
          emptyState={<EmptyState icon={Briefcase} title="No open positions" description="Create a listing to start accepting applications." />}
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          columns={[
            { key: 'title', header: 'Position', render: (c) => <strong>{c.title}</strong> },
            { key: 'team', header: 'Team', render: (c) => c.team || '—' },
            { key: 'location', header: 'Location', render: (c) => c.location || '—' },
            { key: 'status', header: 'Status', render: (c) => { const s = statusOf(c); return <Badge tone={s.tone}>{s.label}</Badge> } },
            {
              key: 'actions',
              header: 'Actions',
              render: (c) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" size="sm" onClick={(e) => void togglePublish(c, e)}>{c.published_at ? 'Unpublish' : 'Publish'}</Button>
                  <Button variant="ghost" size="sm" onClick={(e) => void archive(c, e)}>Archive</Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
