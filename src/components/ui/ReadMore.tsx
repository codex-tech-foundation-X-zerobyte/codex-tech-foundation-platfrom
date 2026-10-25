import { useId, useState } from 'react'
import { isLongText } from '../../lib/format'
import './ReadMore.css'

/**
 * Long free text (a bio, a description) shown clamped with "Read more" instead of being poured down the page.
 * Short text renders untouched, with no toggle.
 */
export function ReadMore({ text, lines = 3, limit = 220, className = '' }: { text: string; lines?: number; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const long = isLongText(text, limit)
  return (
    <div className={`ctf-readmore ${className}`.trim()}>
      <p id={id} className={long && !open ? 'is-clamped' : undefined} style={long && !open ? { WebkitLineClamp: lines } : undefined}>{text}</p>
      {long && (
        <button type="button" className="ctf-readmore__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
