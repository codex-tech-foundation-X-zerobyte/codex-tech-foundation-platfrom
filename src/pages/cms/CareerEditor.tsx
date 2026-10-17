import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button, ErrorState, FieldWrap, Input, Select, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createCareer, getCareerById, setCareerPublished, updateCareer } from '../../lib/services'
import type { Career } from '../../lib/types'
import '../cms/BlogEditor.css'

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
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [team, setTeam] = useState('')
  const [location, setLocation] = useState('')
  const [employmentType, setEmploymentType] = useState('full_time')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    void getCareerById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setTitle(data.title); setSlug(data.slug); setSlugTouched(true)
      setTeam(data.team); setLocation(data.location); setEmploymentType(data.employment_type)
      setDescription(data.description); setRequirements(data.requirements)
      setLoaded(true)
    })
  }, [id, isNew])

  const save = async (publish: boolean) => {
    setSaving(true)
    const draft = { title, slug: slug || slugify(title), team, location, employment_type: employmentType, description, requirements }
    let targetId = id
    const { error } = isNew
      ? await createCareer(draft).then((r) => { targetId = r.data?.id; return { error: r.error } })
      : await updateCareer(id!, draft)
    if (!error && publish && targetId) await setCareerPublished(targetId, true)
    setSaving(false)
    if (error) { push('Could not save this role.', 'error'); return }
    push(publish ? 'Published' : 'Saved')
    navigate(basePath)
  }

  if (!loaded) return <SkeletonRows rows={4} height="60px" />
  if (notFound) return <ErrorState title="Role not found" />

  return (
    <div className="ctf-blog-editor">
      <div className="ctf-blog-editor__head">
        <FieldWrap label="Title" htmlFor="ce-title" required>
          <Input id="ce-title" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)) }} />
        </FieldWrap>
        <FieldWrap label="Slug" htmlFor="ce-slug">
          <Input id="ce-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
        </FieldWrap>
      </div>
      <div className="ctf-blog-editor__head">
        <FieldWrap label="Team" htmlFor="ce-team">
          <Input id="ce-team" value={team} onChange={(e) => setTeam(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Location" htmlFor="ce-location">
          <Input id="ce-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </FieldWrap>
      </div>
      <FieldWrap label="Employment type" htmlFor="ce-type">
        <Select id="ce-type" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
        </Select>
      </FieldWrap>
      <FieldWrap label="Description" htmlFor="ce-description">
        <Textarea id="ce-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Requirements" htmlFor="ce-requirements">
        <Textarea id="ce-requirements" rows={5} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
      </FieldWrap>
      <div className="ctf-blog-editor__actions">
        <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
        <Button variant="secondary" loading={saving} disabled={!title.trim()} onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => save(true)}>
          {existing?.published_at ? 'Save & keep published' : 'Publish'}
        </Button>
      </div>
    </div>
  )
}
