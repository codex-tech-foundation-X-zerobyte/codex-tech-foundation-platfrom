import { useId, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { CopyButton } from '../../components/ui'
import './toolkit.css'

export function ToolGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return <div className={`tk-grid tk-grid--${cols}`}>{children}</div>
}

export function Pane({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="tk-pane">
      {(title || actions) && (
        <header className="tk-pane__head">
          <h3>{title}</h3>
          {actions && <div className="tk-pane__actions">{actions}</div>}
        </header>
      )}
      <div className="tk-pane__body">{children}</div>
    </section>
  )
}

export function CodeArea({ value, onChange, placeholder, readOnly, rows = 14, label, wrap = true }: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  rows?: number
  label: string
  wrap?: boolean
}) {
  return (
    <textarea
      className="tk-code mono"
      aria-label={label}
      value={value}
      rows={rows}
      readOnly={readOnly}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      wrap={wrap ? 'soft' : 'off'}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
    />
  )
}

/** Read-only output with a copy button; the empty state is quiet, never an error. */
export function Output({ value, label, rows = 14, placeholder = 'Output appears here' }: { value: string; label: string; rows?: number; placeholder?: string }) {
  return (
    <div className="tk-output">
      <CodeArea value={value} readOnly label={label} rows={rows} placeholder={placeholder} />
      <div className="tk-output__copy"><CopyButton value={value} /></div>
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tk-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const id = useId()
  return (
    <label className="tk-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'error' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle
  return (
    <div className={`tk-notice tk-notice--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={15} />
      <div>{children}</div>
    </div>
  )
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="tk-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="mono">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="tk-field">
      <span>{label}</span>
      {children}
    </label>
  )
}
