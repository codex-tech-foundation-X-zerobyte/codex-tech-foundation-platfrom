import { useId, type ReactNode } from 'react'
import './Switch.css'

/** A real switch for on/off settings (role="switch", keyboard operable), with its label and description attached. */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  // useId, not the label text: aria-labelledby splits on spaces, so an id like "sw-Call ringtone" named nothing.
  const labelId = useId()
  const descId = useId()
  return (
    <div className={`ctf-switch ${disabled ? 'is-disabled' : ''}`}>
      <div className="ctf-switch__text">
        <strong id={labelId}>{label}</strong>
        {description && <span id={descId}>{description}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelId} aria-describedby={description ? descId : undefined} disabled={disabled} className="ctf-switch__track" onClick={() => onChange(!checked)}>
        <span className="ctf-switch__thumb" />
      </button>
    </div>
  )
}
