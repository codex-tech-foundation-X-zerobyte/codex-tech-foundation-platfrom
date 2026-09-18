import { Link } from 'react-router-dom'
import './Brand.css'

/**
 * Codex mark: three converging strokes (idea → system → output) inside a fixed frame.
 * Deliberately geometric — no mascot, no emoji, no stock "circuit" cliché.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" fill="url(#ctf-mark-grad)" />
      <path d="M12 27V13l8 6 8-6v14" stroke="#f5f7fa" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="1.6" fill="#f5f7fa" />
      <circle cx="28" cy="13" r="1.6" fill="#f5f7fa" />
      <defs>
        <linearGradient id="ctf-mark-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4a63ff" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function Brand({ to = '/', tagline = true }: { to?: string; tagline?: boolean }) {
  return (
    <Link to={to} className="ctf-brand" aria-label="Codex Tech Foundation home">
      <BrandMark />
      <span className="ctf-brand__copy">
        <strong>Codex Tech Foundation</strong>
        {tagline && <small>Engineering, applied.</small>}
      </span>
    </Link>
  )
}
