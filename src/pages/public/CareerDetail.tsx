import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Button, ErrorState, SkeletonRows } from '../../components/ui'
import { getCareer } from '../../lib/services'
import type { Career } from '../../lib/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './Careers.css'

export function CareerDetail() {
  const { slug } = useParams()
  const [role, setRole] = useState<Career | null | undefined>(undefined)
  const [error, setError] = useState(false)
  useDocumentTitle(role ? role.title : undefined)

  useEffect(() => {
    if (!slug) return
    setError(false)
    setRole(undefined)
    void getCareer(slug).then(({ data, error: err }) => (err ? setError(true) : setRole(data)))
  }, [slug])

  return (
    <PublicLayout>
      <main className="container ctf-career-detail">
        {error && <ErrorState />}
        {!error && role === undefined && <SkeletonRows rows={3} height="80px" />}
        {!error && role === null && <ErrorState title="Role not found" description="This role isn't open, or the link has changed." />}
        {role && (
          <>
            <span className="eyebrow">{role.team}</span>
            <h1>{role.title}</h1>
            <span className="ctf-career-row__meta"><MapPin size={12} /> {role.location} · {role.employment_type.replace('_', ' ')}</span>
            <section><h2>About the role</h2><p>{role.description}</p></section>
            {role.requirements && <section><h2>What we're looking for</h2><p>{role.requirements}</p></section>}
            <Link to={`/careers/${role.slug}/apply`}>
              <Button variant="primary" size="lg">Apply for this role</Button>
            </Link>
          </>
        )}
      </main>
    </PublicLayout>
  )
}
