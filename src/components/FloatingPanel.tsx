import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripHorizontal, Maximize2, Minimize2, Minus, PictureInPicture2 } from 'lucide-react'
import './FloatingPanel.css'

/**
 * A window that floats above the app: drag it by the title bar, resize it from any edge or corner, shrink it to a bar,
 * or maximise it. It remembers where you left it. Built for calls, so that talking never blocks the page you are working on.
 *
 * The body stays MOUNTED when the panel is minimised (it is only hidden). A call's <audio>/<video> elements live in the body,
 * and unmounting them would silence the call.
 */
export interface PanelRect { x: number; y: number; w: number; h: number }
type Mode = 'normal' | 'min' | 'max'
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MARGIN = 8
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_BAR_W = 280

const viewport = () => ({ w: typeof window === 'undefined' ? 1280 : window.innerWidth, h: typeof window === 'undefined' ? 800 : window.innerHeight })

/** Keeps the panel fully reachable: never larger than the screen, never dragged off it. */
export function clampRect(r: PanelRect, min: { w: number; h: number }, vp = viewport()): PanelRect {
  const w = Math.min(Math.max(r.w, Math.min(min.w, vp.w - MARGIN * 2)), vp.w - MARGIN * 2)
  const h = Math.min(Math.max(r.h, Math.min(min.h, vp.h - MARGIN * 2)), vp.h - MARGIN * 2)
  const x = Math.min(Math.max(r.x, MARGIN), Math.max(MARGIN, vp.w - w - MARGIN))
  const y = Math.min(Math.max(r.y, MARGIN), Math.max(MARGIN, vp.h - h - MARGIN))
  return { x, y, w, h }
}

const storageKey = (id: string) => `ctf:panel:${id}`
function loadRect(id: string): PanelRect | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<PanelRect>
    return [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? (r as PanelRect) : null
  } catch { return null }
}
function saveRect(id: string, r: PanelRect) { try { localStorage.setItem(storageKey(id), JSON.stringify(r)) } catch { /* private mode: position just won't persist */ } }

interface Props {
  /** Stable id: the position and size are remembered under it. */
  id: string
  label: string
  title: ReactNode
  subtitle?: ReactNode
  defaultSize: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** Buttons that stay visible even when the panel is minimised (mute, hang up). */
  headerActions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** When this changes the panel grows to at least this size (e.g. a screen share just started). Never shrinks it. */
  growTo?: { w: number; h: number; key: string } | null
}

