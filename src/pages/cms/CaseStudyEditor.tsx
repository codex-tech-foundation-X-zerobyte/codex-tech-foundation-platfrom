import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createCaseStudy, getCaseStudyById, setCaseStudyFeatured, updateCaseStudy } from '../../lib/services'
import type { CaseStudy } from '../../lib/types'

function slugify(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

const emptyDraft = {
  slug: '', title: '', summary: '', problem: '', goals: '', approach: '', challenges: '', solution: '', results: '',
  technologies: '', seo_title: '', seo_description: '',
}

export function CaseStudyEditor({ basePath }: { basePath: string }) {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { push } = useToast()

  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)
  const [existing, setExisting] = useState<CaseStudy | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)

  const set = <K extends keyof typeof emptyDraft>(key: K, value: (typeof emptyDraft)[K]) => setDraft((d) => ({ ...d, [key]: value }))

  useEffect(() => {
    if (isNew) return
    void getCaseStudyById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setDraft({
        slug: data.slug, title: data.title, summary: data.summary, problem: data.problem, goals: data.goals,
        approach: data.approach, challenges: data.challenges, solution: data.solution, results: data.results,
        technologies: data.technologies.join(', '), seo_title: data.seo_title ?? '', seo_description: data.seo_description ?? '',
      })
      setSlugTouched(true)
      setLoaded(true)
    })
  }, [id, isNew])

  const save = async () => {
    setSaving(true)
    const payload = {
      slug: draft.slug || slugify(draft.title),
      title: draft.title,
      summary: draft.summary,
      problem: draft.problem,
      goals: draft.goals,
      approach: draft.approach,
      challenges: draft.challenges,
      solution: draft.solution,
      results: draft.results,
      technologies: draft.technologies.split(',').map((t) => t.trim()).filter(Boolean),
      seo_title: draft.seo_title || null,
      seo_description: draft.seo_description || null,
    }
    const { error } = isNew ? await createCaseStudy(payload) : await updateCaseStudy(id!, payload)
    setSaving(false)
    if (error) { push('Could not save this case study.', 'error'); return }
    push('Saved')
    navigate(basePath)
  }

  const toggleFeatured = async () => {
    if (!existing) return
    const { error } = await setCaseStudyFeatured(existing.id, !existing.featured)
    if (error) { push('Could not update featured status.', 'error'); return }
    setExisting({ ...existing, featured: !existing.featured })
    push(existing.featured ? 'Removed from featured' : 'Marked as featured')
  }

  if (!loaded) return <SkeletonRows rows={6} height="60px" />
  if (notFound) return <ErrorState title="Case study not found" />

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 780 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <FieldWrap label="Title" htmlFor="cs-title" required>
          <Input id="cs-title" value={draft.title} onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)) }} />
        </FieldWrap>
        <FieldWrap label="Slug" htmlFor="cs-slug" hint="Used in the case study URL">
          <Input id="cs-slug" value={draft.slug} onChange={(e) => { set('slug', e.target.value); setSlugTouched(true) }} />
        </FieldWrap>
      </div>
      <FieldWrap label="Summary" htmlFor="cs-summary" hint="Shown on the case studies list and as the social preview description">
        <Textarea id="cs-summary" rows={2} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Problem" htmlFor="cs-problem"><Textarea id="cs-problem" rows={3} value={draft.problem} onChange={(e) => set('problem', e.target.value)} /></FieldWrap>
      <FieldWrap label="Goals" htmlFor="cs-goals"><Textarea id="cs-goals" rows={2} value={draft.goals} onChange={(e) => set('goals', e.target.value)} /></FieldWrap>
      <FieldWrap label="Approach" htmlFor="cs-approach"><Textarea id="cs-approach" rows={3} value={draft.approach} onChange={(e) => set('approach', e.target.value)} /></FieldWrap>
      <FieldWrap label="Challenges" htmlFor="cs-challenges"><Textarea id="cs-challenges" rows={2} value={draft.challenges} onChange={(e) => set('challenges', e.target.value)} /></FieldWrap>
      <FieldWrap label="Solution" htmlFor="cs-solution"><Textarea id="cs-solution" rows={3} value={draft.solution} onChange={(e) => set('solution', e.target.value)} /></FieldWrap>
      <FieldWrap label="Results" htmlFor="cs-results" hint="Concrete, real outcomes only — never fabricate metrics"><Textarea id="cs-results" rows={3} value={draft.results} onChange={(e) => set('results', e.target.value)} /></FieldWrap>
      <FieldWrap label="Technologies" htmlFor="cs-tech" hint="Comma-separated">
        <Input id="cs-tech" value={draft.technologies} onChange={(e) => set('technologies', e.target.value)} placeholder="React, Supabase, TypeScript" />
      </FieldWrap>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <FieldWrap label="SEO title" htmlFor="cs-seo-title"><Input id="cs-seo-title" value={draft.seo_title} onChange={(e) => set('seo_title', e.target.value)} /></FieldWrap>
        <FieldWrap label="SEO description" htmlFor="cs-seo-desc"><Input id="cs-seo-desc" value={draft.seo_description} onChange={(e) => set('seo_description', e.target.value)} /></FieldWrap>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {existing && <Button variant="ghost" onClick={() => void toggleFeatured()}>{existing.featured ? 'Remove from featured' : 'Mark as featured'}</Button>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()} disabled={!draft.title.trim() || !draft.summary.trim()}>
            {existing ? 'Save changes' : 'Create case study'}
          </Button>
        </div>
      </div>
      <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>
        Cover image and gallery upload are not built yet — this pass covers the written content and publication workflow only. See ROADMAP.md.
      </p>
    </div>
  )
}
