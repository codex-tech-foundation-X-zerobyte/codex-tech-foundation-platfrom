import { forwardRef, type InputHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import './SearchInput.css'

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({ value, onChange, className = '', placeholder = 'Search…', ...rest }, ref) => (
  <div className={`ctf-search ${className}`}>
    <Search size={15} aria-hidden="true" />
    <input ref={ref} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} autoComplete="off" spellCheck={false} {...rest} />
    {value && (
      <button type="button" className="ctf-search__clear" aria-label="Clear search" onClick={() => onChange('')}><X size={13} /></button>
    )}
  </div>
))
SearchInput.displayName = 'SearchInput'