export function FloatingPanel({ id, label, title, subtitle, defaultSize, minSize = { w: 260, h: 150 }, headerActions, children, footer, className = '', growTo }: Props) {
  const [mode, setMode] = useState<Mode>('normal')
  const [rect, setRect] = useState<PanelRect>(() => {
    const vp = viewport()
    const saved = loadRect(id)
    return clampRect(saved ?? { x: vp.w - defaultSize.w - 20, y: vp.h - defaultSize.h - 20, w: defaultSize.w, h: defaultSize.h }, minSize)
  })
  const [dragging, setDragging] = useState(false)
  const rectRef = useRef(rect)
  const modeRef = useRef(mode)
  const panelRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => { rectRef.current = rect; modeRef.current = mode })

  const commit = useCallback((next: PanelRect, persist: boolean) => {
    const clamped = clampRect(next, minSize)
    rectRef.current = clamped
    setRect(clamped)
    if (persist) saveRect(id, clamped)
  }, [id, minSize])

  // The window can shrink (rotate a phone, resize the browser): pull the panel back on screen.
  useEffect(() => {
    const onResize = () => commit(rectRef.current, false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [commit])

  const growKey = growTo?.key
  useEffect(() => {
    if (!growTo) return
    const cur = rectRef.current
    const vp = viewport()
    const w = Math.max(cur.w, Math.min(growTo.w, vp.w - MARGIN * 2))
    const h = Math.max(cur.h, Math.min(growTo.h, vp.h - MARGIN * 2))
    if (w === cur.w && h === cur.h) return
    setMode('normal')
    // Grow toward the middle of the screen so the panel doesn't spill off the edge it is docked to.
    commit({ x: cur.x - (w - cur.w), y: cur.y - (h - cur.h), w, h }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growKey])

  // ── drag ──
  const dragRef = useRef<{ px: number; py: number; start: PanelRect } | null>(null)
  const onDragStart = (e: ReactPointerEvent<HTMLElement>) => {
    if (modeRef.current === 'max' || e.button > 0) return
    if ((e.target as HTMLElement).closest('button, a, input, select')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, start: rectRef.current }
    setDragging(true)
  }
  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    commit({ ...d.start, x: d.start.x + (e.clientX - d.px), y: d.start.y + (e.clientY - d.py) }, false)
  }
  const onDragEnd = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    saveRect(id, rectRef.current)
  }
  const onHeaderKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (modeRef.current === 'max' || (e.target as HTMLElement).closest('button')) return
    const step = e.shiftKey ? 48 : 16
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!move) return
    e.preventDefault()
    commit({ ...rectRef.current, x: rectRef.current.x + move[0], y: rectRef.current.y + move[1] }, true)
  }

  // ── resize ──
  const resizeRef = useRef<{ px: number; py: number; start: PanelRect; edge: Edge } | null>(null)
  const onResizeStart = (edge: Edge) => (e: ReactPointerEvent<HTMLElement>) => {
    if (modeRef.current !== 'normal' || e.button > 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { px: e.clientX, py: e.clientY, start: rectRef.current, edge }
    setDragging(true)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLElement>) => {
    const r = resizeRef.current
    if (!r) return
    const dx = e.clientX - r.px
    const dy = e.clientY - r.py
    const vp = viewport()
    let { x, y, w, h } = r.start
    const minW = Math.min(minSize.w, vp.w - MARGIN * 2)
    const minH = Math.min(minSize.h, vp.h - MARGIN * 2)
    if (r.edge.includes('e')) w = Math.min(Math.max(minW, r.start.w + dx), vp.w - MARGIN - x)
    if (r.edge.includes('s')) h = Math.min(Math.max(minH, r.start.h + dy), vp.h - MARGIN - y)
    if (r.edge.includes('w')) { const right = r.start.x + r.start.w; w = Math.min(Math.max(minW, r.start.w - dx), right - MARGIN); x = right - w }
    if (r.edge.includes('n')) { const bottom = r.start.y + r.start.h; h = Math.min(Math.max(minH, r.start.h - dy), bottom - MARGIN); y = bottom - h }
    commit({ x, y, w, h }, false)
  }
  const onResizeEnd = (e: ReactPointerEvent<HTMLElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    saveRect(id, rectRef.current)
  }

  const style = mode === 'max'
    ? { left: MARGIN, top: MARGIN, width: `calc(100vw - ${MARGIN * 2}px)`, height: `calc(100dvh - ${MARGIN * 2}px)` }
    : mode === 'min'
      ? { left: rect.x, top: rect.y, width: Math.min(rect.w, Math.max(MIN_BAR_W, 300)), height: 'auto' }
      : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }

  const toggleMin = () => setMode((m) => (m === 'min' ? 'normal' : 'min'))
  const toggleMax = () => setMode((m) => (m === 'max' ? 'normal' : 'max'))

  return (
    <section ref={panelRef} className={`ctf-fp ctf-fp--${mode} ${dragging ? 'is-dragging' : ''} ${className}`.trim()} style={style} aria-label={label} role="dialog" aria-modal="false">
      <header className="ctf-fp__head" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
        onKeyDown={onHeaderKey} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) toggleMax() }} tabIndex={0}
        title="Drag to move. Arrow keys move it too. Double-click to maximise.">
        <GripHorizontal size={14} className="ctf-fp__grip" aria-hidden="true" />
        <div className="ctf-fp__title"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
        <div className="ctf-fp__actions">
          {headerActions}
          <button type="button" className="ctf-fp__btn" onClick={toggleMin} aria-label={mode === 'min' ? 'Expand call window' : 'Minimise call window'} title={mode === 'min' ? 'Expand' : 'Minimise'}>
            {mode === 'min' ? <PictureInPicture2 size={14} /> : <Minus size={14} />}
          </button>
          <button type="button" className="ctf-fp__btn" onClick={toggleMax} aria-label={mode === 'max' ? 'Restore call window' : 'Maximise call window'} title={mode === 'max' ? 'Restore' : 'Maximise'}>
            {mode === 'max' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </header>
      <div className="ctf-fp__body" hidden={mode === 'min'}>{children}</div>
      {footer && <footer className="ctf-fp__foot" hidden={mode === 'min'}>{footer}</footer>}
      {mode === 'normal' && EDGES.map((edge) => (
        <span key={edge} className={`ctf-fp__edge ctf-fp__edge--${edge}`} onPointerDown={onResizeStart(edge)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} aria-hidden="true" />
      ))}
    </section>
  )
}
