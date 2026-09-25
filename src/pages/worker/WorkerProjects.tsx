import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
<<<<<<< HEAD
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, Table, StatusBadge } from '../../components/ui'
import { CreateProjectModal } from '../../components/CreateProjectModal'
=======
<<<<<<< HEAD
import { FolderKanban } from 'lucide-react'
import { EmptyState, Table, StatusBadge } from '../../components/ui'
=======
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, Table, StatusBadge } from '../../components/ui'
import { CreateProjectModal } from '../../components/CreateProjectModal'
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
import { listMyProjects } from '../../lib/services'
import type { Project } from '../../lib/types'

export function WorkerProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null)
<<<<<<< HEAD
=======
<<<<<<< HEAD
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
=======
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const load = () => void listMyProjects().then((r) => setProjects(r.data))
  useEffect(load, [])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>New project</Button>
      </div>
      <Table
        loading={projects === null}
        rows={projects ?? []}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/worker/projects/${p.id}`)}
        emptyState={<EmptyState icon={FolderKanban} title="No projects yet" description="Create your first project, or projects assigned to you will appear here." />}
        columns={[
          { key: 'name', header: 'Project', render: (p) => <strong>{p.name}</strong> },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'due', header: 'Due', render: (p) => p.due_date ?? '—' },
          { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
        ]}
      />
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(project) => { setCreateOpen(false); load(); navigate(`/worker/projects/${project.id}`) }}
      />
    </>
<<<<<<< HEAD
=======
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
  )
}
