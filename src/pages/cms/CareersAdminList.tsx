import { BulkBar, BulkDelete } from '../../components/BulkActions'
import { useSelection } from '../../hooks/useSelection'
import { DeleteButton } from '../../components/DeleteButton'
import { useNavigate } from 'react-router'
import { Briefcase, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { archiveCareer, deleteCareer, listAllCareers, listApplications, setCareerPublished } from '../../lib/services'
import type { Career } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'

function statusOf(c: Career): { label: string; tone: 'neutral' | 'success' } {
  if (c.archived_at) return { label: 'archived', tone: 'neutral' }
  if (c.published_at) return { label: 'published', tone: 'success' }
  return { label: 'draft', tone: 'neutral' }
}

async function loadRolesWithCounts() {
  const [careers, apps] = await Promise.all([listAllCareers(), listApplications()])
  const counts: Record<string, number> = {}
  for (const a of apps.data) counts[a.career_id] = (counts[a.career_id] ?? 0) + 1
  return { data: { roles: careers.data, counts }, error: careers.error }
}

export function CareersAdminList({ basePath }: { basePath: string }) {
  const { data, error, loading, reload } = useAsyncData('once', loadRolesWithCounts)
  const roles = data?.roles ?? null
  const sel = useSelection(roles, (c) => c.id)
  const navigate = useNavigate()
  const { push } = useToast()

  const togglePublish = async (c: Career) => {
    const { error: err } = await setCareerPublished(c.id, !c.published_at)
    push(err ? 'Could not update publish status.' : c.published_at ? 'Unpublished' : 'Published', err ? 'error' : 'success')
    reload()
  }
  const archive = async (c: Career) => {
    const { error: err } = await archiveCareer(c.id)
    push(err ? 'Could not archive that role.' : 'Role archived', err ? 'error' : 'success')
    reload()
  }

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
        <>
        <Table
          rows={roles}
          rowKey={(c) => c.id}
          selection={{ selected: sel.selected, onChange: sel.onChange, label: (c) => c.title }}
          emptyState={<EmptyState icon={Briefcase} title="No roles yet" description="Post your first open role." />}
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          columns={[
            { key: 'title', header: 'Role', render: (c) => <strong>{c.title}</strong> },
            { key: 'team', header: 'Team', render: (c) => c.team || '—' },
            { key: 'status', header: 'Status', render: (c) => { const s = statusOf(c); return <Badge tone={s.tone}>{s.label}</Badge> } },
            { key: 'apps', header: 'Applications', render: (c) => data?.counts[c.id] ?? 0 },
            {
              key: 'actions',
              header: 'Actions',
              render: (c) => {
                const n = data?.counts[c.id] ?? 0
                return (
                  <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => void togglePublish(c)}>{c.published_at ? 'Unpublish' : 'Publish'}</Button>
                    {!c.archived_at && <Button variant="ghost" size="sm" onClick={() => void archive(c)}>Archive</Button>}
                    <DeleteButton what="role" name={c.title} onDelete={() => deleteCareer(c.id)} undo={{ table: 'careers', id: c.id }} onDeleted={reload}>
                      {n > 0
                        ? <p><strong>Its {n} application{n === 1 ? '' : 's'}, including uploaded résumés, will be deleted with it.</strong> Archive the role instead if you may need them.</p>
                        : <p>No one has applied to it yet.</p>}
                    </DeleteButton>
                  </div>
                )
              },
            },
          ]}
        />
        <BulkBar count={sel.count} onClear={sel.clear}>
          <BulkDelete table="careers" ids={sel.ids} what="role" onDone={() => { sel.clear(); reload() }}>
            {sel.ids.reduce((n, id) => n + (data?.counts[id] ?? 0), 0) > 0 && <p><strong>Their {sel.ids.reduce((n, id) => n + (data?.counts[id] ?? 0), 0)} applications go with them.</strong> Archive roles instead if you may need those.</p>}
          </BulkDelete>
        </BulkBar>
        </>
      )}
    </div>
  )
}
