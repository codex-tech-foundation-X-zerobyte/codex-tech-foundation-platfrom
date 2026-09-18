import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import './States.css'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

/** A specific, honest empty state — never the generic "private data stays private" filler. */
export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="ctf-state ctf-state--empty">
      <div className="ctf-state__icon"><Icon size={22} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="ctf-state__action">{action}</div>}
    </div>
  )
}
