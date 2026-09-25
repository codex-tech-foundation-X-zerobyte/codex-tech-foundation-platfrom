import type { ReactNode } from 'react'
import './Badge.css'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ctf-badge ctf-badge--${tone}`}>{children}</span>
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  planning: 'neutral',
  todo: 'neutral',
  backlog: 'neutral',
  review: 'warning',
  in_review: 'warning',
  in_progress: 'accent',
  active: 'accent',
  open: 'accent',
  new: 'accent',
  published: 'success',
  approved: 'success',
  complete: 'success',
  completed: 'success',
  done: 'success',
  active_client: 'success',
  blocked: 'danger',
  declined: 'danger',
  rejected: 'danger',
  suspended: 'danger',
  archived: 'neutral',
  unpublished: 'neutral',
  urgent: 'danger',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
}

/** Renders a status string as a Badge with a sensible tone inferred from common lifecycle values. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status.toLowerCase()] ?? 'neutral'
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>
}
