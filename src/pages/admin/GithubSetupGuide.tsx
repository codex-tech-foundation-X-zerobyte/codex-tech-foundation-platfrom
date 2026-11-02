import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge, Button } from '../../components/ui'
import { githubInstallations, listLinkedRepositories, type ConnectionReport } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { supabaseProjectRef } from '../../workspaces/definitions'
import { buildSteps, loadTicks, makeWebhookSecret, progress, saveTicks, stepStatuses, type CopyValue, type StepState } from '../../lib/githubSetupGuide'

const BADGE: Record<StepState, { tone: 'success' | 'warning' | 'neutral'; label: string }> = {
  done: { tone: 'success', label: 'Done' }, todo: { tone: 'warning', label: 'To do' }, blocked: { tone: 'neutral', label: 'Waiting' }, unknown: { tone: 'neutral', label: 'Not checked' }, optional: { tone: 'neutral', label: 'Optional' },
}

function CopyRow({ item }: { item: CopyValue }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.value); setState('copied'); setTimeout(() => setState('idle'), 2000) } catch { setState('failed') }
  }
  return (
    <div className="ctf-guide__copy">
      <span className="ctf-denv__muted">{item.label}</span>
      <div className="ctf-guide__value">
        {item.multiline ? <pre className="ctf-guide__code">{item.value}</pre> : <code className="ctf-guide__code">{item.value}</code>}
        <Button size="sm" variant="secondary" onClick={() => void copy()} aria-label={`Copy ${item.label}`}>
          {state === 'copied' ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}
        </Button>
      </div>
      {state === 'failed' && <span className="ctf-denv__muted" role="status">Your browser blocked copying. Select the text above and copy it by hand.</span>}
    </div>
  )
}

/** Makes a random webhook secret in the browser. It is shown, never saved and never sent anywhere. */
function SecretMaker() {
  const [secret, setSecret] = useState<string | null>(null)
  return (
    <div className="ctf-guide__copy">
      <div><Button size="sm" variant="secondary" onClick={() => setSecret(makeWebhookSecret())}>{secret ? 'Make a different secret' : 'Make a secret'}</Button></div>
      {secret && (
        <>
          <CopyRow item={{ label: 'Your webhook secret (copy it now)', value: secret }} />
          <p className="ctf-denv__muted" role="note">Made in this browser. It is not saved or sent anywhere, and it is gone when you leave or reload this page. Put it into GitHub and into Supabase as GITHUB_WEBHOOK_SECRET. If you lose it, make a new one and update both.</p>
        </>
      )}
    </div>
  )
}

/**
 * A guided, ordered checklist for connecting GitHub (and optionally Vercel). Progress comes from the connection check, so a step is
 * only ever shown as done when something real says so. Steps that cannot be detected are ticked by the person and say so.
 */
export function GithubSetupGuide({ report, connected }: { report: ConnectionReport | null; connected: boolean }) {
  const ref = supabaseProjectRef()
  const steps = buildSteps(ref)
  const installs = useAsyncData('github-installations', githubInstallations)
  const linked = useAsyncData('linked-repos', listLinkedRepositories)
  const [ticks, setTicks] = useState<Set<string>>(() => loadTicks())
  const tick = (id: string, on: boolean) => { const next = new Set(ticks); if (on) next.add(id); else next.delete(id); setTicks(next); saveTicks(next) }

  const st = stepStatuses(steps, report, {
    installationsCount: installs.loading || installs.error || !installs.data ? null : installs.data.installations.filter((i) => !i.removed).length,
    linkedCount: linked.loading || linked.error ? null : (linked.data ?? []).length,
  }, ticks)
  const p = progress(steps, st)

  return (
    <details className="ctf-int__app ctf-guide" open={!connected || !p.complete}>
      <summary className="ctf-int__subhead">Setup guide{p.complete ? ' \u2014 everything required is done' : ` \u2014 ${p.done} of ${p.total} required steps done`}</summary>
      <div className="ctf-denv__stack">
        <p className="ctf-denv__muted">Follow the steps in order. Press <strong>Run the check</strong> in the Connection check section below at any time and each step updates from what GitHub, Supabase and Vercel really say. {report ? '' : 'Nothing has been checked yet, so steps show as Not checked.'}</p>
        <ol className="ctf-guide__steps">
          {steps.map((step, i) => {
            const status = st[step.id]
            const isNext = p.next === step.id
            const b = BADGE[status.state]
            return (
              <li key={step.id}>
                <details key={`${step.id}-${isNext}`} open={isNext} className="ctf-guide__step">
                  <summary>
                    <span className="ctf-guide__n" aria-hidden="true">{i + 1}</span>
                    <span className="ctf-guide__title">{step.title}{!step.required && <span className="ctf-denv__muted"> (optional)</span>}</span>
                    <Badge tone={b.tone}>{b.label}</Badge>{isNext && <Badge tone="warning">Do this next</Badge>}
                  </summary>
                  <div className="ctf-denv__stack">
                    <p role="status">{status.note}</p>
                    <p><strong>Why:</strong> {step.why}</p>
                    <ol className="ctf-guide__actions">{step.actions.map((a) => <li key={a}>{a}</li>)}</ol>
                    {step.id === 'webhook-secret' && <SecretMaker />}
                    {step.copy.map((c) => <CopyRow key={c.label} item={c} />)}
                    <p className="ctf-denv__muted"><strong>How you will know:</strong> {step.proof}</p>
                    {step.manual && (
                      <label className="ctf-guide__tick"><input type="checkbox" checked={ticks.has(step.id)} onChange={(e) => tick(step.id, e.target.checked)} /> I have done this <span className="ctf-denv__muted">(saved in this browser only)</span></label>
                    )}
                  </div>
                </details>
              </li>
            )
          })}
        </ol>
      </div>
    </details>
  )
}
