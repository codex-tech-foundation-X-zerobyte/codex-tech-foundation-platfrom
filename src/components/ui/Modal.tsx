import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'
import './Modal.css'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** When false, a backdrop click or Escape won't close it (use while showing something that can't be recovered, e.g. a one-time password). */
  dismissible?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let openModalCount = 0

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  /*
    ROOT CAUSE of the "type one letter, the field loses focus" bug:
    this effect used to depend on `onClose`. Every parent passes a fresh inline `close`
    function on each render, so every keystroke (state change -> render -> new onClose)
    re-ran the effect, which called dialog.focus() and pulled focus off the input.

    The latest onClose now lives in a ref, so the open/close effect depends on `open`
    alone and runs exactly once per open.
  */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const dismissibleRef = useRef(dismissible)
  useEffect(() => {
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus once, on open — and only if focus isn't already somewhere inside.
    if (dialog && !dialog.contains(document.activeElement)) {
      const target = dialog.querySelector<HTMLElement>('[data-autofocus], input, select, textarea') ?? dialog
      target.focus({ preventScroll: true })
    }

    openModalCount += 1
    if (openModalCount === 1) document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (dismissibleRef.current) onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      // Skip elements that are actually hidden. (offsetParent is NOT a safe test: it is null for position:fixed elements,
      // which would make the trap think nothing is focusable and swallow Tab entirely.)
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true))
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openModalCount = Math.max(0, openModalCount - 1)
      if (openModalCount === 0) document.body.style.overflow = ''
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="ctf-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissibleRef.current && onCloseRef.current()}>
      <div
        className={`ctf-modal ctf-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="ctf-modal__head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {description && <p id={descId}>{description}</p>}
          </div>
          <Button variant="icon" size="sm" aria-label="Close dialog" onClick={() => onCloseRef.current()}>
            <X size={16} />
          </Button>
        </header>
        <div className="ctf-modal__body">{children}</div>
        {footer && <footer className="ctf-modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
