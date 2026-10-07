import { useMemo, useState } from 'react'
import { useNow } from '../../../hooks/useNow'
import { CodeArea, KV, Notice, Pane, ToolGrid } from '../toolkit'

function b64urlDecode(part: string): string {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

function relative(seconds: number, now: number): string {
  const diff = seconds * 1000 - now
  const abs = Math.abs(diff)
  const units: [number, string][] = [[86_400_000, 'day'], [3_600_000, 'hour'], [60_000, 'minute'], [1000, 'second']]
  for (const [ms, name] of units) {
    if (abs >= ms || name === 'second') {
      const n = Math.round(abs / ms)
      return diff >= 0 ? `in ${n} ${name}${n === 1 ? '' : 's'}` : `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return ''
}

// A syntactically valid, harmless demo token (HS256, fake secret, no real data).
const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJ3b3JrZXIiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.c2lnbmF0dXJlLW5vdC12ZXJpZmllZA'

export default function JwtTool() {
  const [token, setToken] = useState(SAMPLE)
  const now = useNow()

  const decoded = useMemo(() => {
    const raw = token.trim().replace(/^Bearer\s+/i, '')
    if (!raw) return null
    const parts = raw.split('.')
    if (parts.length !== 3) return { error: 'A JWT has three dot-separated parts (header.payload.signature).' }
    try {
      const header = JSON.parse(b64urlDecode(parts[0])) as Record<string, unknown>
      const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>
      return { header, payload, signature: parts[2] }
    } catch {
      return { error: 'The header or payload is not valid Base64URL-encoded JSON.' }
    }
  }, [token])

  const claims = useMemo(() => {
    if (!decoded || 'error' in decoded) return []
    const rows: [string, string][] = []
    for (const key of ['iat', 'nbf', 'exp'] as const) {
      const v = decoded.payload[key]
      if (typeof v === 'number') rows.push([key === 'iat' ? 'Issued' : key === 'nbf' ? 'Not before' : 'Expires', `${new Date(v * 1000).toISOString()} (${relative(v, now)})`])
    }
    return rows
  }, [decoded, now])

  const exp = decoded && !('error' in decoded) && typeof decoded.payload.exp === 'number' ? decoded.payload.exp : null

  return (
    <ToolGrid>
      <Pane title="Token">
        <CodeArea label="JWT" value={token} onChange={setToken} rows={9} placeholder="Paste a JWT (with or without the Bearer prefix)" />
        <Notice tone="warn">Decoded entirely in your browser. This tool <strong>does not verify the signature</strong> — never trust a decoded token's claims without verifying it server-side.</Notice>
        {decoded && 'error' in decoded && <Notice tone="error">{decoded.error}</Notice>}
        {exp !== null && (exp * 1000 < now ? <Notice tone="error">This token has expired.</Notice> : <Notice tone="ok">This token has not expired.</Notice>)}
      </Pane>
      <Pane title="Decoded">
        {decoded && !('error' in decoded) ? (
          <>
            <KV rows={[['Algorithm', String(decoded.header.alg ?? '—')], ['Type', String(decoded.header.typ ?? '—')], ...claims, ['Signature', `${decoded.signature.length} chars (unverified)`]]} />
            <CodeArea label="Header" value={JSON.stringify(decoded.header, null, 2)} readOnly rows={4} />
            <CodeArea label="Payload" value={JSON.stringify(decoded.payload, null, 2)} readOnly rows={10} />
          </>
        ) : (
          <p className="ctf-muted">Paste a token to see its header and claims.</p>
        )}
      </Pane>
    </ToolGrid>
  )
}
