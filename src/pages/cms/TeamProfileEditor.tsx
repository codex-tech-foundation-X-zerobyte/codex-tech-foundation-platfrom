import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Upload, UsersRound } from 'lucide-react'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createTeamProfile, getTeamProfileById, updateTeamProfile, uploadTeamPhoto } from '../../lib/services'
import { storage } from '../../lib/services/shared'
import type { TeamProfile } from '../../lib/types'

export function TeamProfileEditor({ basePath }: { basePath: string }) {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { push } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)
  const [existing, setExisting] = useState<TeamProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [publicTitle, setPublicTitle] = useState('')
  const [bio, setBio] = useState('')
  const [skills, setSkills] = useState('')
  const [displayOrder, setDisplayOrder] = useState(0)

  useEffect(() => {
    if (isNew) return
    void getTeamProfileById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setDisplayName(data.display_name); setPublicTitle(data.public_title); setBio(data.bio)
      setSkills(data.skills.join(', ')); setDisplayOrder(data.display_order)
      setLoaded(true)
    })
  }, [id, isNew])

  const save = async () => {
    setSaving(true)
    const draft = {
      display_name: displayName,
      public_title: publicTitle,
      bio,
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      display_order: displayOrder,
    }
    if (isNew) {
      const { data, error } = await createTeamProfile(draft)
      setSaving(false)
      if (error || !data) { push('Could not save this profile.', 'error'); return }
      push('Saved')
      navigate(`${basePath}/${data.id}`)
      return
    }
    const { error } = await updateTeamProfile(id!, draft)
    setSaving(false)
    if (error) { push('Could not save this profile.', 'error'); return }
    push('Saved')
    navigate(basePath)
  }

  const handlePhoto = async (file: File) => {
    if (!existing) {
      push('Save the profile first, then add a photo.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) { push('Photo must be under 5MB.', 'error'); return }
    if (!file.type.startsWith('image/')) { push('Please choose an image file.', 'error'); return }
    setUploading(true)
    const { error } = await uploadTeamPhoto(existing.id, file)
    setUploading(false)
    if (error) { push('Could not upload the photo.', 'error'); return }
    const { data } = await getTeamProfileById(existing.id)
    if (data) setExisting(data)
    push('Photo updated')
  }

  if (!loaded) return <SkeletonRows rows={4} height="60px" />
  if (notFound) return <ErrorState title="Profile not found" />

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      {!isNew && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="ctf-avatar ctf-avatar--lg">
            {existing?.photo_path ? <img src={storage.getPublicUrl('public-content', existing.photo_path)} alt="" /> : <UsersRound size={28} />}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f) }} />
            <Button variant="secondary" size="sm" icon={<Upload size={14} />} loading={uploading} onClick={() => fileRef.current?.click()}>
              Upload photo
            </Button>
          </div>
        </div>
      )}
      <FieldWrap label="Name" htmlFor="tp-name" required>
        <Input id="tp-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Title" htmlFor="tp-title">
        <Input id="tp-title" value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} placeholder="e.g. Lead Engineer" />
      </FieldWrap>
      <FieldWrap label="Bio" htmlFor="tp-bio">
        <Textarea id="tp-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Skills" htmlFor="tp-skills" hint="Comma-separated">
        <Input id="tp-skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, Systems design, Mentorship" />
      </FieldWrap>
      <FieldWrap label="Display order" htmlFor="tp-order" hint="Lower numbers appear first">
        <Input id="tp-order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))} />
      </FieldWrap>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()} disabled={!displayName.trim()}>
          {existing ? 'Save changes' : 'Create profile'}
        </Button>
      </div>
      {isNew && <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>Save the profile first, then you can upload a photo.</p>}
    </div>
  )
}
