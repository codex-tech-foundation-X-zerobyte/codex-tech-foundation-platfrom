import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui'
import { CodeArea, KV, Notice, Output, Pane, Segmented, ToolGrid, Toggle } from '../toolkit'

const SAMPLE = `{"project":"codex-portal","version":2,"tags":["react","supabase"],"owner":{"name":"Ada","active":true},"budget":null}`

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortDeep(v)]))
  }
  return value
}

function depthOf(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(depthOf))
  if (value && typeof value === 'object') return 1 + Math.max(0, ...Object.values(value).map(depthOf))
  return 0
}

function countKeys(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countKeys(v), 0)
  if (value && typeof value === 'object') return Object.entries(value).reduce((n, [, v]) => n + 1 + countKeys(v), 0)
  return 0
}

/** V8/JSC/SpiderMonkey all phrase JSON errors differently; pull out a position when one is present. */
function locateError(message: string, source: string): string {
  const pos = /position (\d+)/.exec(message)
  const lineCol = /line (\d+) column (\d+)/.exec(message)
  if (lineCol) return `line ${lineCol[1]}, column ${lineCol[2]}`
  if (pos) {
    const index = Number(pos[1])
    const before = source.slice(0, index)
    const line = before.split('\n').length
    const col = index - before.lastIndexOf('\n')
    return `line ${line}, column ${col}`
  }
  return ''
}

export default function JsonTool() {
  const [input, setInput] = useState(SAMPLE)
  const [mode, setMode] = useState<'format' | 'minify'>('format')
  const [indent, setIndent] = useState<'2' | '4' | 'tab'>('2')
  const [sort, setSort] = useState(false)

  const result = useMemo(() => {
    if (!input.trim()) return { kind: 'empty' as const }
    try {
      let parsed: unknown = JSON.parse(input)
      if (sort) parsed = sortDeep(parsed)
      const space = mode === 'minify' ? 0 : indent === 'tab' ? '\t' : Number(indent)
      return {
        kind: 'ok' as const,
        text: JSON.stringify(parsed, null, space),
        type: Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed,
        keys: countKeys(parsed),
        depth: depthOf(parsed),
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid JSON'
      return { kind: 'error' as const, message, where: locateError(message, input) }
    }
  }, [input, mode, indent, sort])

  return (
    <ToolGrid>
      <Pane title="Input" actions={<Button variant="ghost" size="sm" onClick={() => setInput(SAMPLE)}>Load sample</Button>}>
        <CodeArea label="JSON input" value={input} onChange={setInput} placeholder='Paste JSON here, e.g. {"hello":"world"}' rows={18} />
        {result.kind === 'error' && (
          <Notice tone="error"><strong>Invalid JSON{result.where ? ` at ${result.where}` : ''}.</strong> {result.message}</Notice>
        )}
        {result.kind === 'ok' && <Notice tone="ok">Valid JSON.</Notice>}
      </Pane>
      <Pane
        title="Result"
        actions={
          <>
            <Segmented label="Output mode" value={mode} onChange={setMode} options={[{ id: 'format', label: 'Format' }, { id: 'minify', label: 'Minify' }]} />
            {mode === 'format' && <Segmented label="Indent" value={indent} onChange={setIndent} options={[{ id: '2', label: '2' }, { id: '4', label: '4' }, { id: 'tab', label: 'Tab' }]} />}
          </>
        }
      >
        <Toggle checked={sort} onChange={setSort}>Sort keys alphabetically</Toggle>
        <Output label="Formatted JSON" value={result.kind === 'ok' ? result.text : ''} rows={14} placeholder={result.kind === 'error' ? 'Fix the error to see output' : 'Output appears here'} />
        {result.kind === 'ok' && <KV rows={[['Root type', result.type], ['Keys', String(result.keys)], ['Max depth', String(result.depth)], ['Size', `${new Blob([result.text]).size} bytes`]]} />}
      </Pane>
    </ToolGrid>
  )
}
