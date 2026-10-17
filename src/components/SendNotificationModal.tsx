import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Button, FieldWrap, Input, Modal, Select, Textarea, useToast } from './ui'
import { sendNotification, type NotificationAudience } from '../lib/services'
import { useAuth } from '../lib/auth'

const AUDIENCE_OPTIONS: { id: NotificationAudience['kind']; label: string }[] = [
  { id: 'workers', label: 'All workers' },
  { id: 'managers', label: 'All managers' },
  { id: 'everyone_internal', label: 'Everyone (internal)' },
]

export function SendNotificationButton({ onSent }: { onSent?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" icon={<Bell size={15} />} onClick={() => setOpen(true)}>Send notification</Button>
      <SendNotificationModal open={open} onClose={() => setOpen(false)} onSent={onSent} />
    </>
  )
}

function SendNotificationModal({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent?: () => void }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audienceKind, setAudienceKind] = useState<NotificationAudience['kind']>('workers')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Broad audiences require notifications.broadcast (managers get it by
  // default; superadmin always can). A plain worker only sees this button
  // at all from pages that intentionally offer it — the actual enforcement
  // is server-side in send-notification, this just avoids showing an
  // audience picker that would predictably fail for most workers.
  const canBroadcast = profile?.role === 'superadmin' || profile?.role === 'manager'

  const reset = () => { setTitle(''); setMessage(''); setAudienceKind('workers'); setError('') }
  const close = () => { onClose(); reset() }

  const submit = async () => {
    if (!title.trim() || !message.trim()) return
    setSubmitting(true)
    setError('')
    const { error: err, sent } = await sendNotification({
      title: title.trim(),
      message: message.trim(),
      audience: { kind: audienceKind } as NotificationAudience,
    })
    setSubmitting(false)
    if (err) { setError(err.message); return }
    push(`Sent to ${sent ?? 0} ${sent === 1 ? 'person' : 'people'}`)
    onSent?.()
    close()
  }

  return (
    <Modal open={open} onClose={close} title="Send notification">
      <FieldWrap label="Title" htmlFor="sn-title" required>
        <Input id="sn-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Message" htmlFor="sn-message" required>
        <Textarea id="sn-message" required rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Audience" htmlFor="sn-audience" hint={canBroadcast ? undefined : 'Broad audiences require a manager or superadmin account.'}>
        <Select id="sn-audience" value={audienceKind} onChange={(e) => setAudienceKind(e.target.value as NotificationAudience['kind'])} disabled={!canBroadcast}>
          {AUDIENCE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      </FieldWrap>
      {error && <p className="ctf-form-error">{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button variant="primary" loading={submitting} disabled={!title.trim() || !message.trim()} onClick={submit}>Send</Button>
      </div>
    </Modal>
  )
}
