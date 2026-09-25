import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileStack } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listCaseStudies } from '../../lib/services'
import type { CaseStudy } from '../../lib/types'
import './CaseStudies.css'

export function CaseStudiesList() {
  const [items, setItems] = useState<CaseStudy[] | null>(null)
  const [error, setError] = useState(false)

  const load = () => {
    setError(false)
    setItems(null)
    void listCaseStudies().then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
  }
  useEffect(load, [])

  return (
    <PublicLayout>
      <main className="container ctf-case-studies">
        <SectionHeading eyebrow="Outcomes" title="Evidence of what we can build." />
        {error && <ErrorState onRetry={load} />}
        {!error && items === null && <SkeletonRows rows={3} height="120px" />}
        {!error && items !== null && items.length === 0 && (
          <EmptyState icon={FileStack} title="No case studies published yet" description="Published case studies will appear here." />
        )}
        <div className="ctf-case-study-list">
          {items?.map((cs) => (
            <Link to={`/case-studies/${cs.slug}`} className="ctf-case-study-row" key={cs.id}>
              <div>
                <span className="eyebrow muted">Case study</span>
                <h2>{cs.title}</h2>
                <p>{cs.summary}</p>
              </div>
              <div className="ctf-case-study-row__tech">
                {cs.technologies.slice(0, 4).map((t) => <span key={t}>{t}</span>)}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </PublicLayout>
  )
}
