import { Fragment, useMemo, useState } from 'react'
import { CodeArea, Field, KV, Notice, Pane, ToolGrid, Toggle } from '../toolkit'

const MAX_TEXT = 20_000
const MAX_MATCHES = 500
const FLAG_INFO: [string, string][] = [['g', 'global'], ['i', 'ignore case'], ['m', 'multiline'], ['s', 'dot matches newline'], ['u', 'unicode']]

export default function RegexTool() {
  const [pattern, setPattern] = useState('(?<user>[\\w.+-]+)@(?<host>[\\w-]+\\.[\\w.-]+)')
  const [flags, setFlags] = useState<Record<string, boolean>>({ g: true, i: true, m: false, s: false, u: false })
  const [text, setText] = useState('Reach us at hello@codex.dev or careers@codex.dev — not at someone@localhost.')

  const flagString = Object.entries(flags).filter(([, on]) => on).map(([f]) => f).join('')
  const tooLong = text.length > MAX_TEXT

  const result = useMemo(() => {
    if (!pattern) return { kind: 'empty' as const }
    if (tooLong) return { kind: 'toolong' as const }
    try {
      // matchAll requires the g flag; we always scan globally and only differ in display.
      const re = new RegExp(pattern, flagString.includes('g') ? flagString : flagString + 'g')
      const matches: { index: number; text: string; groups: (string | undefined)[]; named: Record<string, string> }[] = []
      for (const m of text.matchAll(re)) {
        matches.push({ index: m.index ?? 0, text: m[0], groups: m.slice(1), named: { ...(m.groups ?? {}) } })
        if (matches.length >= MAX_MATCHES) break
      }
      return { kind: 'ok' as const, matches: flagString.includes('g') ? matches : matches.slice(0, 1) }
    } catch (e) {
      return { kind: 'error' as const, message: e instanceof Error ? e.message : 'Invalid pattern' }
    }
  }, [pattern, flagString, text, tooLong])

  // Split the text into plain / matched segments for the highlighted preview.
  const segments = useMemo(() => {
    if (result.kind !== 'ok') return [{ text, hit: false }]
    const out: { text: string; hit: boolean }[] = []
    let cursor = 0
    for (const m of result.matches) {
      if (m.text.length === 0) continue
      if (m.index > cursor) out.push({ text: text.slice(cursor, m.index), hit: false })
      out.push({ text: m.text, hit: true })
      cursor = m.index + m.text.length
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
    return out
  }, [result, text])

  return (
    <ToolGrid>
      <Pane title="Pattern">
        <Field label="Regular expression">
          <input className="mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. \d{3}-\d{4}" spellCheck={false} />
        </Field>
        <div className="tk-row">{FLAG_INFO.map(([f, name]) => <Toggle key={f} checked={flags[f]} onChange={(v) => setFlags({ ...flags, [f]: v })}><span className="mono">{f}</span> {name}</Toggle>)}</div>
        <CodeArea label="Test text" value={text} onChange={setText} rows={9} placeholder="Text to test against" />
        {tooLong && <Notice tone="warn">Test text is limited to {MAX_TEXT.toLocaleString()} characters so a heavy pattern can't freeze this tab.</Notice>}
        {result.kind === 'error' && <Notice tone="error">{result.message}</Notice>}
        <Notice>Uses your browser's JavaScript regex engine, so results match what your front-end and Node code will do.</Notice>
      </Pane>
      <Pane title={result.kind === 'ok' ? `${result.matches.length}${result.matches.length >= MAX_MATCHES ? '+' : ''} match${result.matches.length === 1 ? '' : 'es'}` : 'Matches'}>
        <div className="mono" style={{ padding: 12, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-default)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-secondary)', minHeight: 72 }}>
          {segments.map((s, i) => s.hit ? <mark key={i} style={{ background: 'var(--accent-soft-strong)', color: 'var(--text-primary)', borderRadius: 3, boxShadow: '0 0 0 1px var(--border-accent)' }}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>)}
        </div>
        {result.kind === 'ok' && result.matches.length === 0 && <p className="ctf-muted">No matches.</p>}
        {result.kind === 'ok' && result.matches.slice(0, 25).map((m, i) => (
          <KV key={i} rows={[[`Match ${i + 1}`, m.text || '(empty)'], ['Index', String(m.index)], ...Object.entries(m.named).map(([k, v]) => [k, v ?? '—'] as [string, string]), ...(Object.keys(m.named).length === 0 ? m.groups.map((g, gi) => [`Group ${gi + 1}`, g ?? '—'] as [string, string]) : [])]} />
        ))}
      </Pane>
    </ToolGrid>
  )
}
