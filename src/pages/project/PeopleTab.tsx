import { useState } from 'react'
import { UserMinus, UserPlus } from 'lucide-react'
import { Avatar, Badge, Button, EmptyState, ErrorState, Select, SkeletonRows, useToast } from '../../components/ui'
import { addProjectMember, listInvitablePeople, listProjectPeople, removeProjectMember } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'

/** Who is on a personal project, and the invitations to extend. Collaborators can see and edit it; they cannot hand it on or delete it. */
export function PeopleTab({ projectId, ownerId }: { projectId: string; ownerId: string | null }) {
  const people = useAsyncData(`project-people:${projectId}`, () => listProjectPeople(projectId))
  const invitable = useAsyncData('invitable-people', listInvitablePeople)
  const { profile } = useAuth()
  const { push } = useToast()
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const canInvite = profile?.id === ownerId || profile?.role === 'superadmin'

  if (people.loading) return <SkeletonRows rows={3} height="48px" />
  if (people.error) return <ErrorState title="People couldn't load" description={people.errorDetail?.message ?? 'Try again.'} onRetry={people.reload} />
  const list = people.data ?? []
  const options = (invitable.data ?? []).filter((p) => !list.some((x) => x.user_id === p.id))

  const invite = async () => {
    if (!pick) return
    setBusy(true)
    const { error } = await addProjectMember(projectId, pick)
    setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push('Invited. They can now see this project.'); setPick(''); people.reload()
  }
  const remove = async (userId: string, name: string) => {
    const { error } = await removeProjectMember(projectId, userId)
    if (error) push(error.message, 'error'); else { push(`${name} removed.`); people.reload() }
  }

  return (
    <div className="ctf-people">
      {canInvite && (
        <div className="ctf-people__invite">
          <Select aria-label="Invite a teammate" value={pick} onChange={(e) => setPick(e.target.value)} disabled={invitable.loading || busy}>
            <option value="">Invite a teammate…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => void invite()} loading={busy} disabled={!pick}>Invite</Button>
        </div>
      )}
      {list.length === 0 ? <EmptyState title="Only you so far" description="Invite a teammate to share this project with them." /> : (
        <ul className="ctf-people__list">
          {list.map((p) => (
            <li key={p.user_id}>
              <Avatar name={p.display_name} size={32} />
              <strong>{p.display_name}</strong>
              {p.isOwner ? <Badge tone="accent">Owner</Badge> : <Badge tone="neutral">Collaborator</Badge>}
              {canInvite && !p.isOwner && <button type="button" className="ctf-people__remove" onClick={() => void remove(p.user_id, p.display_name)} aria-label={`Remove ${p.display_name}`}><UserMinus size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
      <p className="ctf-people__note">Main Admins oversee the whole Workspace, so they can always see personal projects. Nobody else can, unless you invite them.</p>
    </div>
  )
}
