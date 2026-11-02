import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCopy, Stethoscope, XCircle } from 'lucide-react'
import { Button, useToast } from './ui'
import { useAuth } from '../lib/auth'
import { getBrowserFacts } from '../lib/push'
import { listenForLiveNotifications, pushDispatchResult, pushSetupSummary, sendTestNotification } from '../lib/services'
import { checkupPassed, diagnose, reportText, type Finding } from '../lib/notificationCheckup'
import { runCheckup } from '../lib/notificationCheckupRunner'
import './PushControls.css'

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const

/**
 * "Run a full checkup": sends a REAL test notification through the same path real events use (database trigger, push function, push
 * service) while also listening for it live, then explains in plain words which step broke and what to do. Safe to press any time.
 */
export function NotificationCheckup() {
  const { profile } = useAuth()
  const { push } = useToast()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  if (!profile) return null

  const run = async () => {
    setRunning(true); setFindings(null); setTestError(null)
    try {
      const { facts, testError: err } = await runCheckup({
        browser: getBrowserFacts,
        summary: async () => (await pushSetupSummary()).data,
        listen: () => listenForLiveNotifications(profile.id),
        sendTest: sendTestNotification,
        result: async (id) => (await pushDispatchResult(id)).data,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }, setProgress)
      setTestError(err)
      setFindings(diagnose(facts))
    } catch (e) {
      push(e instanceof Error ? e.message : "The checkup couldn't run.", 'error')
    } finally { setRunning(false); setProgress('') }
  }
  const copy = async () => {
    if (!findings) return
    try { await navigator.clipboard.writeText(reportText(findings)); push('Report copied.') } catch { push("Couldn't copy. Select the text and copy it by hand.", 'error') }
  }

  return (
    <div className="ctf-checkup">
      <div className="ctf-checkup__head">
        <Button variant="secondary" size="sm" icon={<Stethoscope size={14} />} loading={running} onClick={() => void run()}>Run a full checkup</Button>
        <small>Sends a real test the way real alerts are sent, and tells you which step fails.</small>
      </div>
      {running && progress && <p className="ctf-checkup__progress" role="status">{progress}</p>}
      {testError && <p className="ctf-checkup__error" role="alert">{testError}</p>}
      {findings && (
        <div className={`ctf-pushreport ${checkupPassed(findings) ? 'is-ok' : 'is-bad'}`} role="status" aria-label="Notification checkup results">
          <strong>{checkupPassed(findings) ? 'Nothing is broken.' : 'Found something to fix:'}</strong>
          <ul>
            {findings.map((f) => {
              const Icon = ICON[f.severity]
              return <li key={f.id} className={`is-${f.severity}`}><Icon size={15} aria-hidden /><div><span>{f.title}</span><small>{f.detail}</small></div></li>
            })}
          </ul>
          <Button variant="ghost" size="sm" icon={<ClipboardCopy size={14} />} onClick={() => void copy()}>Copy report</Button>
        </div>
      )}
    </div>
  )
}
