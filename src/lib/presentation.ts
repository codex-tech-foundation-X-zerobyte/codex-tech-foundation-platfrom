/**
 * Presentation board: the pure logic. No React, no network, so every rule here is unit-tested.
 *
 * A progressive web app cannot share the screen to the outside world, so presenters use an in-app STAGE that fits their craft.
 * Each stage keeps its live state as a small JSON object that is synced to everyone watching.
 */

export type StageKind = 'browser' | 'console' | 'dashboard' | 'cinema' | 'slides'

export interface StageInfo { kind: StageKind; label: string; blurb: string; hint: string }

export const STAGES: Record<StageKind, StageInfo> = {
  browser: { kind: 'browser', label: 'Browser', blurb: 'Show a live app or site in a built-in browser, on desktop, tablet or phone size.', hint: 'Best for demos of what you built.' },
  console: { kind: 'console', label: 'Console', blurb: 'A shared terminal-style stage: commands, output and real HTTP requests, line by line.', hint: 'Best for APIs, logs, pipelines and incident walkthroughs.' },
  dashboard: { kind: 'dashboard', label: 'Dashboard', blurb: 'Drop in a CSV and present it as KPIs and charts, computed from your real data.', hint: 'Best for campaign results and analysis.' },
  cinema: { kind: 'cinema', label: 'Cinema', blurb: 'Watch a video together, in sync: play, pause and seek follow the presenter.', hint: 'Best for edits, motion work and recordings.' },
  slides: { kind: 'slides', label: 'Slides', blurb: 'Write slides in plain text and present them. Everyone follows along.', hint: 'Works for every department.' },
}

/** Which stages each Codex department sees first. Slides are available to everyone; a department can also borrow any other stage. */
const DEPARTMENT_STAGES: Record<string, StageKind[]> = {
  'frontend-development': ['browser', 'slides'],
  'backend-development': ['console', 'slides'],
  'devops': ['console', 'browser', 'slides'],
  'cybersecurity': ['console', 'slides'],
  'ui-ux-design': ['browser', 'slides', 'cinema'],
  'graphics-creative': ['cinema', 'browser', 'slides'],
  'content': ['cinema', 'slides'],
  'marketing': ['dashboard', 'slides', 'cinema'],
}
const ALL_KINDS: StageKind[] = ['browser', 'console', 'dashboard', 'cinema', 'slides']

/** The stages recommended for a department (its own craft first). Unknown or null departments (company-wide) get slides first. */
export function recommendedStages(slug: string | null | undefined): StageKind[] {
  return (slug && DEPARTMENT_STAGES[slug]) || ['slides', 'browser', 'cinema', 'dashboard', 'console']
}
/** Recommended first, then every other stage, so nothing is locked away. */
export function stagesFor(slug: string | null | undefined): StageKind[] {
  const rec = recommendedStages(slug)
  return [...rec, ...ALL_KINDS.filter((k) => !rec.includes(k))]
}

export const isStageKind = (v: unknown): v is StageKind => typeof v === 'string' && (ALL_KINDS as string[]).includes(v)

/* ── Browser stage ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const DEVICES = { desktop: { label: 'Desktop', width: null }, tablet: { label: 'Tablet', width: 820 }, mobile: { label: 'Phone', width: 390 } } as const
export type DeviceKind = keyof typeof DEVICES

/**
 * Turns what someone typed into a URL that is safe to put in an iframe, or null. Only https (and http for localhost, which browsers
 * treat as secure) is allowed; javascript:, data:, blob:, file: and friends are refused. A bare "example.com" gets https://.
 *
 * `blockedOrigins` lists origins that must never be framed. The browser stage passes the Workspace's own origin and the database's:
 * the frame is sandboxed with allow-same-origin, so a page from OUR origin could remove its own sandbox.
 */
export function normalizeStageUrl(input: string, opts: { blockedOrigins?: readonly string[] } = {}): string | null {
  const raw = input.trim()
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]*:\d+(\/|$)/.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(withScheme) } catch { return null }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) {
    if (!url.hostname.includes('.') && !local) return null   // "https://abc" is almost always a typo
    if (url.username || url.password) return null            // credentials in a URL would be shown to the whole audience
    if (opts.blockedOrigins?.some((o) => o && o === url.origin)) return null
    return url.toString()
  }
  return null
}

/** True when `input` is a well-formed address that is only refused because it points at one of `blockedOrigins`. */
export function isBlockedStageOrigin(input: string, blockedOrigins: readonly string[]): boolean {
  return normalizeStageUrl(input) !== null && normalizeStageUrl(input, { blockedOrigins }) === null
}

