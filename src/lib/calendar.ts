import type { RecordKindDef } from '../workspaces/definitions'

/* Pure calendar helpers: no network, no React. Dates are plain YYYY-MM-DD strings so time zones can never move a deadline to another day. */

export type EventGroup = 'meeting' | 'deadline' | 'task' | 'work'
export interface CalendarEvent { id: string; date: string; time?: string; title: string; detail?: string; group: EventGroup; href?: string }

export const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
export const dateOf = (iso: string) => iso.slice(0, 10)

/** Weeks (Mon-first) covering a month. Days outside the month are included so every row is full; they carry `inMonth: false`. */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: { date: string; inMonth: boolean }[] = []
  for (let i = -lead; i < Math.ceil((lead + days) / 7) * 7 - lead; i++) {
    const d = new Date(Date.UTC(year, month, 1 + i))
    cells.push({ date: isoDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), inMonth: d.getUTCMonth() === month })
  }
  const weeks: { date: string; inMonth: boolean }[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of [...events].sort((a, b) => (a.date + (a.time ?? '99')).localeCompare(b.date + (b.time ?? '99')) || a.title.localeCompare(b.title))) {
    const list = map.get(e.date) ?? []
    list.push(e); map.set(e.date, list)
  }
  return map
}

export const monthRange = (year: number, month: number) => ({ from: isoDate(year, month, 1), to: isoDate(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) })

export interface CalendarRecord { id: string; kind: string; title: string; stage: string; fields: Record<string, unknown>; due_date: string | null }

/**
 * Calendar events from records: each kind's date fields, plus the due date where the kind uses one. Finished items are left
 * off, except domains, whose expiry matters until they are retired. `lookup` and `closed` are injected so this file stays
 * free of app imports.
 */
export function eventsFromRecords(
  records: CalendarRecord[], from: string, to: string,
  lookup: (kind: string) => RecordKindDef | undefined, closed: (kind: RecordKindDef, stage: string) => boolean,
): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const r of records) {
    const def = lookup(r.kind)
    if (!def || (closed(def, r.stage) && def.kind !== 'domain')) continue
    const push = (date: unknown, label: string, suffix: string) => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return
      out.push({ id: `${r.id}:${suffix}`, date, title: r.title, detail: `${def.label} · ${label}`, group: 'work' })
    }
    for (const c of def.calendar ?? []) push(r.fields?.[c.field], c.label, c.field)
    if (def.due) push(r.due_date, 'Due', 'due')
  }
  return out
}
