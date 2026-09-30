import { useState, type FormEvent } from 'react'
import { KeyRound, User } from 'lucide-react'
import { Button, FieldWrap, Input, SectionHeading, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { changePassword, updateOwnProfile } from '../lib/services'
import './AccountSettings.css'

export function AccountSettings() {
  const { profile, refresh } = useAuth()
  const { push } = useToast()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) return
    setSavingProfile(true)
    const { error } = await updateOwnProfile({ display_name: displayName.trim() })
    setSavingProfile(false)
    if (error) { push('Could not save your profile.', 'error'); return }
    push('Profile saved')
    void refresh()
  }

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    if (newPassword.length < 10) { setPasswordError('Password must be at least 10 characters.'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match.'); return }
    setChangingPassword(true)
    const { error } = await changePassword(newPassword)
    setChangingPassword(false)
    if (error) { setPasswordError(error.message); return }
    push('Password changed')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="ctf-settings">
      <SectionHeading eyebrow="Account" title="Settings" />

      <section className="ctf-settings__section">
        <h2><User size={16} /> Profile</h2>
        <form onSubmit={saveProfile}>
          <FieldWrap label="Display name" htmlFor="settings-name" required>
            <Input id="settings-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Role" htmlFor="settings-role" hint="Set by an administrator — not self-editable.">
            <Input id="settings-role" value={profile?.role ?? ''} disabled />
          </FieldWrap>
          <Button type="submit" variant="primary" loading={savingProfile} disabled={!displayName.trim()}>Save profile</Button>
        </form>
      </section>

      <section className="ctf-settings__section">
        <h2><KeyRound size={16} /> Password</h2>
        <form onSubmit={submitPassword}>
          <FieldWrap label="New password" htmlFor="settings-new-password" required hint="At least 10 characters.">
            <Input id="settings-new-password" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Confirm password" htmlFor="settings-confirm-password" required>
            <Input id="settings-confirm-password" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </FieldWrap>
          {passwordError && <p className="ctf-form-error">{passwordError}</p>}
          <Button type="submit" variant="primary" loading={changingPassword} disabled={!newPassword || !confirmPassword}>Change password</Button>
        </form>
      </section>
    </div>
  )
}
