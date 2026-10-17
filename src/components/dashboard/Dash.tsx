import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import './Dash.css'

type Tone = 'neutral' | 'good' | 'warn' | 'bad'

/** One headline number, with an optional plain-language hint and link to where you'd act on it. */
export function Kpi({ label, value, hint, tone = 'neutral', icon: Icon, to, loading }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ComponentType<{ size?: number }>; to?: string; loading?: boolean }) {
  const body = (
    <>
      <div className="ctf-kpi__top">
        <span className="ctf-kpi__label">{label}</span>
        {Icon && <span className="ctf-kpi__icon"><Icon size={15} /></span>}
      </div>
      <strong className="ctf-kpi__value">{loading ? <span className="ctf-kpi__skeleton" aria-label="Loading" /> : value}</strong>
      {hint && !loading && <span className="ctf-kpi__hint">{hint}</span>}
    </>
  )
  return to ? <Link to={to} className={`ctf-kpi ctf-kpi--${tone} is-link`}>{body}<ArrowRight size={14} className="ctf-kpi__go" aria-hidden="true" /></Link> : <div className={`ctf-kpi ctf-kpi--${tone}`}>{body}</div>
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="ctf-kpi-row">{children}</div>
}

export function Panel({ title, icon: Icon, action, children, className = '' }: { title: string; icon?: ComponentType<{ size?: number }>; action?: { to: string; label: string }; children: ReactNode; className?: string }) {
  return (
    <section className={`ctf-panel ${className}`} aria-label={title}>
      <header>
        <h2>{Icon && <Icon size={15} />} {title}</h2>
        {action && <Link to={action.to}>{action.label} <ArrowRight size={12} /></Link>}
      </header>
      <div className="ctf-panel__body">{children}</div>
    </section>
  )
}

export function Hero({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ctf-dash-hero">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {children && <div className="ctf-dash-hero__actions">{children}</div>}
    </div>
  )
}

/** Horizontal bars for a categorical breakdown (leads by status, tasks by status...). Bars are scaled to the largest value. */
export function BarList({ items, emptyText = 'Nothing to show yet.' }: { items: { label: string; value: number; tone?: Tone }[]; emptyText?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return <p className="ctf-muted">{emptyText}</p>
  return (
    <ul className="ctf-bars">
      {items.map((i) => (
        <li key={i.label}>
          <span>{i.label}</span>
          <div className="ctf-bars__track" role="img" aria-label={`${i.label}: ${i.value}`}><i className={`tone-${i.tone ?? 'neutral'}`} style={{ width: `${(i.value / max) * 100}%` }} /></div>
          <b>{i.value}</b>
        </li>
      ))}
    </ul>
  )
}

/** A single stacked bar with a legend: share of the whole, at a glance. */
export function StackedBar({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return <p className="ctf-muted">Nothing to show yet.</p>
  return (
    <div className="ctf-stacked">
      <div className="ctf-stacked__bar" role="img" aria-label={items.filter((i) => i.value).map((i) => `${i.label} ${i.value}`).join(', ')}>
        {items.filter((i) => i.value > 0).map((i) => <i key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} />)}
      </div>
      <ul>{items.filter((i) => i.value > 0).map((i) => <li key={i.label}><i style={{ background: i.color }} />{i.label} <b>{i.value}</b></li>)}</ul>
    </div>
  )
}

/** Tiny column chart for a short series (e.g. completions over 14 days). */
export function MiniBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div className="ctf-minibars" role="img" aria-label={`${label}: ${total} in total`}>
      {values.map((v, i) => <i key={i} className={i === values.length - 1 ? 'is-today' : ''} style={{ height: `${Math.max(v > 0 ? 14 : 4, (v / max) * 100)}%` }} title={String(v)} />)}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="ctf-panel__empty">{children}</p>
}
