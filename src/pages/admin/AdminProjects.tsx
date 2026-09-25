import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, Select, StatusBadge, Table, useToast } from '../../components/ui'
import { CreateProjectModal } from '../../components/CreateProjectModal'
import { listMyProjects, updateProject } from '../../lib/services/projects'
import type { Project, ProjectStatus } from '../../lib/types'

const STATUSES: ProjectStatus[] = ['planning', 'active', 'review', 'complete']

export function AdminProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const load = () => void listMyProjects().then((r) => setProjects(r.data))
  useEffect(load, [])

  const changeStatus = async (project: Project, status: ProjectStatus) => {
    setProjects((prev) => prev?.map((p) => (p.id === project.id ? { ...p, status } : p)) ?? prev)
    const { error } = await updateProject(project.id, { status })
    if (error) { push('Could not update status.', 'error'); load(); return }
    push('Status updated.')
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>New project</Button>
      </div>
      <Table
        loading={projects === null}
        rows={projects ?? []}
        rowKey={(p) => p.id}
        emptyState={<EmptyState icon={FolderKanban} title="No projects yet" description="Create your first project to get started." />}
        columns={[
          { key: 'name', header: 'Project', render: (p) => <strong>{p.name}</strong> },
          { key: 'due', header: 'Due', render: (p) => p.due_date ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (p) => (
              <Select value={p.status} onChange={(e) => void changeStatus(p, e.target.value as ProjectStatus)} aria-label={`Status for ${p.name}`}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            ),
          },
          { key: 'badge', header: '', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
          {
            key: 'actions',
            header: '',
            render: (p) => <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/projects/${p.id}`)}>View</Button>,
          },
        ]}
      />
      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load() }} />
    </>
  )
}
