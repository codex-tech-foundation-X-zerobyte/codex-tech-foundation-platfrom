import { useCallback, useEffect, useState } from 'react'
import { BellRing, CheckCircle2, XCircle, X } from 'lucide-react'
import { Button, Switch, useToast } from './ui'
import { disablePush, enablePush, getPushStatus, type PushStatus } from '../lib/push'
import { sendTestPush, type PushTestReport } from '../lib/services'
import './PushControls.css'

const DISMISSED_KEY = 'ctf:push-prompt-dismissed'

function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const refresh = useCallback(() => { void getPushStatus().then(setStatus).catch(() => setStatus('unsupported')) }, [])
  useEffect(refresh, [refresh])
  return { status, refresh }
}

const explain: Record<PushStatus, string> = {
  unsupported: "This browser can't receive push notifications.",
  'needs-install': 'On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there to turn this on.',
  'not-configured': 'Push notifications have not been set up for this workspace yet — ask the Main Admin.',
  denied: 'Blocked for this site — allow notifications in your browser settings, then come back.',
  off: 'Get messages, calls and updates on this device even when the app is closed.',
  on: 'On for this device — messages, calls and updates reach you even when the app is closed.',
}

/** The switch in Settings → Notifications. One registration per device/browser. */
export function PushSetting() {
  const { push } = useToast()
  const { status, refresh } = usePushStatus()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [testing, setTesting] = useState(false)
  const [report, setReport] = useState<PushTestReport | null>(null)
  if (!status) return null
  const usable = status === 'on' || status === 'off'

  const change = async (on: boolean) => {
    setBusy(true); setProgress(''); setReport(null)
    try {
      if (on) { await enablePush(setProgress); push('Push notifications are on for this device.') }
      else { await disablePush(); push('Push notifications are off for this device.', 'info') }
    } catch (err) {
      push(err instanceof Error ? err.message : "Couldn't change push notifications.", 'error', { durationMs: 12_000 })
    } finally { setBusy(false); setProgress(''); refresh() }
  }

  const test = async () => {
    setTesting(true); setReport(null)
    const { data, error } = await sendTestPush()
    setTesting(false)
    if (error || !data) { push(error?.message ?? "Couldn't run the test.", 'error', { durationMs: 12_000 }); return }
    setReport(data)
    if (data.ok) push('Test sent — it should appear on this device in a few seconds.')
  }

  return (
    <div className="ctf-pushset">
      <Switch label="Push notifications" checked={status === 'on'} onChange={(v) => void change(v)} disabled={!usable || busy}
        description={busy && progress ? progress : explain[status]} />
      {usable && (
        <div className="ctf-pushset__test">
          <Button variant="secondary" size="sm" loading={testing} onClick={() => void test()}>{status === 'on' ? 'Send a test notification' : 'Check the setup'}</Button>
        </div>
      )}
      {report && (
        <div className={`ctf-pushreport ${report.ok ? 'is-ok' : 'is-bad'}`} role="status">
          <strong>{report.ok ? 'Everything checks out.' : 'Something is not set up yet:'}</strong>
          <ul>
            {report.checks.map((c) => (
              <li key={c.id} className={c.ok ? 'is-ok' : 'is-bad'}>
                {c.ok ? <CheckCircle2 size={15} aria-hidden /> : <XCircle size={15} aria-hidden />}
                <div><span>{c.label}</span><small>{c.detail}</small></div>
              </li>
            ))}
            {report.devices.map((d, i) => (
              <li key={`${d.service}-${i}`} className={d.ok ? 'is-ok' : 'is-bad'}>
                {d.ok ? <CheckCircle2 size={15} aria-hidden /> : <XCircle size={15} aria-hidden />}
                <div><span>Device via {d.service}</span><small>{d.detail}</small></div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** A one-time, dismissible nudge. Browsers only allow the permission prompt from a click, so this is the click. */
export function PushPrompt() {
  const { push } = useToast()
  const { status, refresh } = usePushStatus()
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISSED_KEY) === '1' } catch { return true } })
  const [busy, setBusy] = useState(false)
  if (dismissed || status !== 'off' || (typeof Notification !== 'undefined' && Notification.permission === 'denied')) return null

  const dismiss = () => { try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* shown again next visit: harmless */ } setDismissed(true) }
  const turnOn = async () => {
    setBusy(true)
    try { await enablePush(); push('Push notifications are on.'); setDismissed(true) }
    catch (err) { push(err instanceof Error ? err.message : "Couldn't turn on notifications.", 'error') }
    finally { setBusy(false); refresh() }
  }

  return (
    <div className="ctf-push-prompt" role="region" aria-label="Notifications">
      <BellRing size={18} aria-hidden />
      <p><strong>Never miss a message or a call.</strong> Turn on notifications to hear about chats and updates even when this app is closed.</p>
      <div className="ctf-push-prompt__actions">
        <Button size="sm" onClick={() => void turnOn()} loading={busy}>Turn on</Button>
        <button type="button" className="ctf-push-prompt__close" onClick={dismiss} aria-label="Dismiss"><X size={16} /></button>
      </div>
    </div>
  )
}
