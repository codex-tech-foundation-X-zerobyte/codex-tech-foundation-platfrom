import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import './States.css'

interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong.',
  description = "We couldn't load this information.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="ctf-state ctf-state--error">
      <div className="ctf-state__icon ctf-state__icon--danger"><AlertTriangle size={22} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry && (
        <div className="ctf-state__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  )
}
