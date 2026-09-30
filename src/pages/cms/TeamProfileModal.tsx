import { useEffect, useState } from 'react'
import { Button, FieldWrap, Input, Modal, Textarea, useToast } from '../../components/ui'
import { createTeamProfile, getTeamPhotoUrl, getTeamProfileById, updateTeamProfile, uploadTeamPhoto } from '../../lib/services'

export function TeamProfileModal({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const [displayName, setDisplayName] = useState('')
  const [publicTitle, setPublicTitle] = useState('')
  const [bio, setBio] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(!id)

  useEffect(() => {
    if (!id) return
    void getTeamProfileById(id).then(({ data }) => {
      if (data) {
        setDisplayName(data.display_name)
        setPublicTitle(data.public_title)
        setBio(data.bio)
        setPhotoPath(data.photo_path)
      }
      setLoaded(true)
    })
  }, [id])

  const submit = async () => {
    if (!displayName.trim()) return
    setSaving(true)
    const draft = { display_name: displayName.trim(), public_title: publicTitle.trim(), bio: bio.trim(), display_order: 0 }

    let targetId: string | null = null
    if (id) {
      const { error } = await updateTeamProfile(id, draft)
      targetId = error ? null : id
    } else {
      const { data } = await createTeamProfile(draft)
      targetId = data?.id ?? null
    }

    if (targetId && photoFile) {
      const { error: photoError } = await uploadTeamPhoto(targetId, photoFile)
      if (photoError) push('Saved, but the photo upload failed.', 'error')
    }
    setSaving(false)
    if (!targetId) { push('Could not save this profile.', 'error'); return }
    push('Saved')
    onSaved()
    onClose()
  }

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!photoFile) { setPreviewUrl(getTeamPhotoUrl(photoPath)); return }
    const objectUrl = URL.createObjectURL(photoFile)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [photoFile, photoPath])

  return (
    <Modal open onClose={onClose} title={id ? 'Edit team member' : 'Add team member'}>
      {!loaded ? null : (
        <>
          <FieldWrap label="Name" htmlFor="tp-name" required>
            <Input id="tp-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Title" htmlFor="tp-title" hint="e.g. Product Engineer">
            <Input id="tp-title" value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Bio" htmlFor="tp-bio">
            <Textarea id="tp-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Photo" htmlFor="tp-photo" hint="Shown on the public Team page.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {previewUrl && <img src={previewUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />}
              <input id="tp-photo" type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
            </div>
          </FieldWrap>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!displayName.trim()} onClick={submit}>Save</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
