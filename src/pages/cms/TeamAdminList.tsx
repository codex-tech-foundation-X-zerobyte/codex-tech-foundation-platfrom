import { BulkBar, BulkDelete } from '../../components/BulkActions'
import { useSelection } from '../../hooks/useSelection'
import { DeleteButton } from '../../components/DeleteButton'
import { useState } from 'react'
import { Eye, EyeOff, Plus, Users } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { deleteTeamProfile, listAllTeamProfiles, setTeamProfileVisibility } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { TeamProfileModal } from './TeamProfileModal'

export function TeamAdminList() {
  const { data: profiles, error, loading, reload } = useAsyncData('once', listAllTeamProfiles)
  const sel = useSelection(profiles, (p) => p.id)
  const [editId, setEditId] = useState<string | null | 'new'>(null)
  const { push } = useToast()

  const toggleVisibility = async (id: string, current: boolean) => {
    const { error: err } = await setTeamProfileVisibility(id, !current)
    push(err ? 'Could not update visibility.' : current ? 'Hidden from public site' : 'Now visible on public site', err ? 'error' : 'success')
    reload()
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Team"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditId('new')}>Add team member</Button>}
      />
      {loading && <SkeletonRows rows={4} />}
      {!loading && profiles !== null && (
        <>
        <Table
          rows={profiles}
          rowKey={(p) => p.id}
          selection={{ selected: sel.selected, onChange: sel.onChange, label: (p) => p.display_name }}
          emptyState={<EmptyState icon={Users} title="No team profiles yet" description="Add a team member to show them on the public Team page." />}
          onRowClick={(p) => setEditId(p.id)}
          columns={[
            { key: 'name', header: 'Name', render: (p) => <strong>{p.display_name}</strong> },
            { key: 'title', header: 'Title', render: (p) => p.public_title || '—' },
            {
              key: 'visible',
              header: 'Public site',
              render: (p) => (
                <Button variant="ghost" size="sm" icon={p.is_public ? <Eye size={14} /> : <EyeOff size={14} />} onClick={(e) => { e.stopPropagation(); void toggleVisibility(p.id, p.is_public) }}>
                  {p.is_public ? 'Visible' : 'Hidden'}
                </Button>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (p) => (
                <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                  <DeleteButton what="team member" name={p.display_name} onDelete={() => deleteTeamProfile(p.id)} undo={{ table: 'team_profiles', id: p.id }} onDeleted={reload}>
                    <p>Only their public profile card is removed — this does not touch any workspace account. To just take them off the website, use Hidden instead.</p>
                  </DeleteButton>
                </div>
              ),
            },
          ]}
        />
        <BulkBar count={sel.count} onClear={sel.clear}>
          <BulkDelete table="team_profiles" ids={sel.ids} what="team member" plural="team members" onDone={() => { sel.clear(); reload() }} />
        </BulkBar>
        </>
      )}
      {editId && <TeamProfileModal id={editId === 'new' ? null : editId} onClose={() => setEditId(null)} onSaved={reload} />}
    </div>
  )
}
