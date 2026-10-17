import { useState } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import { ErrorState, SkeletonRows, Surface, useToast } from '../components/ui'
import { listOnboardingProgress, setOnboardingItem } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { COMPANY_ONBOARDING, onboardingHref, type DepartmentDef } from './definitions'

/** A new starter's checklist: company steps first, then their department's. People tick their own items; it disappears when finished. */
export function OnboardingCard({ def, base, userId }: { def: DepartmentDef; base: '/worker' | '/admin'; userId: string }) {
  const progress = useAsyncData(`onboarding:${userId}`, () => listOnboardingProgress(userId))
  const [busy, setBusy] = useState<string | null>(null)
  const { push } = useToast()
  if (progress.loading) return <SkeletonRows rows={2} height="40px" />
  if (progress.error) return <ErrorState title="Your checklist couldn't load" description={progress.errorDetail?.message ?? 'Try again.'} onRetry={progress.reload} />
  const done = progress.data ?? new Set<string>()
  const items = [...COMPANY_ONBOARDING, ...def.onboarding]
  const finished = items.filter((i) => done.has(i.key)).length
  if (finished === items.length) return null

  const toggle = async (key: string, on: boolean) => {
    setBusy(key)
    const { error } = await setOnboardingItem(userId, key, on)
    setBusy(null)
    if (error) push(error.message, 'error'); else progress.reload()
  }
  return (
    <Surface className="ctf-onb" role="region" aria-label="Getting started">
      <header><h3>Getting started</h3><span>{finished} of {items.length} done</span></header>
      <div className="ctf-onb__bar" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={finished} aria-label="Onboarding progress"><span style={{ width: `${(finished / items.length) * 100}%` }} /></div>
      <ul>
        {items.map((i) => {
          const href = onboardingHref(base, def, i.link)
          const on = done.has(i.key)
          return (
            <li key={i.key} className={on ? 'is-done' : ''}>
              <button type="button" role="checkbox" aria-checked={on} aria-label={`${i.label}${on ? ' (done)' : ''}`} disabled={busy === i.key} className="ctf-onb__box" onClick={() => void toggle(i.key, !on)}>{on && <Check size={12} aria-hidden="true" />}</button>
              <div><strong>{i.label}</strong><span>{i.description}</span></div>
              {href && !on && <Link to={href}>Open</Link>}
            </li>
          )
        })}
      </ul>
    </Surface>
  )
}
