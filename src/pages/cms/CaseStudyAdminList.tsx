import { useNavigate } from 'react-router'
import { FileStack, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, StatusBadge, Table } from '../../components/ui'
import { listAllCaseStudies } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

export function CaseStudyAdminList({ basePath }: { basePath: string }) {
  const { data: items, error, loading, reload } = useAsyncData('once', listAllCaseStudies)
  const navigate = useNavigate()

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Case studies"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New case study</Button>}
      />
      {loading && <SkeletonRows rows={4} />}
      {!loading && items !== null && (
        <Table
          rows={items}
          rowKey={(c) => c.id}
          emptyState={<EmptyState icon={FileStack} title="No case studies yet" description="Create your first case study to get started." />}
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          columns={[
            { key: 'title', header: 'Title', render: (c) => <strong>{c.title}</strong> },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.publication_status} /> },
            { key: 'created', header: 'Created', render: (c) => new Date(c.created_at).toLocaleDateString() },
          ]}
        />
      )}
    </div>
  )
}
