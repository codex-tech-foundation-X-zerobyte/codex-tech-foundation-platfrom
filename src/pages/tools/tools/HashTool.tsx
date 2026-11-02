import { useEffect, useState } from 'react'
import { CopyButton } from '../../../components/ui'
import { CodeArea, Field, Notice, Pane, ToolGrid } from '../toolkit'

const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function digest(algorithm: string, text: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  if (!secret) return toHex(await crypto.subtle.digest(algorithm, data))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, data))
}

export default function HashTool() {
  const [text, setText] = useState('hello codex')
  const [secret, setSecret] = useState('')
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALGORITHMS.map(async (a) => [a, await digest(a, text, secret)] as const))
      .then((entries) => { if (!cancelled) { setHashes(Object.fromEntries(entries)); setFailed(false) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [text, secret])

  return (
    <ToolGrid>
      <Pane title="Input">
        <CodeArea label="Text to hash" value={text} onChange={setText} rows={9} placeholder="Text to hash" />
        <Field label="HMAC secret (optional — leave empty for a plain hash)">
          <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Shared secret" autoComplete="off" spellCheck={false} />
        </Field>
        {!window.isSecureContext && <Notice tone="warn">Hashing needs a secure context. Open this app over HTTPS (or localhost).</Notice>}
      </Pane>
      <Pane title={secret ? 'HMAC digests' : 'Digests'}>
        {failed && <Notice tone="error">Your browser could not compute these digests.</Notice>}
        <div className="tk-mono-list">
          {ALGORITHMS.map((a) => (
            <div key={a} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span className="tk-tag">{a}</span>
                <CopyButton value={hashes[a] ?? ''} />
              </div>
              <code style={{ wordBreak: 'break-all', color: 'var(--text-primary)' }}>{hashes[a] ?? '…'}</code>
            </div>
          ))}
        </div>
        <Notice>SHA-1 is included for legacy checksums only — don't use it for anything security-sensitive.</Notice>
      </Pane>
    </ToolGrid>
  )
}
