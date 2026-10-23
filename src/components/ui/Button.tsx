import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ArrowUpRight, Loader2 } from 'lucide-react'
import './Button.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonStyleProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  loading?: boolean
}

/** Arrows read as "go forward" and belong after the label; every other icon leads it. */
function resolveIconPosition(icon: ReactNode, explicit?: 'left' | 'right'): 'left' | 'right' {
  if (explicit) return explicit
  const type = (icon as ReactElement | null)?.type
  return type === ArrowRight || type === ArrowUpRight ? 'right' : 'left'
}

function classes(variant: ButtonVariant, size: ButtonSize, extra: string, loading = false) {
  return `ctf-btn ctf-btn--${variant} ctf-btn--${size} ${loading ? 'is-loading' : ''} ${extra}`.trim()
}

function Content({ icon, iconPosition, loading, children }: { icon?: ReactNode; iconPosition: 'left' | 'right'; loading?: boolean; children?: ReactNode }) {
  return (
    <span className="ctf-btn__content">
      {loading && <Loader2 className="ctf-btn__spinner" size={16} aria-hidden="true" />}
      {!loading && icon && iconPosition === 'left' && icon}
      {children && <span>{children}</span>}
      {!loading && icon && iconPosition === 'right' && icon}
    </span>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, icon, iconPosition, disabled, className = '', children, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      // Default to type="button": a bare <button> inside a <form> submits it, which
      // silently turned every "Cancel" inside a form into a submit.
      type={type}
      className={classes(variant, size, className, loading)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Content icon={icon} iconPosition={resolveIconPosition(icon, iconPosition)} loading={loading}>{children}</Content>
    </button>
  ),
)
Button.displayName = 'Button'

interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>, ButtonStyleProps {
  to: string
  /** For links that leave the app (mailto:, https://…). Renders a plain <a>. */
  external?: boolean
}

/**
 * A link that looks like a Button. Use instead of <Link><Button/></Link>: a <button> nested in an <a>
 * is invalid HTML, double-activates for keyboard/screen-reader users, and breaks open-in-new-tab.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ variant = 'primary', size = 'md', icon, iconPosition, className = '', children, to, external, ...rest }, ref) => {
    const content = <Content icon={icon} iconPosition={resolveIconPosition(icon, iconPosition)}>{children}</Content>
    const cls = classes(variant, size, className)
    if (external) return <a ref={ref} href={to} className={cls} rel="noopener noreferrer" {...rest}>{content}</a>
    return <Link ref={ref} to={to} className={cls} {...rest}>{content}</Link>
  },
)
ButtonLink.displayName = 'ButtonLink'
