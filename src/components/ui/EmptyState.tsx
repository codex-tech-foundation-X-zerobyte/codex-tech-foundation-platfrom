import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import './States.css'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  /** Set when this empty state is the whole page, so its title becomes the page's heading (1) instead of plain text. */
  heading?: 1 | 2
}

/** A specific, honest empty state — never the generic "private data stays private" filler. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, heading }: EmptyStateProps) {
  const Title = heading === 1 ? 'h1' : heading === 2 ? 'h2' : 'p'
  return (
    <div className="ctf-state ctf-state--empty">
      <div className="ctf-state__icon"><Icon size={22} /></div>
      <Title className="ctf-state__title">{title}</Title>
      {description && <p>{description}</p>}
      {action && <div className="ctf-state__action">{action}</div>}
    </div>
  )
}
