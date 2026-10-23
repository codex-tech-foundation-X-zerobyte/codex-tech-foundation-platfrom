import { useMemo, useState } from 'react'
import { CodeArea, Notice, Output, Pane, Segmented, ToolGrid, Toggle } from '../toolkit'

function encodeUtf8(text: string, urlSafe: boolean): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  // Chunked: String.fromCharCode(...bytes) throws a RangeError on large inputs.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(binary)
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64
}

function decodeUtf8(b64: string): string {
  const normalized = b64.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export default function Base64Tool() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [urlSafe, setUrlSafe] = useState(false)
  const [input, setInput] = useState('Codex Tech Foundation — engineering, applied. ✓')

  const result = useMemo(() => {
    if (!input) return { text: '', error: '' }
    try {
      return { text: mode === 'encode' ? encodeUtf8(input, urlSafe) : decodeUtf8(input), error: '' }
    } catch {
      return { text: '', error: mode === 'decode' ? 'That is not valid Base64, or it does not decode to UTF-8 text.' : 'Could not encode that text.' }
    }
  }, [input, mode, urlSafe])

  return (
    <ToolGrid>
      <Pane title="Input" actions={<Segmented label="Direction" value={mode} onChange={setMode} options={[{ id: 'encode', label: 'Encode' }, { id: 'decode', label: 'Decode' }]} />}>
        <CodeArea label="Input text" value={input} onChange={setInput} rows={12} placeholder={mode === 'encode' ? 'Text to encode' : 'Base64 to decode'} />
        {mode === 'encode' && <Toggle checked={urlSafe} onChange={setUrlSafe}>URL-safe alphabet (no padding)</Toggle>}
        {result.error && <Notice tone="error">{result.error}</Notice>}
      </Pane>
      <Pane title="Output">
        <Output label="Output" value={result.text} rows={12} />
        <Notice>Handles full UTF-8, so emoji and accented characters round-trip correctly.</Notice>
      </Pane>
    </ToolGrid>
  )
}
