/**
 * Super Monitor: labels, the incident lifecycle, deadline wording and key generation. Pure, so it is unit-tested without a browser.
 * The lifecycle table below MUST equal the one in public.monitor_set_incident_status (tests/monitorRules.test.mjs compares them),
 * so the screen only ever offers moves the database will accept.
 */
export type Health = 'healthy' | 'degraded' | 'down' | 'unknown' | 'paused'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'fix_in_progress' | 'monitoring' | 'resolved' | 'reopened'
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export const HEALTH_LABEL: Record<Health, string> = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'No data yet', paused: 'Paused' }
export const HEALTH_TONE: Record<Health, Tone> = { healthy: 'success', degraded: 'warning', down: 'danger', unknown: 'neutral', paused: 'neutral' }
/** Worst first, so a problem is never buried under healthy projects. */
export const HEALTH_ORDER: Health[] = ['down', 'degraded', 'unknown', 'healthy', 'paused']
export const healthRank = (h: Health) => HEALTH_ORDER.indexOf(h)

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
export const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' }
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']
/** Minutes allowed to acknowledge, by severity (the database uses the same numbers). */
export const ACK_MINUTES: Record<Severity, number> = { critical: 5, high: 15, medium: 60, low: 240 }

export const STATUS_LABEL: Record<IncidentStatus, string> = { open: 'Open', acknowledged: 'Acknowledged', investigating: 'Investigating', fix_in_progress: 'Fix in progress', monitoring: 'Monitoring', resolved: 'Resolved', reopened: 'Reopened' }
export const STATUS_TONE: Record<IncidentStatus, Tone> = { open: 'danger', acknowledged: 'warning', investigating: 'accent', fix_in_progress: 'accent', monitoring: 'warning', resolved: 'success', reopened: 'danger' }

export const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['acknowledged', 'investigating', 'resolved'],
  acknowledged: ['investigating', 'fix_in_progress', 'resolved'],
  investigating: ['fix_in_progress', 'monitoring', 'resolved'],
  fix_in_progress: ['investigating', 'monitoring', 'resolved'],
  monitoring: ['investigating', 'resolved', 'reopened'],
  resolved: ['reopened'],
  reopened: ['acknowledged', 'investigating', 'fix_in_progress', 'resolved'],
}
export const nextSteps = (s: IncidentStatus): IncidentStatus[] => TRANSITIONS[s] ?? []
export const isLive = (s: IncidentStatus) => s !== 'resolved'
export const MIN_ROOT_CAUSE = 10

export const NOTE_KIND_LABEL: Record<string, string> = { note: 'Note', status: 'Status', assignment: 'Assignment', escalation: 'Escalation', system: 'Automatic', root_cause: 'Root cause', link: 'Link', severity: 'Severity' }
export const SOURCE_LABEL: Record<string, string> = { auto_errors: 'Repeated errors', auto_down: 'No heartbeat', manual: 'Opened by hand' }

const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h}h ${m % 60}m`
}

/** The acknowledgement clock of an incident nobody has taken yet. */
export function ackLabel(i: { status: IncidentStatus; ack_due_at: string | null; escalation_level: number }, now = Date.now()): { text: string; tone: Tone } | null {
  if ((i.status !== 'open' && i.status !== 'reopened') || !i.ack_due_at) return null
  const ms = new Date(i.ack_due_at).getTime() - now
  const level = i.escalation_level > 0 ? ` · escalated to level ${i.escalation_level}` : ''
  return ms < 0 ? { text: `Unacknowledged for ${span(-ms)}${level}`, tone: 'danger' } : { text: `Acknowledge within ${span(ms)}${level}`, tone: ms < 120_000 ? 'warning' : 'neutral' }
}

/** "p95 ≤ 250 ms". The database reports the top of the band holding the 95th percentile; 10000 means slower than 5 s. */
export function p95Label(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms >= 10000) return 'slower than 5 s'
  return ms >= 1000 ? `≤ ${ms / 1000} s` : `≤ ${ms} ms`
}

export function heartbeatLabel(lastIso: string | null, intervalSeconds: number, now = Date.now()): { text: string; tone: Tone } {
  if (!lastIso) return { text: 'No heartbeat yet', tone: 'neutral' }
  const age = now - new Date(lastIso).getTime()
  const late = age > intervalSeconds * 3 * 1000
  return { text: `${span(age)} ago`, tone: late ? 'danger' : age > intervalSeconds * 1000 * 1.5 ? 'warning' : 'success' }
}

/** A new SDK key: ctfm_ + 48 hex. Made in the browser; only its hash is sent. Shown once. */
export function newMonitorKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const key = `ctfm_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  return { key, prefix: key.slice(0, 9) }
}

export const KEY_SCOPE_LABEL: Record<string, string> = { events: 'Errors, messages and latency', heartbeat: 'Heartbeats' }

/** What each kind of figure on the Super Dashboard means. */
export const BASIS_LABEL: Record<string, { label: string; hint: string }> = {
  actual: { label: 'Paid', hint: 'Money that has been paid out.' },
  reconciled: { label: 'Reconciled', hint: 'Paid and matched to a statement.' },
  pending: { label: 'Pending', hint: 'Waiting for a decision, or approved and not yet paid.' },
  estimated: { label: 'Estimated', hint: 'The amount recorded on the renewal. The real bill may differ.' },
}

/** Bar heights (0-100) for a small chart. A flat series draws flat bars, never a division by zero. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values)
  return values.map((v) => (max === 0 ? 0 : Math.max(v > 0 ? 6 : 0, Math.round((v / max) * 100))))
}

/** The last `hours` hourly buckets, oldest first, with hours that had no events filled in as zeros. */
export function fillHours<T extends { bucket: string }>(rows: T[], hours: number, zero: Omit<T, 'bucket'>, now = Date.now()): T[] {
  const byHour = new Map(rows.map((r) => [Math.floor(new Date(r.bucket).getTime() / 3_600_000), r]))
  const current = Math.floor(now / 3_600_000)
  return Array.from({ length: hours }, (_, i) => {
    const h = current - (hours - 1 - i)
    return byHour.get(h) ?? ({ ...zero, bucket: new Date(h * 3_600_000).toISOString() } as T)
  })
}

export function ingestSnippet(endpoint: string): string {
  return `import { createMonitor } from './super-monitor/index.mjs'

const monitor = createMonitor({
  endpoint: '${endpoint}',
  key: process.env.MONITOR_KEY,        // the ctfm_… key shown once when it was created
  environment: 'production',
  release: '1.0.0',
})
monitor.start()                          // heartbeats and global error handlers
// monitor.captureError(err, { route: '/checkout' })
// monitor.latency('/api/users', 120, 200)`
}

/** "Portfolio site (v2)!" becomes "portfolio-site-v2": the form the database accepts (lowercase letters, digits, single dashes, 40 characters). */
export const slugFromName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
