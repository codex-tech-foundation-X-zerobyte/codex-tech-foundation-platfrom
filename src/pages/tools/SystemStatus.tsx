import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, CircleAlert, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { testTurnRelay } from '../../lib/rtc'
import './SystemStatus.css'

type CheckState = { status: 'idle' | 'running' | 'ok' | 'warn' | 'fail'; ms?: number; detail?: string }
interface CheckDef { id: string; name: string; what: string; run: () => Promise<Omit<CheckState, 'status'> & { status: 'ok' | 'warn' | 'fail' }> }

const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now()
  const value = await fn()
  return [value, Math.round(performance.now() - t)]
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })

const CHECKS: CheckDef[] = [
  {
    id: 'auth', name: 'Authentication', what: 'Your session is valid and refreshable.',
    run: async () => {
      const [{ data, error }, ms] = await timed(() => supabase.auth.getSession())
      if (error || !data.session) return { status: 'fail', ms, detail: error?.message ?? 'No active session' }
      const mins = Math.round((data.session.expires_at! * 1000 - Date.now()) / 60000)
      return { status: 'ok', ms, detail: `Token valid for ~${Math.max(mins, 0)} more min (auto-refreshes)` }
    },
  },
  {
    id: 'database', name: 'Database', what: 'A permission-scoped read against Postgres.',
    run: async () => {
      const [{ error }, ms] = await timed(async () => await supabase.from('profiles').select('id', { count: 'exact', head: true }))
      if (error) return { status: 'fail', ms, detail: error.message }
      return ms > 1500 ? { status: 'warn', ms, detail: 'Responding, but slower than expected' } : { status: 'ok', ms, detail: 'Query succeeded' }
    },
  },
  {
    id: 'realtime', name: 'Realtime', what: 'WebSocket channel used by chat, calls and notifications.',
    run: async () => {
      const started = performance.now()
      const channel = supabase.channel(`status-check-${crypto.randomUUID()}`)
      try {
        await withTimeout(new Promise<void>((resolve, reject) => {
          channel.subscribe((s) => {
            if (s === 'SUBSCRIBED') resolve()
            else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') reject(new Error(`Channel ${s.toLowerCase().replace('_', ' ')}`))
          })
        }), 8000, 'Realtime')
        return { status: 'ok', ms: Math.round(performance.now() - started), detail: 'Subscribed successfully' }
      } catch (e) {
        return { status: 'fail', ms: Math.round(performance.now() - started), detail: `${(e as Error).message}. Calls and live chat will not work until this is fixed.` }
      } finally {
        void supabase.removeChannel(channel)
      }
    },
  },
  {
    id: 'storage', name: 'Storage', what: 'The private files bucket is reachable.',
    run: async () => {
      const [{ error }, ms] = await timed(() => supabase.storage.from('resources').list('', { limit: 1 }))
      return error ? { status: 'fail', ms, detail: error.message } : { status: 'ok', ms, detail: 'Bucket reachable' }
    },
  },
  {
    id: 'functions', name: 'Edge functions', what: 'The functions runtime answers.',
    run: async () => {
      const [{ error }, ms] = await timed(() => supabase.functions.invoke('health'))
      return error ? { status: 'warn', ms, detail: 'health function did not respond — is it deployed?' } : { status: 'ok', ms, detail: 'Runtime responded' }
    },
  },
  {
    id: 'turn', name: 'TURN relay', what: 'Calls can connect between people on strict networks.',
    run: async () => {
      const r = await testTurnRelay()
      if (!r) return { status: 'warn', detail: 'No TURN server is configured, so calls rely on STUN alone. People behind strict firewalls or symmetric NATs will not be able to connect. Set VITE_TURN_URL, VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL.' }
      return { status: r.ok ? 'ok' : 'fail', ms: r.ms, detail: r.detail }
    },
  },
  {
    id: 'media', name: 'Calls (microphone & camera)', what: 'This browser can start voice and video calls.',
    run: async () => {
      if (!window.isSecureContext) return { status: 'fail', detail: 'Calls need HTTPS (or localhost). Browsers block the microphone on plain http.' }
      if (!navigator.mediaDevices?.getUserMedia) return { status: 'fail', detail: 'This browser has no media device support.' }
      if (typeof RTCPeerConnection === 'undefined') return { status: 'fail', detail: 'WebRTC is not available in this browser.' }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const mics = devices.filter((d) => d.kind === 'audioinput').length
        const cams = devices.filter((d) => d.kind === 'videoinput').length
        if (mics === 0) return { status: 'warn', detail: 'No microphone detected.' }
        return { status: 'ok', detail: `${mics} microphone${mics === 1 ? '' : 's'}, ${cams} camera${cams === 1 ? '' : 's'} detected` }
      } catch {
        return { status: 'warn', detail: 'Could not list devices.' }
      }
    },
  },
]

const ICON = { ok: CheckCircle2, warn: CircleAlert, fail: XCircle, running: Loader2, idle: Activity }
const LABEL = { ok: 'Operational', warn: 'Degraded', fail: 'Failing', running: 'Checking…', idle: 'Pending' }

export function SystemStatus() {
  const [results, setResults] = useState<Record<string, CheckState>>({})
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const runningRef = useRef(false)

  const runAll = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setResults(Object.fromEntries(CHECKS.map((c) => [c.id, { status: 'running' } as CheckState])))
    await Promise.all(CHECKS.map(async (c) => {
      let state: CheckState
      try { state = await withTimeout(c.run(), 15000, c.name) } catch (e) { state = { status: 'fail', detail: (e as Error).message } }
      setResults((prev) => ({ ...prev, [c.id]: state }))
    }))
    setCheckedAt(new Date())
    runningRef.current = false
  }, [])

  useEffect(() => { void runAll() }, [runAll])

  const values = CHECKS.map((c) => results[c.id]?.status ?? 'idle')
  const busy = values.includes('running')
  const overall = values.includes('fail') ? 'fail' : values.includes('warn') ? 'warn' : values.every((v) => v === 'ok') ? 'ok' : 'idle'
  const headline = busy ? 'Running checks…' : overall === 'ok' ? 'All systems operational' : overall === 'warn' ? 'Some systems are degraded' : 'Something needs attention'

  return (
    <div className="ctf-status">
      <div className={`ctf-status__banner ctf-status__banner--${busy ? 'idle' : overall}`}>
        <span className="ctf-status__pulse" aria-hidden="true" />
        <div>
          <strong>{headline}</strong>
          <span>{checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : 'These checks run from your browser, against your own session.'}</span>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} loading={busy} onClick={() => void runAll()}>Run again</Button>
      </div>
      <ul className="ctf-status__list">
        {CHECKS.map((c) => {
          const r = results[c.id] ?? { status: 'idle' as const }
          const Icon = ICON[r.status]
          return (
            <li key={c.id} className={`ctf-status__row ctf-status__row--${r.status}`}>
              <Icon size={18} className={r.status === 'running' ? 'ctf-status__spin' : ''} />
              <div className="ctf-status__copy">
                <strong>{c.name}</strong>
                <span>{r.detail ?? c.what}</span>
              </div>
              <div className="ctf-status__meta">
                {r.ms !== undefined && <span className="mono">{r.ms} ms</span>}
                <span className="ctf-status__pill">{LABEL[r.status]}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
