import type { KeyboardEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import './Primitives.css'

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  align = 'left',
}: {
  eyebrow?: string
  title: ReactNode
  description?: string
  action?: ReactNode
  align?: 'left' | 'center'
}) {
  return (
    <div className={`ctf-section-heading ctf-section-heading--${align}`}>
      <div>
        {eyebrow && <span className="eyebrow muted">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p className="lead">{description}</p>}
      </div>
      {action && <div className="ctf-section-heading__action">{action}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  icon: Icon,
  trend,
}: {
  label: string
  value: ReactNode
  icon?: LucideIcon
  trend?: { direction: 'up' | 'down' | 'flat'; label: string }
}) {
  return (
    <div className="ctf-stat">
      <div className="ctf-stat__head">
        <span>{label}</span>
        {Icon && <Icon size={16} />}
      </div>
      <strong>{value}</strong>
      {trend && (
        <span className={`ctf-stat__trend ctf-stat__trend--${trend.direction}`}>{trend.label}</span>
      )}
    </div>
  )
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'warning' }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="ctf-progress" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={`ctf-progress__fill ctf-progress__fill--${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
  return (
    <span className="ctf-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
  label = 'Sections',
}: {
  tabs: { id: string; label: string; count?: number }[]
  active: string
  onChange: (id: string) => void
  label?: string
}) {
  // WAI-ARIA tabs: arrow keys move between tabs; only the active tab is in the tab order.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active)
    let next = index
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].id)
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="ctf-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          tabIndex={active === tab.id ? 0 : -1}
          aria-selected={active === tab.id}
          className={`ctf-tabs__item ${active === tab.id ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ctf-tabs__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}
