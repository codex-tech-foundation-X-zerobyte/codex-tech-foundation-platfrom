import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Eraser, Terminal } from 'lucide-react'
import { HTTP_METHODS, appendConsole, formatBody, parseHttpLine, splitOutput, type ConsoleLine, type ConsoleLineKind } from '../../../lib/presentation'
import type { StageProps } from './types'

type Mode = 'http' | 'cmd' | 'out' | 'note'
const MODES: { id: Mode; label: string; placeholder: string }[] = [
  { id: 'http', label: 'HTTP request', placeholder: 'GET https://api.example.com/health' },
  { id: 'cmd', label: 'Command', placeholder: 'npm run build' },
  { id: 'out', label: 'Paste output', placeholder: 'Paste logs or command output here' },
  { id: 'note', label: 'Note', placeholder: 'Say what is happening, for the audience' },
]
const PROMPT: Record<ConsoleLineKind, string> = { cmd: '$', out: '', err: '', note: '#' }

const asLines = (v: unknown): ConsoleLine[] => (Array.isArray(v) ? v.filter((l): l is ConsoleLine => !!l && typeof l === 'object' && typeof (l as ConsoleLine).text === 'string' && typeof (l as ConsoleLine).k === 'string') : [])

/**
 * A shared terminal-style stage. Be clear about what it is: it does not run a shell. The presenter logs the commands they run and
 * pastes the real output, and "HTTP request" really does call an API (from the presenter's own browser) and shows status, time and
 * body. Everyone watching sees the same lines as they appear.
 */
export function ConsoleStage({ state, isPresenter, commit }: StageProps) {
  const lines = asLines(state.lines)
  const [mode, setMode] = useState<Mode>('http')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'end' }) }, [lines.length])
  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }

  const push = (add: { k: ConsoleLineKind; text: string }[]) => commit({ ...state, lines: appendConsole(lines, add) }, { immediate: true })

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const input = text.trim()
    if (!input || busy) return
    setError('')
    if (mode === 'cmd') { push([{ k: 'cmd', text: input }]); setText(''); return }
    if (mode === 'note') { push([{ k: 'note', text: input }]); setText(''); return }
    if (mode === 'out') { push(splitOutput(text).map((t) => ({ k: 'out' as const, text: t || ' ' }))); setText(''); return }
    const req = parseHttpLine(input)
    if (!req) { setError('Use "GET https://host/path" or just a https:// address.'); return }
    setBusy(true); setText('')
    const started = performance.now()
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 15_000)
    const head: { k: ConsoleLineKind; text: string }[] = [{ k: 'cmd', text: `${req.method} ${req.url}` }]
    try {
      const res = await fetch(req.url, { method: req.method, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      const ms = Math.round(performance.now() - started)
      const body = req.method === 'HEAD' ? '' : await res.text()
      const type = res.headers.get('content-type')
      push([...head, { k: res.ok ? 'out' : 'err', text: `HTTP ${res.status} ${res.statusText}  ·  ${ms} ms${type ? `  ·  ${type.split(';')[0]}` : ''}` }, ...(body ? splitOutput(formatBody(body)).map((t) => ({ k: 'out' as const, text: t || ' ' })) : [])])
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      push([...head, { k: 'err', text: aborted ? 'No response after 15 seconds.' : "The browser could not complete this request. Either the host is unreachable, or the API does not allow calls from this site (a CORS rule). Requests are sent from the presenter's browser." }])
    } finally { clearTimeout(timeout); setBusy(false) }
  }

  const current = MODES.find((m) => m.id === mode)!
  return (
    <div className="ctf-stage ctf-stage--console">
      <div className="ctf-term" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Console output">
        {lines.length === 0 ? (
          <div className="ctf-stage__empty ctf-stage__empty--term"><Terminal size={28} aria-hidden="true" /><strong>{isPresenter ? 'The console is empty' : 'Nothing on the console yet'}</strong><span>{isPresenter ? 'Log a command, paste output or run an HTTP request below.' : 'Lines appear here as the presenter adds them.'}</span></div>
        ) : lines.map((l) => (
          <div key={l.id} className={`ctf-term__line ctf-term__line--${l.k}`}>
            {PROMPT[l.k] && <span className="ctf-term__prompt" aria-hidden="true">{PROMPT[l.k]}</span>}
            <span className="ctf-term__text">{l.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {isPresenter && (
        <form className="ctf-termbar" onSubmit={(e) => void send(e)}>
          <div className="ctf-termbar__modes" role="group" aria-label="What to add">
            {MODES.map((m) => <button key={m.id} type="button" className={mode === m.id ? 'is-on' : ''} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); setError('') }}>{m.label}</button>)}
            <button type="button" className="ctf-termbar__clear" onClick={() => commit({ ...state, lines: [] }, { immediate: true })} disabled={lines.length === 0} aria-label="Clear the console" title="Clear the console"><Eraser size={14} /></button>
          </div>
          <div className="ctf-termbar__row">
            {mode === 'out' ? (
              <textarea aria-label={current.label} value={text} onChange={(e) => setText(e.target.value)} placeholder={current.placeholder} rows={3} spellCheck={false} />
            ) : (
              <input aria-label={current.label} value={text} onChange={(e) => setText(e.target.value)} placeholder={current.placeholder} spellCheck={false} autoComplete="off" />
            )}
            <button type="submit" className="ctf-btn-solid" disabled={!text.trim() || busy}>{busy ? 'Running…' : mode === 'http' ? 'Send' : 'Add'}</button>
          </div>
          {mode === 'http' && <p className="ctf-termbar__hint">Methods: {HTTP_METHODS.join(', ')}. Sent from your browser, so the API must allow it (CORS).</p>}
          {mode === 'cmd' && <p className="ctf-termbar__hint">This logs the command for the audience. It does not run it: paste the real output with &quot;Paste output&quot;.</p>}
          {error && <p className="ctf-stage__error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  )
}
