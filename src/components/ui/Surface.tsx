import type { AnchorHTMLAttributes, HTMLAttributes } from 'react'
import './Surface.css'

type SurfaceVariant = 'primary' | 'secondary' | 'interactive' | 'featured' | 'warning'

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

/** Generic surface — use for panels and non-interactive grouping. Not every block needs one. */
export function Surface({ variant = 'primary', padding = 'md', className = '', ...rest }: SurfaceProps) {
  return <div className={`ctf-surface ctf-surface--${variant} ctf-surface--pad-${padding} ${className}`} {...rest} />
}

interface SurfaceLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: SurfaceVariant
}

/** Interactive surface rendered as a link — for clickable cards (projects, posts, roles). */
export function SurfaceLink({ variant = 'interactive', className = '', ...rest }: SurfaceLinkProps) {
  return <a className={`ctf-surface ctf-surface--${variant} ctf-surface--pad-md ctf-surface--link ${className}`} {...rest} />
}
