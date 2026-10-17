import { DeleteButton } from '../../components/DeleteButton'
import { useNavigate } from 'react-router'
import { FolderKanban } from 'lucide-react'
import { EmptyState, SectionHeading, StatusBadge, Table } from '../../components/ui'
import { CreateProjectButton } from '../../components/CreateProjectModal'
import { CreateProjectWizardButton } from '../../components/ProjectWizard'
import { useAuth } from '../../lib/auth'
import { deleteProject, listMyProjects } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

export function AdminProjects() {
  // The Main Admin creates ONE project and distributes it to departments; managers keep the simple form.
  const { profile } = useAuth()
  const Create = profile?.role === 'superadmin' ? CreateProjectWizardButton : CreateProjectButton
  const { data: projects, loading, reload } = useAsyncData('once', listMyProjects)
  const navigate = useNavigate()

  return (
    <div>
      <SectionHeading
        eyebrow="Operations"
        title="Projects"
        action={<Create onCreated={reload} />}
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
            action={<Create onCreated={reload} />}
          />
        }
        columns={[
          { key: 'name', header: 'Project', render: (p) => <strong>{p.name}</strong> },
          { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'due', header: 'Due', render: (p) => p.due_date ?? '—' },
          { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
          {
            key: 'actions',
            header: '',
            render: (p) => (
              <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                <DeleteButton what="project" name={p.name} label="" typeToConfirm={p.name} onDelete={() => deleteProject(p.id)} onDeleted={reload}>
                  <p>Everything inside it goes too: its tasks, updates, milestones, files and project chat, and its link to the client. Clients lose access to it immediately.</p>
                  <p>If the work is simply finished, set its status to completed instead.</p>
                </DeleteButton>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
