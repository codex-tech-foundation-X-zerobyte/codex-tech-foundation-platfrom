import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { EmptyState, Table, StatusBadge } from '../../components/ui'
import { listMyProjects } from '../../lib/services'
import type { Project } from '../../lib/types'

export function WorkerProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => { void listMyProjects().then((r) => setProjects(r.data)) }, [])

  return (
    <Table
      loading={projects === null}
      rows={projects ?? []}
      rowKey={(p) => p.id}
      onRowClick={(p) => navigate(`/worker/projects/${p.id}`)}
      emptyState={<EmptyState icon={FolderKanban} title="No projects yet" description="Projects assigned to you will appear here." />}
      columns={[
        { key: 'name', header: 'Project', render: (p) => <strong>{p.name}</strong> },
        { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { key: 'due', header: 'Due', render: (p) => p.due_date ?? '—' },
        { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
      ]}
    />
  )
}
