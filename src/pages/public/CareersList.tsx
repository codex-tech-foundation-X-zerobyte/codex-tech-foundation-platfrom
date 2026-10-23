import { Link } from 'react-router'
import { Briefcase, MapPin } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listCareers } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './Careers.css'

export function CareersList() {
  const { data: roles, error, loading, reload } = useAsyncData('once', listCareers)

  return (
    <PublicLayout>
      <main className="container ctf-careers">
        <SectionHeading eyebrow="Careers" title="Build the systems you wish existed." />
        {error && <ErrorState onRetry={reload} />}
        {!error && loading && <SkeletonRows rows={3} height="80px" />}
        {!error && !loading && roles !== null && roles.length === 0 && (
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
