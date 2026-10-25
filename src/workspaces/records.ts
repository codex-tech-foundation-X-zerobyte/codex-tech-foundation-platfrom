import { isClosed, type FieldDef, type RecordKindDef, type Source } from './definitions'

/* Pure helpers for department records (no React, no network) so the rules can be tested on their own. */

export type FieldValues = Record<string, string>

/** Fields shown for the current values: a field with `showWhen` only appears when its trigger field matches. */
export function visibleFields(kind: RecordKindDef, values: FieldValues): FieldDef[] {
  return kind.fields.filter((f) => !f.showWhen || f.showWhen.in.includes(values[f.showWhen.key] ?? ''))
}

/** What gets saved: only visible, non-empty fields, with numbers stored as numbers. Hidden fields never leak into the record. */
export function cleanFields(kind: RecordKindDef, values: FieldValues): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const f of visibleFields(kind, values)) {
    const raw = (values[f.key] ?? '').trim()
    if (!raw) continue
    if (f.type === 'number') { const n = Number(raw); if (Number.isFinite(n)) out[f.key] = n } else out[f.key] = raw
  }
  return out
}

/** The first thing wrong with a record, in plain words, or null. */
export function recordProblem(kind: RecordKindDef, title: string, values: FieldValues): string | null {
  if (!title.trim()) return `Give the ${kind.label.toLowerCase()} a title.`
  if (title.trim().length > 200) return 'Keep the title under 200 characters.'
  for (const f of visibleFields(kind, values)) {
    const v = (values[f.key] ?? '').trim()
    if (f.required && !v) return `${f.label} is required.`
    if (v && f.type === 'url' && !/^https:\/\/\S+$/i.test(v)) return `${f.label} must be a link starting with https://`
    if (v && f.type === 'number' && !Number.isFinite(Number(v))) return `${f.label} must be a number.`
    if (v && f.type === 'select' && f.options && !f.options.includes(v)) return `${f.label} has an unknown value.`
  }
  return null
}

export interface RecordLike { kind: string; stage: string; fields: Record<string, unknown>; created_at?: string }

export const matchesWhere = (rec: RecordLike, where?: Record<string, string>) => !where || Object.entries(where).every(([k, v]) => rec.fields?.[k] === v)

/** Values for an edit form, from a saved record. */
export function toFormValues(fields: Record<string, unknown>): FieldValues {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/** Days from `today` to an ISO date (negative when past). Date-only, so time zones never shift the day. */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number)
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((a - b) / 86_400_000)
}

export function expiryLabel(iso: string | undefined, today: Date = new Date()): { text: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (!iso) return null
  const n = daysUntil(iso, today)
  if (n < 0) return { text: `Expired ${-n} day${n === -1 ? '' : 's'} ago`, tone: 'danger' }
  if (n === 0) return { text: 'Expires today', tone: 'danger' }
  if (n <= 30) return { text: `Expires in ${n} day${n === 1 ? '' : 's'}`, tone: 'warning' }
  return { text: `Expires in ${n} days`, tone: 'neutral' }
}

/* ---- dashboard numbers ------------------------------------------------------------------------------------------------ */

export interface StatsData {
  tasks: { status: string; stage: string | null }[]
  records: RecordLike[]
  /** New leads in the last N days, keyed by N. */
  leads: Record<number, number>
  /** Only loaded for Finance / Customer Service, whose cards count them. */
  funds?: { status: string }[]
  tickets?: { status: string; due_at: string; assignee_id: string | null; first_response_at: string | null }[]
}
export interface Resolved { value: number | null; note?: string }

/** Turn a card/metric source into a number from rows the viewer can really see. `null` means "nothing recorded yet", never zero-by-default. */
export function resolveSource(kinds: RecordKindDef[], source: Source, data: StatsData): Resolved {
  switch (source.type) {
    case 'tasks': {
      const open = data.tasks.filter((t) => t.status !== 'done')
      return { value: source.filter === 'stage' ? open.filter((t) => t.stage === source.stage).length : open.length }
    }
    case 'records': {
      const kind = kinds.find((k) => k.kind === source.kind)
      const mine = data.records.filter((r) => r.kind === source.kind && matchesWhere(r, source.where))
      if (source.stage) return { value: mine.filter((r) => r.stage === source.stage).length }
      if (source.all || !kind) return { value: mine.length }
      return { value: mine.filter((r) => !isClosed(kind, r.stage)).length }
    }
    case 'record_field': {
      const latest = data.records
        .filter((r) => r.kind === source.kind && typeof r.fields?.[source.field] === 'number')
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
      if (!latest) return { value: null }
      const when = latest.created_at ? new Date(latest.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
      const src = typeof latest.fields.source === 'string' ? latest.fields.source : ''
      return { value: latest.fields[source.field] as number, note: [src, when && `entered ${when}`].filter(Boolean).join(', ') }
    }
    case 'leads': return { value: data.leads[source.days ?? 0] ?? null }
    case 'funds': {
      if (!data.funds) return { value: null }
      const map = { awaiting_finance: ['finance_review'], awaiting_department: ['department_review'], awaiting_super_admin: ['awaiting_super_admin'], approved_unpaid: ['approved', 'payment_processing', 'payment_failed'], needs_reconciliation: ['paid', 'reconciliation_required'] }[source.filter]
      return { value: data.funds.filter((f) => map.includes(f.status)).length }
    }
    case 'tickets': {
      if (!data.tickets) return { value: null }
      const live = data.tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed')
      switch (source.filter) {
        case 'open': return { value: live.length }
        case 'unassigned': return { value: live.filter((t) => !t.assignee_id).length }
        case 'escalated': return { value: live.filter((t) => t.status === 'escalated').length }
        case 'overdue': return { value: live.filter((t) => !t.first_response_at && new Date(t.due_at).getTime() < Date.now()).length }
      }
    }
  }
}

/** Who may change a record: a Main Admin, the department's admin, whoever filed it, or whoever it is assigned to. (The database enforces the same rule.) */
export const canEditRecord = (r: { created_by: string; assignee_id: string | null }, v: { id: string | undefined; isMainAdmin: boolean; isDepartmentAdmin: boolean }) =>
  v.isMainAdmin || v.isDepartmentAdmin || (!!v.id && (r.created_by === v.id || r.assignee_id === v.id))
