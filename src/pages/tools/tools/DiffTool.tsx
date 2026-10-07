import { useMemo, useState } from 'react'
import { CodeArea, Notice, Pane, ToolGrid } from '../toolkit'

const MAX_LINES = 1500

type Op = { type: 'same' | 'add' | 'del'; text: string }

/** Classic LCS line diff. O(n·m) — fine for the config/JSON/log snippets this is meant for, hence the cap. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length
  const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({ type: 'del', text: a[i++] })
    else out.push({ type: 'add', text: b[j++] })
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

const LEFT = `{\n  "name": "codex-portal",\n  "version": "1.0.0",\n  "private": true\n}`
const RIGHT = `{\n  "name": "codex-portal",\n  "version": "1.1.0",\n  "private": true,\n  "type": "module"\n}`

export default function DiffTool() {
  const [left, setLeft] = useState(LEFT)
  const [right, setRight] = useState(RIGHT)

  const result = useMemo(() => {
    const a = left.split('\n'), b = right.split('\n')
    if (a.length > MAX_LINES || b.length > MAX_LINES) return null
    const ops = diffLines(a, b)
    return { ops, added: ops.filter((o) => o.type === 'add').length, removed: ops.filter((o) => o.type === 'del').length }
  }, [left, right])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ToolGrid>
        <Pane title="Original"><CodeArea label="Original text" value={left} onChange={setLeft} rows={10} wrap={false} /></Pane>
        <Pane title="Changed"><CodeArea label="Changed text" value={right} onChange={setRight} rows={10} wrap={false} /></Pane>
      </ToolGrid>
      <Pane title={result ? `Differences — ${result.added} added, ${result.removed} removed` : 'Differences'}>
        {!result && <Notice tone="warn">Each side is limited to {MAX_LINES.toLocaleString()} lines.</Notice>}
        {result && result.added + result.removed === 0 && <Notice tone="ok">The two texts are identical.</Notice>}
        {result && (
          <div className="mono" style={{ borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-2)', overflow: 'auto', maxHeight: 420, fontSize: 12.5 }}>
            {result.ops.map((op, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '1px 12px', whiteSpace: 'pre', background: op.type === 'add' ? 'var(--success-soft)' : op.type === 'del' ? 'var(--danger-soft)' : 'transparent', color: op.type === 'same' ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                <span aria-hidden="true" style={{ width: 12, color: op.type === 'add' ? 'var(--success-9)' : op.type === 'del' ? 'var(--danger-9)' : 'var(--text-faint)' }}>{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}</span>
                <span>{op.text || ' '}</span>
              </div>
            ))}
          </div>
        )}
      </Pane>
    </div>
  )
}
