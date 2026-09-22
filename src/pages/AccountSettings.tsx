import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, User } from 'lucide-react'
import { Badge, Button, FieldWrap, Input, SectionHeading, SkeletonRows, useToast } from '../components/ui'
import { changePassword, getMyClient, getMyWorkerProfile, getOwnEmail, updateOwnProfile } from '../lib/services'
import { useAuth } from '../lib/auth'
import type { Client, WorkerProfile } from '../lib/types'

export function AccountSettings() {
  const { profile, refresh } = useAuth()
  const { push } = useToast()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [email, setEmail] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [workerInfo, setWorkerInfo] = useState<WorkerProfile | null>(null)
  const [clientInfo, setClientInfo] = useState<Client | null>(null)
  const [roleInfoLoaded, setRoleInfoLoaded] = useState(false)

  useEffect(() => {
    void getOwnEmail().then(setEmail)
    if (profile?.role === 'worker' || profile?.role === 'manager') {
      void getMyWorkerProfile().then(({ data }) => { setWorkerInfo(data); setRoleInfoLoaded(true) })
    } else if (profile?.role === 'client') {
      void getMyClient().then(({ data }) => { setClientInfo(data); setRoleInfoLoaded(true) })
    } else {
      setRoleInfoLoaded(true)
    }
  }, [profile?.role])

  useEffect(() => { setDisplayName(profile?.display_name ?? '') }, [profile?.display_name])

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    setSavingName(true)
    const { error } = await updateOwnProfile({ display_name: displayName.trim() })
    setSavingName(false)
    if (error) { push('Could not save your name.', 'error'); return }
    await refresh()
    push('Saved.')
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordError('')
    if (newPassword.length < 8) { setPasswordError('New password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword) { setPasswordError('New passwords do not match.'); return }
    setSavingPassword(true)
    const { error } = await changePassword(newPassword)
    setSavingPassword(false)
    if (error) { setPasswordError(error.message); return }
    push('Password updated.')
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
  }

  return (
    <div style={{ display: 'grid', gap: 32, maxWidth: 560 }}>
      <section>
        <SectionHeading eyebrow="Account" title="Profile" />
        <form onSubmit={saveName} style={{ display: 'grid', gap: 12 }}>
          <FieldWrap label="Email" htmlFor="acct-email" hint="Contact an administrator to change your email">
            <Input id="acct-email" value={email ?? ''} disabled />
          </FieldWrap>
          <FieldWrap label="Display name" htmlFor="acct-name" required>
            <Input id="acct-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FieldWrap>
          <div>
            <Button type="submit" variant="primary" loading={savingName} icon={<User size={15} />}>Save name</Button>
          </div>
        </form>
      </section>

      <section>
        <SectionHeading eyebrow="Security" title="Change password" />
        <form onSubmit={savePassword} style={{ display: 'grid', gap: 12 }}>
          <FieldWrap label="Current password" htmlFor="acct-current-pw" hint="Not verified separately — you're already signed in">
            <Input id="acct-current-pw" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="New password" htmlFor="acct-new-pw" required>
            <Input id="acct-new-pw" type="password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Confirm new password" htmlFor="acct-confirm-pw" required>
            <Input id="acct-confirm-pw" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </FieldWrap>
          {passwordError && <p className="ctf-form-error">{passwordError}</p>}
          <div>
            <Button type="submit" variant="secondary" loading={savingPassword} icon={<KeyRound size={15} />}>Update password</Button>
          </div>
        </form>
      </section>

      <section>
        <SectionHeading eyebrow="Account details" title="Role information" />
        {!roleInfoLoaded && <SkeletonRows rows={2} />}
        {roleInfoLoaded && (
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            <div><strong>Role:</strong> <Badge tone="neutral">{profile?.role}</Badge></div>
            {workerInfo && (
              <>
                <div><strong>Worker ID:</strong> {workerInfo.worker_id}</div>
                {workerInfo.position && <div><strong>Position:</strong> {workerInfo.position}</div>}
                <div><strong>Status:</strong> <Badge tone={workerInfo.status === 'active' ? 'success' : 'danger'}>{workerInfo.status}</Badge></div>
              </>
            )}
            {clientInfo && (
              <>
                <div><strong>Organization:</strong> {clientInfo.organization}</div>
                {clientInfo.client_code && <div><strong>Client ID:</strong> {clientInfo.client_code}</div>}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
