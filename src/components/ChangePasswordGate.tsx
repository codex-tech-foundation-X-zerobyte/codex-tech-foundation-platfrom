import { useState, type FormEvent, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button, FieldWrap, Input, SkeletonRows } from '../components/ui'
import { useAuth } from '../lib/auth'
import { changePassword, getMustChangePassword } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import './ChangePasswordGate.css'

export function ChangePasswordGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { data: mustChange, loading } = useAsyncData(
    profile?.id ?? '',
    async () => ({ data: profile ? await getMustChangePassword(profile.id, profile.role) : false, error: null }),
  )
  const [done, setDone] = useState(false)

  if (!profile || loading) return <div style={{ padding: 32 }}><SkeletonRows rows={2} /></div>
  if (!mustChange || done) return <>{children}</>

  return (
    <div className="ctf-password-gate">
      <div className="ctf-password-gate__card">
        <ShieldAlert size={20} />
        <h1>Set a new password</h1>
        <p>Your account was created with a temporary password. Choose a new one to continue.</p>
        <ChangePasswordForm onSuccess={() => setDone(true)} />
      </div>
    </div>
  )
}

function ChangePasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const { error: err } = await changePassword(password)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onSuccess()
  }

  return (
    <form onSubmit={submit}>
      <FieldWrap label="New password" htmlFor="new-password" required hint="At least 10 characters.">
        <Input id="new-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Confirm password" htmlFor="confirm-password" required>
        <Input id="confirm-password" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </FieldWrap>
      {error && <p className="ctf-form-error">{error}</p>}
      <Button type="submit" variant="primary" size="lg" loading={submitting} className="ctf-password-gate__submit">
        Set password
      </Button>
    </form>
  )
}
