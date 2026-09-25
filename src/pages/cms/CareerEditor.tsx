import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createCareer, getCareerById, updateCareer } from '../../lib/services'
import type { Career } from '../../lib/types'

function slugify(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function CareerEditor({ basePath }: { basePath: string }) {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { push } = useToast()

  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)
  const [existing, setExisting] = useState<Career | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [team, setTeam] = useState('')
  const [location, setLocation] = useState('')
  const [employmentType, setEmploymentType] = useState('Full-time')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')

  useEffect(() => {
    if (isNew) return
    void getCareerById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setTitle(data.title); setSlug(data.slug); setTeam(data.team); setLocation(data.location)
      setEmploymentType(data.employment_type); setDescription(data.description); setRequirements(data.requirements)
      setSlugTouched(true)
      setLoaded(true)
    })
  }, [id, isNew])

  const save = async () => {
    setSaving(true)
    const draft = { title, slug: slug || slugify(title), team, location, employment_type: employmentType, description, requirements }
    const { error } = isNew ? await createCareer(draft) : await updateCareer(id!, draft)
    setSaving(false)
    if (error) { push('Could not save this position.', 'error'); return }
    push('Saved')
    navigate(basePath)
  }

  if (!loaded) return <SkeletonRows rows={5} height="60px" />
  if (notFound) return <ErrorState title="Position not found" />

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 780 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <FieldWrap label="Position title" htmlFor="cr-title" required>
          <Input id="cr-title" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)) }} />
        </FieldWrap>
        <FieldWrap label="Slug" htmlFor="cr-slug">
          <Input id="cr-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
        </FieldWrap>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <FieldWrap label="Team" htmlFor="cr-team"><Input id="cr-team" value={team} onChange={(e) => setTeam(e.target.value)} /></FieldWrap>
        <FieldWrap label="Location" htmlFor="cr-location"><Input id="cr-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote" /></FieldWrap>
        <FieldWrap label="Employment type" htmlFor="cr-type"><Input id="cr-type" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} /></FieldWrap>
      </div>
      <FieldWrap label="Description" htmlFor="cr-description">
        <Textarea id="cr-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Requirements" htmlFor="cr-requirements">
        <Textarea id="cr-requirements" rows={5} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
      </FieldWrap>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()} disabled={!title.trim()}>
          {existing ? 'Save changes' : 'Create position'}
        </Button>
      </div>
    </div>
  )
}
