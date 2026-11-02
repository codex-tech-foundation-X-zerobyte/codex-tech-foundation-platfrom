import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createCaseStudy, getCaseStudyById, setCaseStudyPublicationStatus, updateCaseStudy } from '../../lib/services'
import type { CaseStudy } from '../../lib/types'
import '../cms/BlogEditor.css'

function slugify(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

const SECTIONS: Array<[keyof Pick<CaseStudy, 'problem' | 'approach' | 'solution' | 'results'>, string, string]> = [
  ['problem', 'The challenge', 'What problem was the client facing?'],
  ['approach', 'The approach', 'How did the team approach it?'],
  ['solution', 'The build', 'What was actually built?'],
  ['results', 'The outcome', 'What changed as a result?'],
]

export function CaseStudyEditor({ basePath }: { basePath: string }) {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { push } = useToast()

  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)
  const [existing, setExisting] = useState<CaseStudy | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [summary, setSummary] = useState('')
  const [sections, setSections] = useState({ problem: '', approach: '', solution: '', results: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    void getCaseStudyById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setTitle(data.title)
      setSlug(data.slug)
      setSlugTouched(true)
      setSummary(data.summary)
      setSections({ problem: data.problem, approach: data.approach, solution: data.solution, results: data.results })
      setLoaded(true)
    })
  }, [id, isNew])

  const save = async (publish: boolean) => {
    setSaving(true)
    const draft = { title, slug: slug || slugify(title), summary, ...sections }
    let targetId = id
    const { error } = isNew
      ? await createCaseStudy(draft).then((r) => { targetId = r.data?.id; return { error: r.error } })
      : await updateCaseStudy(id!, draft)
    if (!error && publish && targetId) {
      await setCaseStudyPublicationStatus(targetId, 'published')
    }
    setSaving(false)
    if (error) { push('Could not save this case study.', 'error'); return }
    push(publish ? 'Published' : 'Saved')
    navigate(basePath)
  }

  if (!loaded) return <SkeletonRows rows={4} height="60px" />
  if (notFound) return <ErrorState title="Case study not found" />

  return (
    <div className="ctf-blog-editor">
      <div className="ctf-blog-editor__head">
        <FieldWrap label="Title" htmlFor="cs-title" required>
          <Input id="cs-title" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)) }} />
        </FieldWrap>
        <FieldWrap label="Slug" htmlFor="cs-slug">
          <Input id="cs-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
        </FieldWrap>
      </div>
      <FieldWrap label="Summary" htmlFor="cs-summary" hint="Shown on the case studies list">
        <Textarea id="cs-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </FieldWrap>
      {SECTIONS.map(([key, label, hint]) => (
        <FieldWrap key={key} label={label} htmlFor={`cs-${key}`} hint={hint}>
          <Textarea id={`cs-${key}`} rows={4} value={sections[key]} onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.value }))} />
        </FieldWrap>
      ))}
      <div className="ctf-blog-editor__actions">
        <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
        <Button variant="secondary" loading={saving} disabled={!title.trim()} onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => save(true)}>
          {existing?.publication_status === 'published' ? 'Save & keep published' : 'Publish'}
        </Button>
      </div>
    </div>
  )
}
