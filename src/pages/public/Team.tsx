import { useEffect, useState } from 'react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Avatar, EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listPublicTeam } from '../../lib/services'
import type { TeamProfile } from '../../lib/types'
import { Users } from 'lucide-react'
import './Team.css'

export function Team() {
  const [team, setTeam] = useState<TeamProfile[] | null>(null)
  const [error, setError] = useState(false)

  const load = () => {
    setError(false)
    setTeam(null)
    void listPublicTeam().then(({ data, error: err }) => (err ? setError(true) : setTeam(data)))
  }
  useEffect(load, [])

  return (
    <PublicLayout>
      <main className="container ctf-team-page">
        <SectionHeading eyebrow="Team" title="The people behind the work." description="A small team of strategists, builders, and operators." />
        {error && <ErrorState onRetry={load} />}
        {!error && team === null && <SkeletonRows rows={2} height="140px" />}
        {!error && team !== null && team.length === 0 && (
          <EmptyState icon={Users} title="Team profiles coming soon" description="Public team profiles will appear here once published." />
        )}
        <div className="ctf-team-grid">
          {team?.map((member) => (
            <div className="ctf-team-card" key={member.id}>
              <Avatar name={member.display_name} size={56} />
              <h3>{member.display_name}</h3>
              <span>{member.public_title}</span>
              {member.bio && <p>{member.bio}</p>}
              {member.skills.length > 0 && (
                <div className="ctf-team-card__skills">
                  {member.skills.slice(0, 4).map((s) => <span key={s}>{s}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </PublicLayout>
  )
}
