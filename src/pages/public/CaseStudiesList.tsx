import { Link } from 'react-router'
import { FileStack } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listCaseStudies } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './CaseStudies.css'

export function CaseStudiesList() {
  const { data: items, error, loading, reload } = useAsyncData('once', listCaseStudies)

  return (
    <PublicLayout>
      <main className="container ctf-case-studies">
        <SectionHeading eyebrow="Outcomes" title="Evidence of what we can build." />
        {error && <ErrorState onRetry={reload} />}
        {!error && loading && <SkeletonRows rows={3} height="120px" />}
        {!error && !loading && items !== null && items.length === 0 && (
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
