import { useParams } from 'react-router'
import { MapPin } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ButtonLink, ErrorState, SkeletonRows } from '../../components/ui'
import { getCareer } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './Careers.css'

export function CareerDetail() {
  const { slug } = useParams()
  const { data: role, error, loading } = useAsyncData(slug ?? '', () => getCareer(slug ?? ''))
  useDocumentTitle(role ? role.title : undefined)

  return (
    <PublicLayout>
      <main className="container ctf-career-detail">
        {error && <ErrorState />}
        {!error && loading && <SkeletonRows rows={3} height="80px" />}
        {!error && !loading && role === null && <ErrorState title="Role not found" description="This role isn't open, or the link has changed." />}
        {role && (
          <>
            <span className="eyebrow">{role.team}</span>
            <h1>{role.title}</h1>
            <span className="ctf-career-row__meta"><MapPin size={12} /> {role.location} · {role.employment_type.replace('_', ' ')}</span>
            <section><h2>About the role</h2><p>{role.description}</p></section>
            {role.requirements && <section><h2>What we're looking for</h2><p>{role.requirements}</p></section>}
            <ButtonLink to={`/careers/${role.slug}/apply`} variant="primary" size="lg">Apply for this role</ButtonLink>
          </>
        )}
      </main>
    </PublicLayout>
  )
}
