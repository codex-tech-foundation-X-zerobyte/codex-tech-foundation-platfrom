import type { ReactNode } from 'react'
import './PageHeader.css'

/** The one heading pattern for workspace pages: a title, one plain sentence, and the page's primary actions. */
export function PageHeader({ title, description, actions, level = 1 }: { title: string; description?: string; actions?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className="ctf-page-header">
      <div className="ctf-page-header__copy">
        <Heading>{title}</Heading>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ctf-page-header__actions">{actions}</div>}
    </div>
  )
}
