/* Whiteboard document model: pure functions over plain data, so every editing rule can be tested without a browser. */

export type ShapeType = 'rect' | 'ellipse' | 'sticky' | 'text' | 'frame' | 'line' | 'arrow'
export interface Shape {
  id: string
  type: ShapeType
  /** Top-left for boxes; start point for line/arrow. */
  x: number
  y: number
  w: number
  h: number
  /** End point for line/arrow. */
  x2?: number
  y2?: number
  text: string
  color: string
  z: number
}
export interface Board { shapes: Shape[] }
export interface Viewport { x: number; y: number; zoom: number }
export interface Point { x: number; y: number }

export const COLORS = ['#4a63ff', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#64748b', '#f8fafc'] as const
export const MAX_SHAPES = 1500
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 4
const MIN_SIZE = 24
const LIMIT = 100_000
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -LIMIT, LIMIT) : fallback)

const DEFAULTS: Record<ShapeType, { w: number; h: number }> = {
  rect: { w: 160, h: 100 }, ellipse: { w: 160, h: 100 }, sticky: { w: 160, h: 140 }, text: { w: 200, h: 40 }, frame: { w: 420, h: 300 }, line: { w: 0, h: 0 }, arrow: { w: 0, h: 0 },
}
export const isLinear = (t: ShapeType) => t === 'line' || t === 'arrow'
const nextZ = (b: Board) => b.shapes.reduce((m, s) => Math.max(m, s.z), 0) + 1

/** A new shape centred on `at`. Lines and arrows start 160 units long. Frames sit behind everything else. */
export function newShape(board: Board, type: ShapeType, at: Point, id: string, color: string = COLORS[0]): Board {
  if (board.shapes.length >= MAX_SHAPES) return board
  const d = DEFAULTS[type]
  const base = { id, type, text: type === 'sticky' ? '' : type === 'text' ? 'Text' : '', color: type === 'sticky' ? '#f59e0b' : color, z: type === 'frame' ? Math.min(0, ...board.shapes.map((s) => s.z)) - 1 : nextZ(board) }
  const shape: Shape = isLinear(type)
    ? { ...base, x: at.x - 80, y: at.y, w: 0, h: 0, x2: at.x + 80, y2: at.y }
    : { ...base, x: at.x - d.w / 2, y: at.y - d.h / 2, w: d.w, h: d.h }
  return { shapes: [...board.shapes, shape] }
}

const mapShape = (b: Board, id: string, fn: (s: Shape) => Shape): Board => ({ shapes: b.shapes.map((s) => (s.id === id ? fn(s) : s)) })

export const moveShape = (b: Board, id: string, dx: number, dy: number) =>
  mapShape(b, id, (s) => ({ ...s, x: clamp(s.x + dx, -LIMIT, LIMIT), y: clamp(s.y + dy, -LIMIT, LIMIT), ...(isLinear(s.type) ? { x2: clamp((s.x2 ?? s.x) + dx, -LIMIT, LIMIT), y2: clamp((s.y2 ?? s.y) + dy, -LIMIT, LIMIT) } : {}) }))
export const resizeShape = (b: Board, id: string, w: number, h: number) =>
  mapShape(b, id, (s) => (isLinear(s.type) ? s : { ...s, w: clamp(w, MIN_SIZE, 5000), h: clamp(h, MIN_SIZE, 5000) }))
/** Drag one end of a line or arrow. */
export const moveEndpoint = (b: Board, id: string, end: 'start' | 'end', p: Point) =>
  mapShape(b, id, (s) => (!isLinear(s.type) ? s : end === 'start' ? { ...s, x: p.x, y: p.y } : { ...s, x2: p.x, y2: p.y }))
export const setText = (b: Board, id: string, text: string) => mapShape(b, id, (s) => ({ ...s, text: text.slice(0, 2000) }))
export const setColor = (b: Board, id: string, color: string) => mapShape(b, id, (s) => ({ ...s, color }))
export const deleteShape = (b: Board, id: string): Board => ({ shapes: b.shapes.filter((s) => s.id !== id) })
export const bringToFront = (b: Board, id: string) => mapShape(b, id, (s) => ({ ...s, z: nextZ(b) }))
export function duplicateShape(b: Board, id: string, newId: string): Board {
  const s = b.shapes.find((x) => x.id === id)
  if (!s || b.shapes.length >= MAX_SHAPES) return b
  return { shapes: [...b.shapes, { ...s, id: newId, x: s.x + 24, y: s.y + 24, ...(isLinear(s.type) ? { x2: (s.x2 ?? s.x) + 24, y2: (s.y2 ?? s.y) + 24 } : {}), z: nextZ(b) }] }
}

