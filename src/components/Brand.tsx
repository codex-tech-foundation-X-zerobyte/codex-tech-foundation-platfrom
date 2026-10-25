import { Link } from 'react-router'
import markSrc from '../assets/brand/codex-mark.png'
import logoSrc from '../assets/brand/codex-logo.png'
import './Brand.css'

/** The Codex mark (the "C" with the code brackets). Transparent PNG, so it sits on any dark surface without a box around it. */
export function BrandMark({ size = 34, className = '' }: { size?: number; className?: string }) {
  return <img src={markSrc} width={size} height={size} alt="" aria-hidden="true" decoding="async" draggable={false} className={`ctf-brand__mark ${className}`.trim()} />
}

/** The full lockup: mark, CODEX wordmark and "Tech Foundation". Use where the brand is the point (sign-in, splash screens). */
export function BrandLogo({ width = 150, to, className = '' }: { width?: number; to?: string; className?: string }) {
  const img = <img src={logoSrc} width={width} alt="Codex Tech Foundation" decoding="async" draggable={false} className={`ctf-brand__logo ${className}`.trim()} style={{ height: 'auto' }} />
  return to ? <Link to={to} className="ctf-brand__logo-link" aria-label="Codex Tech Foundation home">{img}</Link> : img
}

/** `workspace` is the signed-in product ("Codex Workspace"); the default is the public company brand. */
export function Brand({ to = '/', tagline = true, workspace = false }: { to?: string; tagline?: boolean; workspace?: boolean }) {
  return (
    <Link to={to} className="ctf-brand" aria-label={workspace ? 'Codex Workspace home' : 'Codex Tech Foundation home'}>
      <BrandMark />
      <span className="ctf-brand__copy">
        <strong>{workspace ? 'Codex Workspace' : 'Codex Tech Foundation'}</strong>
        {workspace ? <small>Tech Foundation</small> : tagline && <small>Engineering, applied.</small>}
      </span>
    </Link>
  )
}
