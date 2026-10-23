import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Circle, Copy, Frame, Minus, MousePointer2, Plus, Redo2, Square, StickyNote, Trash2, Type, Undo2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, SkeletonRows, Surface, useToast } from '../../components/ui'
import { createWhiteboard, deleteWhiteboard, listWhiteboards, loadWhiteboard, saveWhiteboard, subscribeToWhiteboard, type DepartmentRow, type WhiteboardDoc } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import {
  COLORS, bringToFront, commit, deleteShape, duplicateShape, fitViewport, isLinear, moveEndpoint, moveShape, newShape, ordered, redo, resizeShape, screenToWorld,
  setColor, setText, shapeAt, startHistory, undo, zoomAt, type Board, type History, type Point, type Shape, type ShapeType, type Viewport,
} from '../../lib/whiteboard'
import type { Viewer } from '../DepartmentWork'
import { useSearchParams } from 'react-router'

type Tool = 'select' | ShapeType
type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error'
const TOOLS: { id: Tool; label: string; icon: typeof Square }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2 }, { id: 'rect', label: 'Rectangle', icon: Square }, { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'sticky', label: 'Sticky note', icon: StickyNote }, { id: 'text', label: 'Text', icon: Type }, { id: 'frame', label: 'Frame', icon: Frame },
  { id: 'line', label: 'Line', icon: Minus }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
]

export function WhiteboardTool({ row, viewer }: { row: DepartmentRow; viewer: Viewer }) {
  const [params, setParams] = useSearchParams()
  const open = params.get('board')
  const list = useAsyncData(`whiteboards:${row.id}`, () => listWhiteboards(row.id))
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const { push } = useToast()

  if (open) return <Editor key={open} id={open} canDelete={viewer.isDepartmentAdmin || viewer.isMainAdmin} onBack={() => { setParams({}, { replace: true }); list.reload() }} />

  const create = async () => {
    setCreating(true)
    const { data, error } = await createWhiteboard(row.id, name)
    setCreating(false)
    if (error || !data) { push(error?.message ?? 'Could not create it.', 'error'); return }
    setName(''); setParams({ board: data }, { replace: true })
  }
  return (
    <div className="ctf-denv__stack">
      <div className="ctf-lab__row">
        <FieldWrap label="New whiteboard" htmlFor="wb-name"><Input id="wb-name" value={name} maxLength={120} placeholder="e.g. Onboarding flow" onChange={(e) => setName(e.target.value)} autoComplete="off" /></FieldWrap>
        <div className="ctf-lab__save"><Button variant="primary" loading={creating} disabled={!name.trim()} onClick={() => void create()}>Create</Button></div>
      </div>
      {list.loading ? <SkeletonRows rows={2} /> : list.error ? <ErrorState title="Whiteboards couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} /> : (list.data ?? []).length === 0
        ? <EmptyState title="No whiteboards yet" description="Create one to sketch flows, wireframes and ideas with your team." />
        : <ul className="ctf-rec__list">{(list.data ?? []).map((b) => <li key={b.id} className="ctf-rec__row"><button type="button" className="ctf-rec__main" onClick={() => setParams({ board: b.id }, { replace: true })}><strong>{b.title}</strong><span className="ctf-denv__muted">Edited {new Date(b.updated_at).toLocaleString()}</span></button></li>)}</ul>}
    </div>
  )
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > maxChars && line) { lines.push(line); line = word } else line = (line + ' ' + word).trim()
    }
    lines.push(line)
  }
  return lines.slice(0, 12)
}

type Drag =
  | { kind: 'move'; id: string; last: Point }
  | { kind: 'resize'; id: string }
  | { kind: 'end'; id: string; end: 'start' | 'end' }
  | { kind: 'pan'; last: Point }

function Editor({ id, canDelete, onBack }: { id: string; canDelete: boolean; onBack: () => void }) {
  const doc = useAsyncData(`whiteboard:${id}`, () => loadWhiteboard(id))
  if (doc.loading) return <SkeletonRows rows={4} height="80px" />
  if (doc.error || !doc.data) return <ErrorState title="This whiteboard couldn't load" description={doc.errorDetail?.message ?? 'It may have been deleted.'} onRetry={doc.reload} />
  return <Canvas key={`${doc.data.id}:${doc.data.version}`} doc={doc.data} canDelete={canDelete} onBack={onBack} reload={doc.reload} />
}