/** Origins the in-app browser must never show: this app itself and the database/API. */
export function stageBlockedOrigins(locationOrigin: string | undefined = globalThis.location?.origin, supabaseUrl: string | undefined = import.meta.env?.VITE_SUPABASE_URL): string[] {
  const out: string[] = []
  if (locationOrigin) out.push(locationOrigin)
  try { if (supabaseUrl) out.push(new URL(supabaseUrl).origin) } catch { /* not a URL: nothing to block */ }
  return out
}

/** A video link as an embeddable player URL, when it is one we know how to embed. */
export function toEmbedUrl(raw: string): { kind: 'youtube' | 'vimeo'; src: string } | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') { const id = url.pathname.slice(1).split('/')[0]; return /^[\w-]{6,20}$/.test(id) ? { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` } : null }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : null
    return id && /^[\w-]{6,20}$/.test(id) ? { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }
  if (host === 'vimeo.com') { const id = url.pathname.split('/').filter(Boolean)[0]; return id && /^\d+$/.test(id) ? { kind: 'vimeo', src: `https://player.vimeo.com/video/${id}` } : null }
  return null
}

/* ── Slides stage ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const MAX_SLIDES = 200

/** Slides are separated by a line containing only `---`. Empty slides are dropped; there is always at least one. */
export function splitSlides(markdown: string): string[] {
  const slides = markdown.replace(/\r\n/g, '\n').split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SLIDES)
  return slides.length ? slides : ['']
}
export const clampIndex = (index: number, count: number) => Math.min(Math.max(Number.isFinite(index) ? Math.trunc(index) : 0, 0), Math.max(0, count - 1))

/** A slide's blocks: normal text (rendered as markdown) and images written as `![alt](address)` on a line of their own. */
export type SlideBlock = { t: 'md'; text: string } | { t: 'img'; alt: string; src: string }
export function slideBlocks(slide: string): SlideBlock[] {
  const out: SlideBlock[] = []
  let buf: string[] = []
  const flush = () => { const text = buf.join('\n').trim(); if (text) out.push({ t: 'md', text }); buf = [] }
  for (const line of slide.split('\n')) {
    const m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim())
    if (m) { flush(); out.push({ t: 'img', alt: m[1], src: m[2] }) } else buf.push(line)
  }
  flush()
  return out
}

/* ── Console stage ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type ConsoleLineKind = 'cmd' | 'out' | 'err' | 'note'
export interface ConsoleLine { id: string; k: ConsoleLineKind; text: string; at: number }
export const MAX_CONSOLE_LINES = 300
export const MAX_LINE_CHARS = 4000

/** Appends lines, trimming long lines and keeping only the most recent ones so the synced state stays small. */
export function appendConsole(lines: ConsoleLine[], add: { k: ConsoleLineKind; text: string }[], now = Date.now()): ConsoleLine[] {
  const fresh = add.filter((l) => l.text.length > 0).map((l, i) => ({ id: `${now}-${i}-${Math.random().toString(36).slice(2, 7)}`, k: l.k, text: l.text.length > MAX_LINE_CHARS ? `${l.text.slice(0, MAX_LINE_CHARS)}… (cut)` : l.text, at: now }))
  return [...lines, ...fresh].slice(-MAX_CONSOLE_LINES)
}

/** A pasted block of output becomes one line per row, so long logs stay readable and scrollable. */
export const splitOutput = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** `GET https://api.example.com/health` or a bare URL (GET). Returns null if it is not a usable request. */
export function parseHttpLine(input: string): { method: HttpMethod; url: string } | null {
  const m = /^\s*(?:(GET|POST|PUT|PATCH|DELETE|HEAD)\s+)?(\S+)\s*$/i.exec(input)
  if (!m) return null
  const url = normalizeStageUrl(m[2])
  return url ? { method: ((m[1] ?? 'GET').toUpperCase() as HttpMethod), url } : null
}

