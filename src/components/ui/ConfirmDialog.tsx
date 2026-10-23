import { useId, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Field'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** What will happen, in plain words — including anything that goes with it (e.g. "and its 4 applications"). */
  children: ReactNode
  confirmLabel?: string
  /** For destructive actions that can't be undone: the person must type this exact text before the button enables. */
  typeToConfirm?: string
  /** Do the work. Return an error message to keep the dialog open and show it; return nothing to close on success. */
  onConfirm: () => Promise<string | void | null>
}

/**
 * One confirmation for every delete in the app, so a destructive action always reads the same way and can never be a
 * single stray tap. State lives in the inner component, which only mounts while open — so it resets itself on every open.
 */
export function ConfirmDialog({ open, onClose, title, children, confirmLabel = 'Delete', typeToConfirm, onConfirm }: ConfirmDialogProps) {
  if (!open) return null
  return <ConfirmBody onClose={onClose} title={title} confirmLabel={confirmLabel} typeToConfirm={typeToConfirm} onConfirm={onConfirm}>{children}</ConfirmBody>
}

function ConfirmBody({ onClose, title, children, confirmLabel, typeToConfirm, onConfirm }: Omit<ConfirmDialogProps, 'open'> & { confirmLabel: string }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase()

  const run = async () => {
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      const message = await onConfirm()
      if (message) { setError(message); setBusy(false); return }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Nothing was changed.')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      dismissible={!busy}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void run()} loading={busy} disabled={!ready}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className="ctf-confirm">
        <div className="ctf-confirm__body">{children}</div>
        {typeToConfirm && (
          <div className="ctf-confirm__type">
            <label htmlFor={inputId}>Type <strong>{typeToConfirm}</strong> to confirm</label>
            <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} onKeyDown={(e) => { if (e.key === 'Enter') void run() }} />
          </div>
        )}
        {error && <p className="ctf-confirm__error" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
