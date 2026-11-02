import type { CSSProperties, ReactNode } from 'react'
import { useReveal } from '../hooks/useReveal'

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`ctf-reveal ${visible ? 'is-visible' : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}