/** Shapes in paint order: back to front. */
export const ordered = (b: Board) => [...b.shapes].sort((a, c) => a.z - c.z)

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The top-most shape under a point. A frame is only hit on its border band, so shapes inside it stay selectable. */
export function shapeAt(b: Board, p: Point, zoom = 1): Shape | null {
  const slop = 8 / zoom
  for (const s of [...ordered(b)].reverse()) {
    if (isLinear(s.type)) { if (distToSegment(p, { x: s.x, y: s.y }, { x: s.x2 ?? s.x, y: s.y2 ?? s.y }) <= slop) return s; continue }
    const inside = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h
    if (!inside) continue
    if (s.type === 'frame') {
      const onBorder = p.x - s.x <= slop * 1.5 || s.x + s.w - p.x <= slop * 1.5 || p.y - s.y <= 28 / zoom || s.y + s.h - p.y <= slop * 1.5
      if (onBorder) return s
      continue
    }
    if (s.type === 'ellipse') {
      const nx = (p.x - (s.x + s.w / 2)) / (s.w / 2), ny = (p.y - (s.y + s.h / 2)) / (s.h / 2)
      if (nx * nx + ny * ny > 1) continue
    }
    return s
  }
  return null
}

export const screenToWorld = (vp: Viewport, p: Point): Point => ({ x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom })
/** Zoom keeping the world point under `at` (in screen space) fixed, like a map. */
export function zoomAt(vp: Viewport, at: Point, factor: number): Viewport {
  const zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const w = screenToWorld(vp, at)
  return { zoom, x: at.x - w.x * zoom, y: at.y - w.y * zoom }
}

/** Parse a saved document defensively: it came from the database and other people's browsers, so nothing in it is trusted. */
export function parseBoard(raw: unknown): Board {
  const list = (raw as { shapes?: unknown } | null)?.shapes
  if (!Array.isArray(list)) return { shapes: [] }
  const types: ShapeType[] = ['rect', 'ellipse', 'sticky', 'text', 'frame', 'line', 'arrow']
  const seen = new Set<string>()
  const shapes: Shape[] = []
  for (const item of list.slice(0, MAX_SHAPES)) {
    const s = item as Partial<Shape> | null
    if (!s || typeof s.id !== 'string' || s.id.length > 64 || seen.has(s.id) || !types.includes(s.type as ShapeType)) continue
    seen.add(s.id)
    const type = s.type as ShapeType
    const color = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : COLORS[0]
    const base = { id: s.id, type, x: num(s.x, 0), y: num(s.y, 0), text: typeof s.text === 'string' ? s.text.slice(0, 2000) : '', color, z: num(s.z, 0) }
    shapes.push(isLinear(type) ? { ...base, w: 0, h: 0, x2: num(s.x2, base.x + 100), y2: num(s.y2, base.y) } : { ...base, w: clamp(num(s.w, 100), MIN_SIZE, 5000), h: clamp(num(s.h, 100), MIN_SIZE, 5000) })
  }
  return { shapes }
}

export function boundsOf(b: Board): { x: number; y: number; w: number; h: number } | null {
  if (b.shapes.length === 0) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const s of b.shapes) {
    const ex = isLinear(s.type) ? s.x2 ?? s.x : s.x + s.w, ey = isLinear(s.type) ? s.y2 ?? s.y : s.y + s.h
    x1 = Math.min(x1, s.x, ex); y1 = Math.min(y1, s.y, ey); x2 = Math.max(x2, s.x, ex); y2 = Math.max(y2, s.y, ey)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
/** A viewport that shows the whole board with a margin. */
export function fitViewport(b: Board, size: { w: number; h: number }): Viewport {
  const bb = boundsOf(b)
  if (!bb) return { x: 0, y: 0, zoom: 1 }
  const zoom = clamp(Math.min((size.w - 80) / Math.max(bb.w, 1), (size.h - 80) / Math.max(bb.h, 1)), MIN_ZOOM, 1.5)
  return { zoom, x: size.w / 2 - (bb.x + bb.w / 2) * zoom, y: size.h / 2 - (bb.y + bb.h / 2) * zoom }
}

/** Undo/redo over whole-board snapshots. Boards are small plain data, so snapshots are simple and safe. */
export interface History { past: Board[]; present: Board; future: Board[] }
export const startHistory = (b: Board): History => ({ past: [], present: b, future: [] })
export const commit = (h: History, next: Board): History => (next === h.present ? h : { past: [...h.past, h.present].slice(-60), present: next, future: [] })
export const undo = (h: History): History => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)
export const redo = (h: History): History => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)
