import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button, FieldWrap, Input, SectionHeading, Tabs, Textarea } from '../components/ui'

type Tool = 'qr' | 'hash' | 'base64' | 'url' | 'uuid' | 'json'
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'qr', label: 'QR Code' },
  { id: 'hash', label: 'Hash Generator' },
  { id: 'base64', label: 'Base64' },
  { id: 'url', label: 'URL Encode/Decode' },
  { id: 'uuid', label: 'UUID Generator' },
  { id: 'json', label: 'JSON Formatter' },
]

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      disabled={!value}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export function DevToolsPage() {
  const [tool, setTool] = useState<Tool>('qr')

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHeading eyebrow="Developer Tools" title="Utilities" description="Small, self-contained tools for everyday work." />
      <Tabs tabs={TOOLS} active={tool} onChange={(id) => setTool(id as Tool)} />
      <div style={{ marginTop: 20 }}>
        {tool === 'qr' && <QrTool />}
        {tool === 'hash' && <HashTool />}
        {tool === 'base64' && <Base64Tool />}
        {tool === 'url' && <UrlTool />}
        {tool === 'uuid' && <UuidTool />}
        {tool === 'json' && <JsonTool />}
      </div>
    </div>
  )
}

function QrTool() {
  const [text, setText] = useState('')
  // Real QR encoding (the actual bit-matrix + Reed-Solomon error
  // correction) is genuinely non-trivial to implement correctly from
  // scratch, and this project has no verified QR library dependency to
  // build against. Rather than fake it or half-implement something that
  // could silently produce an unscannable code, this uses a real, public
  // QR image service — disclosed plainly, not hidden. This means it needs
  // network access to api.qrserver.com to render; it will not work
  // offline. If that dependency is ever unacceptable, the fix is adding a
  // verified QR-encoding library, not pretending this already does it locally.
  const url = text.trim() ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text.trim())}` : null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FieldWrap label="Text or URL" htmlFor="qr-input" hint="Rendered via a public QR image service (api.qrserver.com) — requires network access, not generated locally">
        <Input id="qr-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://example.com" />
      </FieldWrap>
      {url && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <img src={url} alt="Generated QR code" width={220} height={220} style={{ borderRadius: 8, border: '1px solid var(--border-subtle)' }} />
          <a href={url} target="_blank" rel="noreferrer" className="text-link">Open full size</a>
        </div>
      )}
    </div>
  )
}

async function sha(algo: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512', text: string) {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest(algo, data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function HashTool() {
  const [input, setInput] = useState('')
  const [hashes, setHashes] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!input) { setHashes({}); return }
    void (async () => {
      const [sha1, sha256, sha384, sha512] = await Promise.all([
        sha('SHA-1', input), sha('SHA-256', input), sha('SHA-384', input), sha('SHA-512', input),
      ])
      setHashes({ 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 })
    })()
  }, [input])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FieldWrap label="Text" htmlFor="hash-input" hint="Computed with the browser's real SubtleCrypto API — nothing sent over the network. MD5 is intentionally not offered: it isn't supported by SubtleCrypto and is a deprecated, broken algorithm not worth a hand-rolled implementation.">
        <Textarea id="hash-input" rows={3} value={input} onChange={(e) => setInput(e.target.value)} />
      </FieldWrap>
      {Object.entries(hashes).map(([algo, value]) => (
        <div key={algo} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.65 }}>{algo}</div>
            <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{value}</code>
          </div>
          <CopyButton value={value} />
        </div>
      ))}
    </div>
  )
}

function Base64Tool() {
  const [plain, setPlain] = useState('')
  const [encoded, setEncoded] = useState('')
  const [error, setError] = useState('')

  const encode = (text: string) => {
    setPlain(text)
    try {
      const bytes = new TextEncoder().encode(text)
      let binary = ''
      bytes.forEach((b) => { binary += String.fromCharCode(b) })
      setEncoded(btoa(binary))
      setError('')
    } catch {
      setError('Could not encode this text.')
    }
  }
  const decode = (b64: string) => {
    setEncoded(b64)
    try {
      const binary = atob(b64)
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      setPlain(new TextDecoder().decode(bytes))
      setError('')
    } catch {
      setError('Not valid Base64.')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FieldWrap label="Plain text" htmlFor="b64-plain">
        <Textarea id="b64-plain" rows={3} value={plain} onChange={(e) => encode(e.target.value)} />
      </FieldWrap>
      <FieldWrap label="Base64" htmlFor="b64-encoded">
        <Textarea id="b64-encoded" rows={3} value={encoded} onChange={(e) => decode(e.target.value)} />
      </FieldWrap>
      {error && <p className="ctf-form-error">{error}</p>}
      <div><CopyButton value={encoded} /></div>
    </div>
  )
}

function UrlTool() {
  const [plain, setPlain] = useState('')
  const [encoded, setEncoded] = useState('')

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FieldWrap label="Plain text" htmlFor="url-plain">
        <Textarea id="url-plain" rows={3} value={plain} onChange={(e) => { setPlain(e.target.value); setEncoded(encodeURIComponent(e.target.value)) }} />
      </FieldWrap>
      <FieldWrap label="URL-encoded" htmlFor="url-encoded">
        <Textarea id="url-encoded" rows={3} value={encoded} onChange={(e) => { setEncoded(e.target.value); try { setPlain(decodeURIComponent(e.target.value)) } catch { /* leave plain as-is on invalid sequence */ } }} />
      </FieldWrap>
      <div><CopyButton value={encoded} /></div>
    </div>
  )
}

function UuidTool() {
  const [uuids, setUuids] = useState<string[]>([crypto.randomUUID()])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Button variant="secondary" onClick={() => setUuids((prev) => [crypto.randomUUID(), ...prev].slice(0, 20))}>Generate new</Button>
      <div style={{ display: 'grid', gap: 6 }}>
        {uuids.map((id) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, fontSize: 13 }}>{id}</code>
            <CopyButton value={id} />
          </div>
        ))}
      </div>
    </div>
  )
}

function JsonTool() {
  const [input, setInput] = useState('')
  const [formatted, setFormatted] = useState('')
  const [error, setError] = useState('')

  const format = (text: string) => {
    setInput(text)
    if (!text.trim()) { setFormatted(''); setError(''); return }
    try {
      setFormatted(JSON.stringify(JSON.parse(text), null, 2))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
      setFormatted('')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FieldWrap label="JSON input" htmlFor="json-input">
        <Textarea id="json-input" rows={5} value={input} onChange={(e) => format(e.target.value)} placeholder='{"key": "value"}' />
      </FieldWrap>
      {error && <p className="ctf-form-error">{error}</p>}
      {formatted && (
        <FieldWrap label="Formatted" htmlFor="json-output">
          <Textarea id="json-output" rows={8} value={formatted} readOnly />
        </FieldWrap>
      )}
      {formatted && <div><CopyButton value={formatted} /></div>}
    </div>
  )
}
