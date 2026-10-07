import { useNavigate } from 'react-router'
import { FolderKanban } from 'lucide-react'
import { EmptyState, SectionHeading, StatusBadge, Table } from '../../components/ui'
import { CreateProjectButton } from '../../components/CreateProjectModal'
import { listMyProjects } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

export function AdminProjects() {
  const { data: projects, loading, reload } = useAsyncData('once', listMyProjects)
  const navigate = useNavigate()

  return (
    <div>
      <SectionHeading
        eyebrow="Operations"
        title="Projects"
        action={<CreateProjectButton onCreated={reload} />}
      />
      <Table
        loading={loading}
        rows={projects ?? []}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/admin/projects/${p.id}`)}
        emptyState={
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create the first project to get started."
            action={<CreateProjectButton onCreated={reload} />}
          />
        }
        columns={[
          { key: 'name', header: 'Project', render: (p) => <strong>{p.name}</strong> },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'due', header: 'Due', render: (p) => p.due_date ?? '—' },
          { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
        ]}
      />
    </div>
  )
}
