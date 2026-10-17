import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, ConfirmDialog, Modal } from './ui'
import { CredentialsPanel } from './CredentialsPanel'
import { resetAccountPassword } from '../lib/services'
import { useAuth } from '../lib/auth'

/**
 * Main Admin: issue a new temporary password for someone who is locked out. The old password stops working and every
 * session of theirs ends immediately; they must choose their own at next sign-in. Shown once, never stored.
 */
export function ResetPasswordButton({ userId, name, idLabel, id, size = 'sm' }: { userId: string; name: string; idLabel: string; id: string; size?: 'sm' | 'md' }) {
  const { profile } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  if (profile?.role !== 'superadmin') return null

  return (
    <>
      <Button variant="secondary" size={size} icon={<KeyRound size={14} />} onClick={() => setConfirmOpen(true)}>Reset password</Button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Reset this password?"
        confirmLabel="Reset password"
        onConfirm={async () => {
          const { data, error } = await resetAccountPassword(userId)
          if (error || !data) return error?.message ?? 'Could not reset this password.'
          setPassword(data.temp_password)
          return null
        }}
      >
        <p><strong>{name}</strong> will be signed out everywhere and their current password will stop working. You&apos;ll get a new temporary password to pass on.</p>
      </ConfirmDialog>
      <Modal open={password !== null} onClose={() => setPassword(null)} dismissible={false} title="New temporary password">
        {password && <CredentialsPanel idLabel={idLabel} id={id} password={password} onDone={() => setPassword(null)} />}
      </Modal>
    </>
  )
}
