import { useParams } from 'react-router'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ErrorState, SkeletonRows } from '../../components/ui'
import { getCaseStudy } from '../../lib/services'
import type { CaseStudy } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './CaseStudies.css'

const SECTIONS: Array<[keyof CaseStudy, string]> = [
  ['problem', 'The challenge'],
  ['approach', 'The approach'],
  ['solution', 'The build'],
  ['results', 'The outcome'],
]

export function CaseStudyDetail() {
  const { slug } = useParams()
  const { data: item, error, loading } = useAsyncData(slug ?? '', () => getCaseStudy(slug ?? ''))
  useDocumentTitle(item ? item.title : undefined)

  return (
    <PublicLayout>
      <main className="container ctf-case-study-detail">
        {error && <ErrorState />}
        {!error && loading && <SkeletonRows rows={3} height="100px" />}
        {!error && !loading && item === null && <ErrorState title="Case study not found" description="This case study isn't published, or the link has changed." />}
        {item && (
          <>
            <span className="eyebrow">Case study</span>
            <h1>{item.title}</h1>
            <p className="lead">{item.summary}</p>

            {SECTIONS.map(([key, label]) => {
              const body = item[key]
              if (!body || typeof body !== 'string') return null
              return (
                <section key={key}>
                  <h2>{label}</h2>
                  <p>{body}</p>
                </section>
              )
            })}

            {item.technologies.length > 0 && (
              <section>
                <h2>Technology</h2>
                <div className="ctf-case-study-row__tech">
                  {item.technologies.map((t) => <span key={t}>{t}</span>)}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </PublicLayout>
  )
}
