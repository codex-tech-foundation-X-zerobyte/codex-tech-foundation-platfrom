/**
 * Super Monitor: what an event looks like on the wire, and the checks done before it reaches the database. Pure (no Deno imports) so
 * Node tests can load it. The database does its own validation, redaction and truncation as well: this layer exists to refuse junk
 * cheaply, to give the SDK a precise reason, and to keep a hostile body from costing a database call.
 *
 * Redaction of secrets is NOT done here. It happens once, in public.monitor_redact(), so that every path into the table is covered.
 */
export { sha256Hex } from './supportIntake.ts'

export const MONITOR_KEY_SHAPE = /^ctfm_[0-9a-f]{48}$/
export const MONITOR_LIMITS = { body: 128 * 1024, batch: 50, message: 500, stack: 4000, route: 200, id: 100, short: 80 } as const
export const EVENT_KINDS = ['error', 'message', 'latency', 'heartbeat'] as const
export const EVENT_LEVELS = ['fatal', 'error', 'warning', 'info'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export type EventLevel = (typeof EVENT_LEVELS)[number]

export interface MonitorEvent {
  event_id: string
  kind: EventKind
  level?: EventLevel
  message?: string
  stack?: string
  fingerprint?: string
  environment?: string
  release?: string
  sdk_name?: string
  sdk_version?: string
  route?: string
  status_code?: number
  latency_ms?: number
  occurred_at?: string
}

export type ParsedBatch =
  | { ok: true; events: MonitorEvent[]; rejected: number; reasons: string[] }
  | { ok: false; error: string; reasons?: string[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined
}

/** One event, or the reason it was refused. Unknown fields are dropped (never stored, never forwarded). */
export function parseEvent(input: unknown): { ok: true; event: MonitorEvent } | { ok: false; reason: string } {
  if (!isObject(input)) return { ok: false, reason: 'not an object' }
  const kind = typeof input.kind === 'string' ? input.kind.toLowerCase() : ''
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: `unknown kind "${String(input.kind ?? '').slice(0, 20)}"` }
  const event_id = str(input.event_id, MONITOR_LIMITS.id)
  if (!event_id) return { ok: false, reason: 'missing event_id (needed so a retry is not counted twice)' }
  const level = typeof input.level === 'string' ? input.level.toLowerCase() : undefined
  const e: MonitorEvent = { event_id, kind: kind as EventKind }
  if (level && (EVENT_LEVELS as readonly string[]).includes(level)) e.level = level as EventLevel
  const set = <K extends keyof MonitorEvent>(k: K, v: MonitorEvent[K] | undefined) => { if (v !== undefined) e[k] = v }
  set('message', str(input.message, MONITOR_LIMITS.message))
  set('stack', str(input.stack, MONITOR_LIMITS.stack))
  set('fingerprint', str(input.fingerprint, 64))
  set('environment', str(input.environment, 40))
  set('release', str(input.release, MONITOR_LIMITS.short))
  set('sdk_name', str(input.sdk_name, 40))
  set('sdk_version', str(input.sdk_version, 40))
  set('route', str(input.route, MONITOR_LIMITS.route))
  set('status_code', num(input.status_code, 100, 599))
  set('latency_ms', num(input.latency_ms, 0, 600000))
  const at = str(input.occurred_at, 40)
  if (at && !Number.isNaN(Date.parse(at))) e.occurred_at = new Date(at).toISOString()
  return { ok: true, event: e }
}

/** Accepts `{ events: [...] }`, a bare array, or a single event object. */
export function parseBatch(body: unknown): ParsedBatch {
  const list = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.events) ? body.events : isObject(body) && 'kind' in body ? [body] : null
  if (!list) return { ok: false, error: 'Send an event, a list of events, or { "events": [...] }.' }
  if (list.length === 0) return { ok: true, events: [], rejected: 0, reasons: [] }
  if (list.length > MONITOR_LIMITS.batch) return { ok: false, error: `At most ${MONITOR_LIMITS.batch} events per request.` }
  const events: MonitorEvent[] = []
  const reasons: string[] = []
  let rejected = 0
  list.forEach((item, i) => {
    const r = parseEvent(item)
    if (r.ok) events.push(r.event)
    else { rejected++; if (reasons.length < 5) reasons.push(`event ${i}: ${r.reason}`) }
  })
  if (events.length === 0) return { ok: false, error: 'No valid events in the request.', reasons }
  return { ok: true, events, rejected, reasons }
}
