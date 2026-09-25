import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import './Button.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'right',
      disabled,
      className = '',
      children,
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={`ctf-btn ctf-btn--${variant} ctf-btn--${size} ${loading ? 'is-loading' : ''} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {/* Reserve layout space so buttons never resize when loading */}
        <span className="ctf-btn__content">
          {loading && <Loader2 className="ctf-btn__spinner" size={16} aria-hidden="true" />}
          {!loading && icon && iconPosition === 'left' && icon}
          {children && <span>{children}</span>}
          {!loading && icon && iconPosition === 'right' && icon}
        </span>
      </button>
    )
  },
)
Button.displayName = 'Button'
