import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, MapPin } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listCareers } from '../../lib/services'
import type { Career } from '../../lib/types'
import './Careers.css'

export function CareersList() {
  const [roles, setRoles] = useState<Career[] | null>(null)
  const [error, setError] = useState(false)

  const load = () => {
    setError(false)
    setRoles(null)
    void listCareers().then(({ data, error: err }) => (err ? setError(true) : setRoles(data)))
  }
  useEffect(load, [])

  return (
    <PublicLayout>
      <main className="container ctf-careers">
        <SectionHeading eyebrow="Careers" title="Build the systems you wish existed." />
        {error && <ErrorState onRetry={load} />}
        {!error && roles === null && <SkeletonRows rows={3} height="80px" />}
        {!error && roles !== null && roles.length === 0 && (
          <EmptyState icon={Briefcase} title="No open roles right now" description="Check back soon, or send a general introduction through Contact." />
        )}
        <div className="ctf-career-list">
          {roles?.map((role) => (
            <Link to={`/careers/${role.slug}`} className="ctf-career-row" key={role.id}>
              <div>
                <h3>{role.title}</h3>
                <span className="ctf-career-row__meta">{role.team} · <MapPin size={12} /> {role.location} · {role.employment_type.replace('_', ' ')}</span>
              </div>
              <span className="text-link">View role →</span>
            </Link>
          ))}
        </div>
      </main>
    </PublicLayout>
  )
}
