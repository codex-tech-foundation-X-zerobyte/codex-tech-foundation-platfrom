import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { FolderKanban, Lock } from 'lucide-react'
import { Badge, EmptyState, Table, StatusBadge } from '../../components/ui'
import { CreateProjectButton } from '../../components/CreateProjectModal'
import { listMyProjects } from '../../lib/services'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import type { Project } from '../../lib/types'
import './WorkerProjects.css'

export function WorkerProjects() {
  useDocumentTitle('Projects')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const navigate = useNavigate()

  const load = () => void listMyProjects().then((r) => setProjects(r.data))
  useEffect(load, [])

  const personal = (projects ?? []).filter((p) => p.scope === 'personal')
  const company = (projects ?? []).filter((p) => p.scope !== 'personal')
  const columns = [
    { key: 'name', header: 'Project', render: (p: Project) => <strong>{p.name}</strong> },
    { key: 'status', header: 'Status', render: (p: Project) => <StatusBadge status={p.status} /> },
    { key: 'due', header: 'Due', render: (p: Project) => p.due_date ?? '—' },
    { key: 'updated', header: 'Updated', render: (p: Project) => new Date(p.updated_at).toLocaleDateString() },
  ]

  return (
    <div className="ctf-wprojects">
      <section aria-labelledby="wp-company">
        <header className="ctf-wprojects__head"><h2 id="wp-company">Company projects</h2><span>Assigned to you or your departments</span></header>
        <Table
          loading={projects === null}
          rows={company}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/worker/projects/${p.id}`)}
          emptyState={<EmptyState icon={FolderKanban} title="No company projects yet" description="Projects your departments are working on will appear here." />}
          columns={columns}
        />
      </section>

      <section aria-labelledby="wp-personal" className="ctf-wprojects__personal">
        <header className="ctf-wprojects__head">
          <div><h2 id="wp-personal">My personal projects <Badge tone="neutral"><Lock size={11} style={{ verticalAlign: '-1px' }} /> Private</Badge></h2>
            <span>Your own space. Only you, people you invite and Main Admins can see these.</span></div>
          <CreateProjectButton scope="personal" onCreated={load} />
        </header>
        <Table
          loading={projects === null}
          rows={personal}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/worker/projects/${p.id}`)}
          emptyState={<EmptyState icon={Lock} title="No personal projects yet" description="Start something of your own: a side project, a learning goal, a prototype. Invite teammates when you want help." action={<CreateProjectButton scope="personal" onCreated={load} />} />}
          columns={columns}
        />
      </section>
    </div>
  )
}
