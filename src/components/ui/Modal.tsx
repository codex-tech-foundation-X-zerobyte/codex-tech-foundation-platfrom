import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import './Modal.css'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ctf-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="ctf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ctf-modal-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="ctf-modal__head">
          <h3 id="ctf-modal-title">{title}</h3>
          <Button variant="icon" size="sm" aria-label="Close dialog" onClick={onClose}>
            <X size={16} />
          </Button>
        </header>
        <div className="ctf-modal__body">{children}</div>
        {footer && <footer className="ctf-modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}