/** Pretty-prints JSON bodies, cuts huge ones, and reports what was cut. */
export function formatBody(body: string, max = 6000): string {
  let text = body
  try { text = JSON.stringify(JSON.parse(body), null, 2) } catch { /* not JSON: show as is */ }
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters not shown)` : text
}

/* ── Dashboard stage ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const MAX_ROWS = 500
export const MAX_COLS = 12

/** RFC 4180-style CSV: quoted fields, escaped quotes, commas/semicolons/tabs as separators, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const firstLine = src.split('\n', 1)[0] ?? ''
  const sep = [',', ';', '\t'].map((c) => [c, (firstLine.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) ?? []).length] as const).sort((a, b) => b[1] - a[1])[0]
  const delim = sep[1] > 0 ? sep[0] : ','
  const rows: string[][] = []
  let row: string[] = []; let field = ''; let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

export interface DashboardData { columns: string[]; rows: string[][]; truncated: boolean }

/** First row is the header. Caps rows and columns so the synced state stays small. Ragged rows are padded. */
export function toDashboardData(csv: string): DashboardData | { error: string } {
  const parsed = parseCsv(csv)
  if (parsed.length < 2) return { error: 'Add a header row and at least one row of data.' }
  const width = Math.min(MAX_COLS, Math.max(...parsed.map((r) => r.length)))
  const header = parsed[0].slice(0, width).map((h, i) => h.trim() || `Column ${i + 1}`)
  while (header.length < width) header.push(`Column ${header.length + 1}`)
  const body = parsed.slice(1)
  const rows = body.slice(0, MAX_ROWS).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? '').trim()))
  return { columns: header, rows, truncated: body.length > MAX_ROWS }
}

/** "1,234.50", "₦12,000", "45%", "(300)" -> number; anything else -> null. */
export function toNumber(raw: string): number | null {
  let s = raw.trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/[₦$€£¥%\s]/g, '').replace(/,/g, '')
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? (negative ? -n : n) : null
}

/** A column is numeric when most (60%+) of its non-empty cells are numbers: real exports have the odd "n/a". */
export function numericColumns(data: DashboardData): number[] {
  return data.columns.flatMap((_, c) => {
    const cells = data.rows.map((r) => r[c]).filter((v) => v !== '')
    if (cells.length === 0) return []
    return cells.filter((v) => toNumber(v) !== null).length / cells.length >= 0.6 ? [c] : []
  })
}

export interface ColumnStats { count: number; sum: number; avg: number; min: number; max: number }
export function columnStats(data: DashboardData, col: number): ColumnStats | null {
  const nums = data.rows.map((r) => toNumber(r[col] ?? '')).filter((n): n is number => n !== null)
  if (nums.length === 0) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return { count: nums.length, sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) }
}

export type ChartType = 'bar' | 'line' | 'pie'
export interface ChartConfig { type: ChartType; x: number; y: number }

/** Sensible defaults: first non-numeric column (else the first) on x, first numeric column that is not x on y. */
export function defaultChart(data: DashboardData): ChartConfig {
  const nums = numericColumns(data)
  const x = data.columns.findIndex((_, i) => !nums.includes(i))
  const xi = x === -1 ? 0 : x
  const y = nums.find((i) => i !== xi) ?? nums[0] ?? Math.min(1, data.columns.length - 1)
  return { type: 'bar', x: xi, y }
}

/** The chart's points, from the data: label and value pairs (non-numeric y cells are skipped, never invented). */
export function chartPoints(data: DashboardData, cfg: ChartConfig, limit = 40): { label: string; value: number }[] {
  return data.rows.flatMap((r) => { const v = toNumber(r[cfg.y] ?? ''); return v === null ? [] : [{ label: r[cfg.x] || '—', value: v }] }).slice(0, limit)
}

export function formatNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${+(n / 1e3).toFixed(1)}K`
  return Number.isInteger(n) ? n.toLocaleString('en') : (+n.toFixed(2)).toLocaleString('en')
}

/* ── Cinema stage ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface CinemaState { source?: 'upload' | 'url'; path?: string; url?: string; name?: string; playing?: boolean; position?: number; at?: number; rate?: number }

/**
 * Where the video should be right now. The presenter stamps `position` (seconds) and `at` (server clock, ms) whenever they play,
 * pause or seek. While playing, the position advances with the clock; `serverOffsetMs` = serverNow - localNow, so a viewer's own
 * clock being wrong does not make them watch out of sync.
 */
export function expectedPosition(state: CinemaState, localNowMs: number, serverOffsetMs: number): number {
  const base = Math.max(0, state.position ?? 0)
  if (!state.playing || typeof state.at !== 'number') return base
  const elapsed = Math.max(0, (localNowMs + serverOffsetMs - state.at) / 1000)
  return base + elapsed * (state.rate && state.rate > 0 ? state.rate : 1)
}
/** Only nudge a viewer's player when it has drifted further than this (seconds); smaller corrections would stutter. */
export const DRIFT_TOLERANCE_S = 1.5
export const needsSeek = (current: number, expected: number) => Math.abs(current - expected) > DRIFT_TOLERANCE_S

export const PRESENTATION_MAX_BYTES = 50 * 1024 * 1024
const PRESENTATION_MIME = /^(video\/(mp4|webm|quicktime)|image\/(png|jpeg|webp|gif))$/
export function validatePresentationFile(file: { name: string; type: string; size: number }): string | null {
  if (!PRESENTATION_MIME.test(file.type)) return 'Use an MP4, WebM or MOV video, or a PNG, JPEG, WebP or GIF image.'
  if (file.size > PRESENTATION_MAX_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 50 MB. Paste a link instead, or compress it first.`
  return null
}

/* ── Session list ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A live session whose presenter has gone quiet (closed the tab, lost signal) is "paused", not "live". Presenters ping every minute. */
export const STALE_AFTER_MS = 3 * 60 * 1000
export const isStale = (updatedAt: string, now = Date.now()) => now - new Date(updatedAt).getTime() > STALE_AFTER_MS
