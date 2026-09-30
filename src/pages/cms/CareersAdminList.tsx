import { useNavigate } from 'react-router'
import { Briefcase, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table } from '../../components/ui'
import { listAllCareers } from '../../lib/services'
import type { Career } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'

function statusOf(c: Career): { label: string; tone: 'neutral' | 'success' } {
  if (c.archived_at) return { label: 'archived', tone: 'neutral' }
  if (c.published_at) return { label: 'published', tone: 'success' }
  return { label: 'draft', tone: 'neutral' }
}

export function CareersAdminList({ basePath }: { basePath: string }) {
  const { data: roles, error, loading, reload } = useAsyncData('once', listAllCareers)
  const navigate = useNavigate()

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Careers"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New role</Button>}
      />
      {loading && <SkeletonRows rows={4} />}
      {!loading && roles !== null && (
        <Table
          rows={roles}
          rowKey={(c) => c.id}
          emptyState={<EmptyState icon={Briefcase} title="No roles yet" description="Post your first open role." />}
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          columns={[
            { key: 'title', header: 'Role', render: (c) => <strong>{c.title}</strong> },
            { key: 'team', header: 'Team', render: (c) => c.team || '—' },
            { key: 'status', header: 'Status', render: (c) => { const s = statusOf(c); return <Badge tone={s.tone}>{s.label}</Badge> } },
          ]}
        />
      )}
    </div>
  )
}
