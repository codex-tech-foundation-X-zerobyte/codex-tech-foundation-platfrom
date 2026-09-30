import { PublicLayout } from '../../layouts/PublicLayout'
import { Avatar, ButtonLink, EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { getTeamPhotoUrl, listPublicTeam } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Users } from 'lucide-react'
import './Team.css'

export function Team() {
  const { data: team, error, loading, reload } = useAsyncData('once', listPublicTeam)

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
                {member.bio && <p>{member.bio}</p>}
                {member.skills.length > 0 && (
                  <div className="ctf-team-card__skills">
                    {member.skills.slice(0, 4).map((s) => <span key={s}>{s}</span>)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </PublicLayout>
  )
}
