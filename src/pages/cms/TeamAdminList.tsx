import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, UsersRound } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { deleteTeamProfile, listAllTeamProfiles, setTeamProfileVisibility } from '../../lib/services'
import { storage } from '../../lib/services/shared'
import type { TeamProfile } from '../../lib/types'

export function TeamAdminList({ basePath }: { basePath: string }) {
  const [items, setItems] = useState<TeamProfile[] | null>(null)
  const [error, setError] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listAllTeamProfiles().then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
  }
  useEffect(load, [])

  const toggleVisible = async (p: TeamProfile) => {
    const { error: err } = await setTeamProfileVisibility(p.id, !p.is_public)
    push(err ? 'Could not update visibility.' : p.is_public ? 'Hidden from the public site' : 'Now visible on the public site', err ? 'error' : 'success')
    load()
  }

  const remove = async (p: TeamProfile) => {
    if (!window.confirm(`Remove ${p.display_name} from the team page?`)) return
    const { error: err } = await deleteTeamProfile(p.id)
    push(err ? 'Could not remove this profile.' : 'Removed', err ? 'error' : 'success')
    load()
  }

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Team"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>Add profile</Button>}
      />
      {items === null && <SkeletonRows rows={4} />}
      {items !== null && (
        <Table
          rows={items}
          rowKey={(p) => p.id}
          emptyState={<EmptyState icon={UsersRound} title="No team profiles yet" description="Add your team members to populate the public Team page." />}
          onRowClick={(p) => navigate(`${basePath}/${p.id}`)}
          columns={[
            {
              key: 'photo',
              header: '',
              render: (p) => (
                <div className="ctf-avatar">
                  {p.photo_path ? <img src={storage.getPublicUrl('public-content', p.photo_path)} alt="" /> : <UsersRound size={16} />}
                </div>
              ),
            },
            { key: 'name', header: 'Name', render: (p) => <strong>{p.display_name}</strong> },
            { key: 'title', header: 'Title', render: (p) => p.public_title || '—' },
            { key: 'order', header: 'Order', render: (p) => p.display_order },
            { key: 'visible', header: 'Visibility', render: (p) => <Badge tone={p.is_public ? 'success' : 'neutral'}>{p.is_public ? 'public' : 'hidden'}</Badge> },
            {
              key: 'actions',
              header: 'Actions',
              render: (p) => (
                <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => void toggleVisible(p)}>{p.is_public ? 'Hide' : 'Publish'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(p)}>Remove</Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
