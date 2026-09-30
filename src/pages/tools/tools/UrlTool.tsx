import { useMemo, useState } from 'react'
import { CodeArea, KV, Notice, Output, Pane, Segmented, ToolGrid } from '../toolkit'

export default function UrlTool() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [scope, setScope] = useState<'component' | 'full'>('component')
  const [input, setInput] = useState('https://api.codex.dev/v1/search?q=hello world&tag=a&tag=b#results')

  const converted = useMemo(() => {
    try {
      if (mode === 'encode') return { text: scope === 'component' ? encodeURIComponent(input) : encodeURI(input), error: '' }
      return { text: scope === 'component' ? decodeURIComponent(input) : decodeURI(input), error: '' }
    } catch {
      return { text: '', error: 'Malformed percent-encoding (a % is not followed by two hex digits).' }
    }
  }, [input, mode, scope])

  const parsed = useMemo(() => {
    try {
      const url = new URL(input.trim())
      return { url, params: [...url.searchParams.entries()] }
    } catch {
      return null
    }
  }, [input])

  return (
    <ToolGrid>
      <Pane
        title="Input"
        actions={
          <>
            <Segmented label="Direction" value={mode} onChange={setMode} options={[{ id: 'encode', label: 'Encode' }, { id: 'decode', label: 'Decode' }]} />
            <Segmented label="Scope" value={scope} onChange={setScope} options={[{ id: 'component', label: 'Component' }, { id: 'full', label: 'Full URL' }]} />
          </>
        }
      >
        <CodeArea label="Input" value={input} onChange={setInput} rows={5} />
        {converted.error && <Notice tone="error">{converted.error}</Notice>}
        <Output label="Converted" value={converted.text} rows={5} />
        <Notice>Component mode escapes <span className="mono">/ ? &amp; =</span> too — use it for a single value. Full URL mode leaves the URL structure intact.</Notice>
      </Pane>
      <Pane title="Parsed URL">
        {parsed ? (
          <>
            <KV rows={[
              ['Protocol', parsed.url.protocol],
              ['Host', parsed.url.hostname],
              ['Port', parsed.url.port || '(default)'],
              ['Path', parsed.url.pathname],
              ['Hash', parsed.url.hash || '—'],
            ]} />
            <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 8 }}>Query parameters ({parsed.params.length})</h4>
            {parsed.params.length === 0 ? <p className="ctf-muted">No query string.</p> : <KV rows={parsed.params.map(([k, v], i) => [`${k}${parsed.params.filter(([kk]) => kk === k).length > 1 ? ` #${parsed.params.slice(0, i).filter(([kk]) => kk === k).length + 1}` : ''}`, v || '(empty)'])} />}
          </>
        ) : (
          <Notice>Enter an absolute URL, such as <span className="mono">https://example.com/path?x=1</span>, to see it broken into parts.</Notice>
        )}
      </Pane>
    </ToolGrid>
  )
}
