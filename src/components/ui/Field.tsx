import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import './Field.css'

interface FieldWrapProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}

export function FieldWrap({ label, htmlFor, hint, error, required, children }: FieldWrapProps) {
  return (
    <div className="ctf-field">
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="ctf-field__required"> *</span>}
      </label>
      {children}
      {hint && !error && <small className="ctf-field__hint">{hint}</small>}
      {error && <small className="ctf-field__error" role="alert">{error}</small>}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: boolean }>(
  ({ className = '', error, ...rest }, ref) => (
    <input ref={ref} className={`ctf-input ${error ? 'is-error' : ''} ${className}`} {...rest} />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  ({ className = '', error, ...rest }, ref) => (
    <textarea ref={ref} className={`ctf-input ctf-textarea ${error ? 'is-error' : ''} ${className}`} {...rest} />
  ),
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...rest }, ref) => (
    <select ref={ref} className={`ctf-input ctf-select ${className}`} {...rest}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'