function Canvas({ doc, canDelete, onBack, reload }: { doc: WhiteboardDoc; canDelete: boolean; onBack: () => void; reload: () => void }) {
  const [hist, setHist] = useState<History>(() => startHistory(doc.board))
  const [draft, setDraft] = useState<Board | null>(null)
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>('saved')
  const [remote, setRemote] = useState(false)
  const version = useRef(doc.version)
  const drag = useRef<Drag | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dirty = useRef(false)
  const { push } = useToast()
  const board = draft ?? hist.present
  const selected = board.shapes.find((s) => s.id === sel) ?? null

  const rect = () => svgRef.current!.getBoundingClientRect()
  const toWorld = (e: { clientX: number; clientY: number }): Point => { const r = rect(); return screenToWorld(vp, { x: e.clientX - r.left, y: e.clientY - r.top }) }
  const apply = useCallback((fn: (b: Board) => Board) => { setHist((h) => commit(h, fn(h.present))); dirty.current = true; setSave('unsaved') }, [])

  // Fit once on load.
  useEffect(() => { if (svgRef.current) { const r = svgRef.current.getBoundingClientRect(); setVp(fitViewport(doc.board, { w: r.width, h: r.height })) } }, [doc.board])

  // Autosave, built on the version we loaded: if someone else saved in between, nothing is overwritten.
  useEffect(() => {
    if (!dirty.current || save === 'conflict') return
    const t = setTimeout(async () => {
      setSave('saving')
      const r = await saveWhiteboard(doc.id, version.current, hist.present)
      if (r.conflict) { setSave('conflict'); return }
      if (r.error) { setSave('error'); return }
      version.current = r.version as number; dirty.current = false; setSave('saved')
    }, 1200)
    return () => clearTimeout(t)
  }, [hist.present, doc.id, save])

  // Live refresh: a newer version from someone else loads straight away if we have no unsaved edits.
  useEffect(() => subscribeToWhiteboard(doc.id, (v) => { if (v > version.current) { if (dirty.current) setRemote(true); else reload() } }), [doc.id, reload])

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); setVp((v) => zoomAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015))) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (editing) return
    svgRef.current?.setPointerCapture?.(e.pointerId)
    const p = toWorld(e)
    const target = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle')
    if (target && selected) {
      drag.current = target === 'resize' ? { kind: 'resize', id: selected.id } : { kind: 'end', id: selected.id, end: target === 'start' ? 'start' : 'end' }
      setDraft(board); return
    }
    if (tool !== 'select') {
      const sid = crypto.randomUUID()
      apply((b) => newShape(b, tool, p, sid))
      setSel(sid); setTool('select'); return
    }
    const hit = shapeAt(board, p, vp.zoom)
    if (hit) { setSel(hit.id); drag.current = { kind: 'move', id: hit.id, last: p }; setDraft(board) }
    else { setSel(null); drag.current = { kind: 'pan', last: { x: e.clientX, y: e.clientY } } }
  }
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') { const dx = e.clientX - d.last.x, dy = e.clientY - d.last.y; d.last = { x: e.clientX, y: e.clientY }; setVp((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); return }
    const p = toWorld(e)
    if (d.kind === 'move') { const dx = p.x - d.last.x, dy = p.y - d.last.y; d.last = p; setDraft((b) => moveShape(b ?? board, d.id, dx, dy)) }
    else if (d.kind === 'resize') { const s = (draft ?? board).shapes.find((x) => x.id === d.id); if (s) setDraft((b) => resizeShape(b ?? board, d.id, p.x - s.x, p.y - s.y)) }
    else setDraft((b) => moveEndpoint(b ?? board, d.id, d.end, p))
  }
  const up = () => {
    const d = drag.current; drag.current = null
    if (d && d.kind !== 'pan' && draft) { const next = draft; setDraft(null); apply(() => next) }
  }

  const act = (fn: (b: Board) => Board) => apply(fn)
  const remove = () => { if (sel) { act((b) => deleteShape(b, sel)); setSel(null) } }
  const dup = () => { if (sel) { const nid = crypto.randomUUID(); act((b) => duplicateShape(b, sel, nid)); setSel(nid) } }
  const doUndo = () => { setHist(undo); dirty.current = true; setSave('unsaved'); setSel(null) }
  const doRedo = () => { setHist(redo); dirty.current = true; setSave('unsaved') }

  const key = (e: React.KeyboardEvent) => {
    if (editing) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo() }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo() }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup() }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
    else if (e.key === 'Escape') { setSel(null); setTool('select') }
    else if (sel && e.key.startsWith('Arrow')) { e.preventDefault(); const n = e.shiftKey ? 1 : 10; act((b) => moveShape(b, sel, e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0)) }
  }

  const remoteBanner = remote || save === 'conflict'
  const removeBoard = async () => { const { error } = await deleteWhiteboard(doc.id); if (error) push(error.message, 'error'); else onBack() }
  const label: Record<SaveState, string> = { saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', conflict: 'Not saved: someone else changed this board', error: 'Could not save' }

  return (
    <div className="ctf-wb" onKeyDown={key} tabIndex={-1}>
      <div className="ctf-wb__bar">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>Boards</Button>
        <strong className="ctf-wb__title">{doc.title}</strong>
        <span className={`ctf-wb__save is-${save}`} role="status">{label[save]}</span>
        <div className="ctf-wb__spacer" />
        <Button variant="ghost" size="sm" aria-label="Undo" icon={<Undo2 size={14} />} disabled={!hist.past.length} onClick={doUndo} />
        <Button variant="ghost" size="sm" aria-label="Redo" icon={<Redo2 size={14} />} disabled={!hist.future.length} onClick={doRedo} />
        <Button variant="ghost" size="sm" aria-label="Zoom out" icon={<Minus size={14} />} onClick={() => setVp((v) => zoomAt(v, { x: 400, y: 250 }, 0.8))} />
        <span className="ctf-wb__zoom">{Math.round(vp.zoom * 100)}%</span>
        <Button variant="ghost" size="sm" aria-label="Zoom in" icon={<Plus size={14} />} onClick={() => setVp((v) => zoomAt(v, { x: 400, y: 250 }, 1.25))} />
        <Button variant="ghost" size="sm" onClick={() => { const r = rect(); setVp(fitViewport(board, { w: r.width, h: r.height })) }}>Fit</Button>
        {canDelete && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void removeBoard()}>Delete board</Button>}
      </div>
      {remoteBanner && (
        <Surface variant="warning" className="ctf-denv__warn" role="alert">
          <span>Someone else saved a newer version of this board. {save === 'conflict' ? 'Your last changes were not saved.' : ''} Reload to see theirs; your unsaved edits will be lost.</span>
          <Button size="sm" variant="secondary" onClick={() => reload()}>Reload latest</Button>
        </Surface>
      )}
      <div className="ctf-wb__main">
        <div className="ctf-wb__tools" role="toolbar" aria-label="Whiteboard tools" aria-orientation="vertical">
          {TOOLS.map((t) => { const Icon = t.icon; return <button key={t.id} type="button" aria-label={t.label} title={t.label} aria-pressed={tool === t.id} className={tool === t.id ? 'is-on' : ''} onClick={() => setTool(t.id)}><Icon size={16} /></button> })}
        </div>
        <div className="ctf-wb__stage">
          <svg ref={svgRef} className={`ctf-wb__svg ${tool !== 'select' ? 'is-draw' : ''}`} role="application" aria-label="Whiteboard canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onDoubleClick={(e) => { const hit = shapeAt(board, toWorld(e), vp.zoom); if (hit && !isLinear(hit.type)) { setSel(hit.id); setEditing(hit.id) } }}>
            <defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke" /></marker></defs>
            <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom})`}>
              {ordered(board).map((s) => <ShapeView key={s.id} s={s} selected={s.id === sel} />)}
              {selected && !isLinear(selected.type) && <rect data-handle="resize" className="ctf-wb__handle" x={selected.x + selected.w - 6} y={selected.y + selected.h - 6} width={12 / Math.max(vp.zoom, 0.5)} height={12 / Math.max(vp.zoom, 0.5)} />}
              {selected && isLinear(selected.type) && (<>
                <circle data-handle="start" className="ctf-wb__handle" cx={selected.x} cy={selected.y} r={7 / Math.max(vp.zoom, 0.5)} />
                <circle data-handle="end" className="ctf-wb__handle" cx={selected.x2} cy={selected.y2} r={7 / Math.max(vp.zoom, 0.5)} />
              </>)}
            </g>
          </svg>
          {editing && selected && (
            <textarea aria-label="Edit text" className="ctf-wb__edit" autoFocus value={selected.text}
              style={{ left: selected.x * vp.zoom + vp.x, top: selected.y * vp.zoom + vp.y, width: Math.max(selected.w * vp.zoom, 120), height: Math.max(selected.h * vp.zoom, 60) }}
              onChange={(e) => act((b) => setText(b, selected.id, e.target.value))} onBlur={() => setEditing(null)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setEditing(null) }} />
          )}
          {board.shapes.length === 0 && <p className="ctf-wb__hint">Pick a shape on the left, then click the canvas. Drag empty space to pan; scroll to zoom. Sticky notes are the way to leave comments.</p>}
        </div>
        <div className="ctf-wb__side" aria-label="Selected shape">
          {selected ? (
            <>
              <div className="ctf-wb__swatches" role="group" aria-label="Colour">{COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={selected.color === c} className={selected.color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => act((b) => setColor(b, selected.id, c))} />)}</div>
              {!isLinear(selected.type) && <Button size="sm" variant="secondary" onClick={() => setEditing(selected.id)}>Edit text</Button>}
              <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={dup}>Duplicate</Button>
              <Button size="sm" variant="secondary" onClick={() => act((b) => bringToFront(b, selected.id))}>Bring to front</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={remove}>Delete</Button>
            </>
          ) : <p className="ctf-denv__muted">Select a shape to change its colour or text.</p>}
          <Badge tone="neutral">{board.shapes.length} {board.shapes.length === 1 ? 'shape' : 'shapes'}</Badge>
        </div>
      </div>
    </div>
  )
}

function ShapeView({ s, selected }: { s: Shape; selected: boolean }) {
  const sel = selected ? { strokeWidth: 3 } : { strokeWidth: 2 }
  if (s.type === 'line' || s.type === 'arrow') return <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={s.color} {...sel} strokeLinecap="round" markerEnd={s.type === 'arrow' ? 'url(#wb-arrow)' : undefined} />
  const lines = wrap(s.text, Math.max(6, Math.floor(s.w / 7.5)))
  const label = <text className="ctf-wb__text" x={s.x + s.w / 2} y={s.y + s.h / 2 - ((lines.length - 1) * 8)} textAnchor="middle" dominantBaseline="middle" fill={s.type === 'sticky' ? '#1c1917' : 'var(--text-primary)'}>{lines.map((l, i) => <tspan key={i} x={s.x + s.w / 2} dy={i === 0 ? 0 : 16}>{l}</tspan>)}</text>
  if (s.type === 'frame') return <g><rect x={s.x} y={s.y} width={s.w} height={s.h} rx={10} fill="none" stroke={s.color} strokeDasharray="8 6" {...sel} /><text x={s.x + 12} y={s.y + 20} fill={s.color} className="ctf-wb__frame-title">{s.text || 'Frame'}</text></g>
  if (s.type === 'text') return <g><rect x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" stroke={selected ? s.color : 'none'} strokeDasharray="4 3" />{label}</g>
  if (s.type === 'ellipse') return <g><ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={s.color} fillOpacity={0.16} stroke={s.color} {...sel} />{label}</g>
  if (s.type === 'sticky') return <g><rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4} fill={s.color} stroke={selected ? 'var(--text-primary)' : 'none'} strokeWidth={2} />{label}</g>
  return <g><rect x={s.x} y={s.y} width={s.w} height={s.h} rx={8} fill={s.color} fillOpacity={0.16} stroke={s.color} {...sel} />{label}</g>
}
