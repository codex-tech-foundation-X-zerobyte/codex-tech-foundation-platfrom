import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '../../../components/ui'
import { CodeArea, Field, KV, Notice, Output, Pane, ToolGrid } from '../toolkit'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const TIMEOUT_MS = 20_000
const MAX_BODY_CHARS = 200_000

interface ApiResult {
  status: number
  statusText: string
  ms: number
  bytes: number
  headers: [string, string][]
  body: string
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const i = trimmed.indexOf(':')
    if (i < 1) throw new Error(`Header line "${trimmed}" should look like "Name: value".`)
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

export default function ApiTool() {
  const [method, setMethod] = useState<(typeof METHODS)[number]>('GET')
  const [url, setUrl] = useState('https://httpbin.org/get')
  const [headers, setHeaders] = useState('Accept: application/json')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ApiResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const send = async () => {
    setError('')
    setResult(null)
    let target: URL
    try {
      target = new URL(url.trim())
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Only http and https URLs are supported.')
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith('Only') ? e.message : 'Enter a full URL, including https://')
      return
    }
    let parsedHeaders: Record<string, string>
    try { parsedHeaders = parseHeaders(headers) } catch (e) { setError((e as Error).message); return }

    const controller = new AbortController()
    abortRef.current = controller
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    setSending(true)
    const started = performance.now()
    try {
      const canHaveBody = method !== 'GET' && method !== 'HEAD'
      const res = await fetch(target, {
        method,
        headers: parsedHeaders,
        body: canHaveBody && body ? body : undefined,
        signal: controller.signal,
        credentials: 'omit', // never attach this app's cookies to an arbitrary third-party URL
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      const text = await res.text()
      const ms = Math.round(performance.now() - started)
      let pretty = text
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch { /* leave as-is */ }
      }
      setResult({
        status: res.status, statusText: res.statusText, ms, bytes: new Blob([text]).size,
        headers: [...res.headers.entries()],
        body: pretty.length > MAX_BODY_CHARS ? pretty.slice(0, MAX_BODY_CHARS) + '\n… (truncated)' : pretty,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') setError(`No response within ${TIMEOUT_MS / 1000}s — the request was cancelled.`)
      else setError('The request failed before a response arrived. This is usually CORS (the server must allow browser requests from this origin), a bad URL, or being offline.')
    } finally {
      clearTimeout(timer)
      setSending(false)
    }
  }

  const tone = result ? (result.status < 300 ? 'ok' : result.status < 400 ? 'info' : 'error') : 'info'

  return (
    <ToolGrid>
      <Pane title="Request">
        <div className="tk-row" style={{ flexWrap: 'nowrap' }}>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])} style={{ width: 100, flex: 'none' }}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="URL"><input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1/things" spellCheck={false} /></Field>
        </div>
        <Field label="Headers (one per line)"><span /></Field>
        <CodeArea label="Request headers" value={headers} onChange={setHeaders} rows={4} placeholder="Authorization: Bearer …" />
        {method !== 'GET' && method !== 'HEAD' && (
          <>
            <Field label="Body"><span /></Field>
            <CodeArea label="Request body" value={body} onChange={setBody} rows={6} placeholder='{"hello":"world"}' />
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" icon={<Send size={14} />} loading={sending} onClick={() => void send()}>Send request</Button>
          {sending && <Button variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel</Button>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Notice tone="warn">Requests go straight from your browser to the URL — nothing passes through Codex servers. Because of that, the target must allow CORS. Don't paste production secrets into a URL you don't control.</Notice>
      </Pane>
      <Pane title="Response">
        {result ? (
          <>
            <Notice tone={tone}><strong>{result.status} {result.statusText}</strong> · {result.ms} ms · {result.bytes.toLocaleString()} bytes</Notice>
            <Output label="Response body" value={result.body} rows={12} />
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>{result.headers.length} response headers</summary>
              <KV rows={result.headers} />
            </details>
          </>
        ) : <p className="ctf-muted">{sending ? 'Waiting for a response…' : 'Send a request to see the response here.'}</p>}
      </Pane>
    </ToolGrid>
  )
}
