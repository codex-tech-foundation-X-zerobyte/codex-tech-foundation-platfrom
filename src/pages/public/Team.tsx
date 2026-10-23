import { useState } from 'react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Avatar, ButtonLink, EmptyState, ErrorState, Modal, SectionHeading, SkeletonRows } from '../../components/ui'
import { getTeamPhotoUrl, listPublicTeam } from '../../lib/services'
import { isLongText } from '../../lib/format'
import type { TeamProfile } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Users } from 'lucide-react'
import './Team.css'

const SKILLS_ON_CARD = 4
const BIO_ON_CARD = 150

export function Team() {
  const { data: team, error, loading, reload } = useAsyncData('once', listPublicTeam)
  const [openId, setOpenId] = useState<string | null>(null)
  const opened = team?.find((m) => m.id === openId) ?? null

  return (
    <PublicLayout>
      <main className="container ctf-team-page">
        <SectionHeading eyebrow="Team" title="The people behind the work." description="A small team of strategists, builders, and operators." />
        {error && <ErrorState onRetry={reload} />}
        {!error && loading && <SkeletonRows rows={2} height="140px" />}
        {!error && !loading && team !== null && team.length === 0 && (
          <EmptyState
            icon={Users}
            title="No public profiles yet"
            description="Team members show up here as soon as their profile is published. In the meantime you can tell us what you're building, or see where we're hiring."
            action={
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <ButtonLink to="/start-project" variant="primary">Start a project</ButtonLink>
                <ButtonLink to="/careers" variant="secondary">See open roles</ButtonLink>
              </div>
            }
          />
        )}
        <div className="ctf-team-grid">
          {team?.map((member) => {
            const photoUrl = getTeamPhotoUrl(member.photo_path)
            return (
              <div className="ctf-team-card" key={member.id}>
                {photoUrl ? (
                  <img src={photoUrl} alt={member.display_name} className="ctf-team-card__photo" />
                ) : (
                  <Avatar name={member.display_name} size={56} />
                )}
                <h3>{member.display_name}</h3>
                <span>{member.public_title}</span>
                {member.bio && <p className="ctf-team-card__bio">{member.bio}</p>}
                {member.skills.length > 0 && (
                  <div className="ctf-team-card__skills">
                    {member.skills.slice(0, SKILLS_ON_CARD).map((s) => <span key={s}>{s}</span>)}
                    {member.skills.length > SKILLS_ON_CARD && <span>+{member.skills.length - SKILLS_ON_CARD}</span>}
                  </div>
                )}
                {(isLongText(member.bio, BIO_ON_CARD) || member.skills.length > SKILLS_ON_CARD) && (
                  <button type="button" className="ctf-team-card__more" onClick={() => setOpenId(member.id)} aria-haspopup="dialog">
                    Read more<span className="sr-only"> about {member.display_name}</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </main>
      {opened && <TeamMemberModal member={opened} onClose={() => setOpenId(null)} />}
    </PublicLayout>
  )
}

function TeamMemberModal({ member, onClose }: { member: TeamProfile; onClose: () => void }) {
  const photoUrl = getTeamPhotoUrl(member.photo_path)
  return (
    <Modal open onClose={onClose} title={member.display_name} description={member.public_title || undefined} size="md">
      <div className="ctf-team-modal">
        {photoUrl ? <img src={photoUrl} alt={member.display_name} className="ctf-team-modal__photo" /> : <Avatar name={member.display_name} size={72} />}
        {member.bio && <p className="ctf-team-modal__bio">{member.bio}</p>}
        {member.skills.length > 0 && (
          <div className="ctf-team-card__skills">{member.skills.map((s) => <span key={s}>{s}</span>)}</div>
        )}
      </div>
    </Modal>
  )
}
