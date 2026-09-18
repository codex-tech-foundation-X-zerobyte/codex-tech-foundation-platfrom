import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { listAllCaseStudies, setCaseStudyStatus } from '../../lib/services'
import type { CaseStudy, PublicationStatus } from '../../lib/types'

const STATUS_TONE: Record<PublicationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  review: 'warning',
  published: 'success',
  unpublished: 'neutral',
  archived: 'neutral',
}

export function CaseStudyAdminList({ basePath }: { basePath: string }) {
  const [items, setItems] = useState<CaseStudy[] | null>(null)
  const [error, setError] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listAllCaseStudies().then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
  }
  useEffect(load, [])

  const togglePublish = async (cs: CaseStudy, event: MouseEvent) => {
    event.stopPropagation()
    const next: PublicationStatus = cs.publication_status === 'published' ? 'unpublished' : 'published'
    const { error: err } = await setCaseStudyStatus(cs.id, next)
    push(err ? 'Could not update status.' : next === 'published' ? 'Published' : 'Unpublished', err ? 'error' : 'success')
    load()
  }

  const archive = async (cs: CaseStudy, event: MouseEvent) => {
    event.stopPropagation()
    const { error: err } = await setCaseStudyStatus(cs.id, 'archived')
    push(err ? 'Could not archive this case study.' : 'Archived', err ? 'error' : 'success')
    load()
  }

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Case studies"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New case study</Button>}
      />
      {items === null && <SkeletonRows rows={4} />}
      {items !== null && (
        <Table
          rows={items}
          rowKey={(cs) => cs.id}
          emptyState={<EmptyState icon={Layers} title="No case studies yet" description="Publish your first case study to showcase a project outcome." />}
          onRowClick={(cs) => navigate(`${basePath}/${cs.id}`)}
          columns={[
            { key: 'title', header: 'Title', render: (cs) => <strong>{cs.title}</strong> },
            { key: 'status', header: 'Status', render: (cs) => <Badge tone={STATUS_TONE[cs.publication_status]}>{cs.publication_status}</Badge> },
            { key: 'featured', header: 'Featured', render: (cs) => (cs.featured ? <Badge tone="success">Featured</Badge> : '—') },
            {
              key: 'actions',
              header: 'Actions',
              render: (cs) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" size="sm" onClick={(e) => void togglePublish(cs, e)}>
                    {cs.publication_status === 'published' ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => void archive(cs, e)}>Archive</Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
