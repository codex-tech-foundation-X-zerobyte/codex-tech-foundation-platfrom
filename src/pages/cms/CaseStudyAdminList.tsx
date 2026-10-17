import { BulkBar, BulkDelete } from '../../components/BulkActions'
import { useSelection } from '../../hooks/useSelection'
import { DeleteButton } from '../../components/DeleteButton'
import { useNavigate } from 'react-router'
import { FileStack, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, StatusBadge, Table } from '../../components/ui'
import { deleteCaseStudy, listAllCaseStudies } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

export function CaseStudyAdminList({ basePath }: { basePath: string }) {
  const { data: items, error, loading, reload } = useAsyncData('once', listAllCaseStudies)
  const sel = useSelection(items, (c) => c.id)
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
        <>
        <Table
          rows={items}
          rowKey={(c) => c.id}
          selection={{ selected: sel.selected, onChange: sel.onChange, label: (c) => c.title }}
          emptyState={<EmptyState icon={FileStack} title="No case studies yet" description="Create your first case study to get started." />}
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          columns={[
            { key: 'title', header: 'Title', render: (c) => <strong>{c.title}</strong> },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.publication_status} /> },
            { key: 'created', header: 'Created', render: (c) => new Date(c.created_at).toLocaleDateString() },
            {
              key: 'actions',
              header: 'Actions',
              render: (c) => (
                <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                  <DeleteButton what="case study" name={c.title} onDelete={() => deleteCaseStudy(c.id)} undo={{ table: 'case_studies', id: c.id }} onDeleted={reload}>
                    {c.publication_status === 'published' && <p>It is live on the website right now and will disappear from it.</p>}
                  </DeleteButton>
                </div>
              ),
            },
          ]}
        />
        <BulkBar count={sel.count} onClear={sel.clear}>
          <BulkDelete table="case_studies" ids={sel.ids} what="case study" plural="case studies" onDone={() => { sel.clear(); reload() }} />
        </BulkBar>
        </>
      )}
    </div>
  )
}
