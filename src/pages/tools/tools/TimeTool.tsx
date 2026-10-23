import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui'
import { Field, KV, Notice, Pane, ToolGrid } from '../toolkit'

function parseInput(raw: string): Date | null {
  const v = raw.trim()
  if (!v) return null
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v)
    // Heuristic: anything beyond ~year 5138 in seconds is really milliseconds (or microseconds).
    const ms = Math.abs(n) >= 1e14 ? n / 1000 : Math.abs(n) >= 1e11 ? n : n * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function relative(date: Date): string {
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const units: [number, string][] = [[31_536_000_000, 'year'], [2_592_000_000, 'month'], [86_400_000, 'day'], [3_600_000, 'hour'], [60_000, 'minute'], [1000, 'second']]
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      return diff >= 0 ? `in ${n} ${name}${n === 1 ? '' : 's'}` : `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

export default function TimeTool() {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)))
  const date = useMemo(() => parseInput(input), [input])

  return (
    <ToolGrid>
      <Pane title="Input" actions={<Button variant="secondary" size="sm" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>Use current time</Button>}>
        <Field label="Unix timestamp (seconds or milliseconds) or any date string">
          <input className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="1700000000  ·  2026-09-28T12:00:00Z  ·  Sep 28 2026" spellCheck={false} />
        </Field>
        {input.trim() && !date && <Notice tone="error">That doesn't look like a date or a Unix timestamp.</Notice>}
        <Notice>Numbers under 100 billion are read as seconds, larger ones as milliseconds. Date strings without a timezone are read in your local time.</Notice>
      </Pane>
      <Pane title="Converted">
        {date ? (
          <KV rows={[
            ['Unix (seconds)', String(Math.floor(date.getTime() / 1000))],
            ['Unix (ms)', String(date.getTime())],
            ['ISO 8601 (UTC)', date.toISOString()],
            ['Local', date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
            ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
            ['Relative', relative(date)],
            ['Day of year', String(Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000))],
          ]} />
        ) : <p className="ctf-muted">Enter a value to convert it.</p>}
      </Pane>
    </ToolGrid>
  )
}
