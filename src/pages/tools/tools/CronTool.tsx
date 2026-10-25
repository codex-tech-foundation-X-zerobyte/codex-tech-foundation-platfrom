import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui'
import { Field, KV, Notice, Pane, ToolGrid } from '../toolkit'

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
] as const

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const PRESETS: [string, string][] = [
  ['Every minute', '* * * * *'],
  ['Every 15 minutes', '*/15 * * * *'],
  ['Hourly', '0 * * * *'],
  ['Weekdays at 09:00', '0 9 * * 1-5'],
  ['Midnight on the 1st', '0 0 1 * *'],
]

interface Parsed { sets: Set<number>[]; wild: boolean[] }

function parseField(raw: string, index: number): { set: Set<number>; wild: boolean } {
  const { min, max } = FIELDS[index]
  const names = index === 3 ? MONTHS : index === 4 ? DAYS : null
  const num = (token: string): number => {
    const lower = token.toLowerCase()
    if (names && names.includes(lower)) return names.indexOf(lower) + (index === 3 ? 1 : 0)
    if (!/^\d+$/.test(token)) throw new Error(`"${token}" is not a valid ${FIELDS[index].name} value`)
    const n = Number(token)
    if (index === 4 && n === 7) return 0 // 7 is an alias for Sunday
    if (n < min || n > max) throw new Error(`${n} is outside ${min}–${max} for ${FIELDS[index].name}`)
    return n
  }
  const set = new Set<number>()
  for (const part of raw.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step "${stepRaw}" in ${FIELDS[index].name}`)
    let lo: number, hi: number
    if (range === '*') { lo = min; hi = max }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = num(a); hi = num(b) }
    else { lo = num(range); hi = stepRaw === undefined ? lo : max }
    if (lo > hi) throw new Error(`Range ${range} runs backwards in ${FIELDS[index].name}`)
    for (let v = lo; v <= hi; v += step) set.add(v)
  }
  return { set, wild: raw === '*' || raw.startsWith('*/') }
}

function parseCron(expr: string): Parsed {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('A cron expression has exactly 5 fields: minute hour day-of-month month day-of-week')
  const parsed = parts.map((p, i) => parseField(p, i))
  return { sets: parsed.map((p) => p.set), wild: parsed.map((p) => p.wild) }
}

function matchesDay(p: Parsed, d: Date): boolean {
  const domOk = p.sets[2].has(d.getDate())
  const dowOk = p.sets[4].has(d.getDay())
  // Standard cron: when BOTH day fields are restricted, a day matches if EITHER does.
  if (!p.wild[2] && !p.wild[4]) return domOk || dowOk
  return domOk && dowOk
}

function nextRuns(p: Parsed, count: number): Date[] {
  const runs: Date[] = []
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = Date.now() + 4 * 366 * 86_400_000
  while (runs.length < count && d.getTime() < limit) {
    if (!p.sets[3].has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue }
    if (!matchesDay(p, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue }
    if (!p.sets[1].has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue }
    if (!p.sets[0].has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1); continue }
    runs.push(new Date(d))
    d.setMinutes(d.getMinutes() + 1)
  }
  return runs
}

function describeField(raw: string, index: number): string {
  if (raw === '*') return ''
  const label = (v: string) => (index === 4 ? DAY_NAMES[Number(v) % 7] ?? v : index === 3 ? MONTH_NAMES[Number(v) - 1] ?? v : v)
  if (raw.startsWith('*/')) return `every ${raw.slice(2)} ${FIELDS[index].name}s`
  return raw.split(',').map((part) => (part.includes('-') ? part.split('-').map(label).join(' through ') : label(part))).join(', ')
}

function describe(expr: string): string {
  const [min, hour, dom, mon, dow] = expr.trim().split(/\s+/)
  const bits: string[] = []
  if (min === '*' && hour === '*') bits.push('Every minute')
  else if (min.startsWith('*/') && hour === '*') bits.push(`Every ${min.slice(2)} minutes`)
  else if (/^\d+$/.test(min) && hour === '*') bits.push(`At minute ${min} of every hour`)
  else if (/^\d+$/.test(min) && /^\d+$/.test(hour)) bits.push(`At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else bits.push(`At minute ${describeField(min, 0) || 'every'}, hour ${describeField(hour, 1) || 'every'}`)
  const d = describeField(dom, 2); if (d) bits.push(`on day-of-month ${d}`)
  const m = describeField(mon, 3); if (m) bits.push(`in ${m}`)
  const w = describeField(dow, 4); if (w) bits.push(`on ${w}`)
  return bits.join(' ') + '.'
}

export default function CronTool() {
  const [expr, setExpr] = useState('0 9 * * 1-5')

  const result = useMemo(() => {
    try {
      const parsed = parseCron(expr)
      return { ok: true as const, text: describe(expr), runs: nextRuns(parsed, 6) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid cron expression' }
    }
  }, [expr])

  return (
    <ToolGrid>
      <Pane title="Expression">
        <Field label="minute · hour · day of month · month · day of week">
          <input className="mono" value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} style={{ fontSize: 16, height: 44, letterSpacing: '0.04em' }} />
        </Field>
        <div className="tk-row">
          {PRESETS.map(([label, value]) => <Button key={value} variant="secondary" size="sm" onClick={() => setExpr(value)}>{label}</Button>)}
        </div>
        {!result.ok && <Notice tone="error">{result.error}</Notice>}
        <Notice>Supports <span className="mono">*</span>, lists <span className="mono">1,15</span>, ranges <span className="mono">1-5</span>, steps <span className="mono">*/10</span>, and names like <span className="mono">mon</span> or <span className="mono">jan</span>.</Notice>
      </Pane>
      <Pane title="Meaning">
        {result.ok ? (
          <>
            <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>{result.text}</p>
            <h4 style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Next runs (your local time)</h4>
            {result.runs.length === 0 ? <p className="ctf-muted">This expression never fires in the next four years.</p> : (
              <KV rows={result.runs.map((d, i) => [`#${i + 1}`, d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })])} />
            )}
          </>
        ) : <p className="ctf-muted">Fix the expression to see what it does.</p>}
      </Pane>
    </ToolGrid>
  )
}
