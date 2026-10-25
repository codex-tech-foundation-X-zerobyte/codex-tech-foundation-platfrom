import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newShape, moveShape, resizeShape, moveEndpoint, setText, deleteShape, duplicateShape, shapeAt, ordered, bringToFront,
  screenToWorld, zoomAt, parseBoard, fitViewport, startHistory, commit, undo, redo, MAX_SHAPES, MIN_ZOOM, MAX_ZOOM,
} from '../src/lib/whiteboard.ts'

const empty = { shapes: [] }
const add = (b, type, x, y, id) => newShape(b, type, { x, y }, id)

test('new shapes are centred on the click and stack in creation order', () => {
  let b = add(empty, 'rect', 100, 100, 'a')
  b = add(b, 'rect', 100, 100, 'b')
  const a = b.shapes.find((s) => s.id === 'a')
  assert.deepEqual([a.x, a.y, a.w, a.h], [20, 50, 160, 100])
  assert.deepEqual(ordered(b).map((s) => s.id), ['a', 'b'])
  assert.equal(shapeAt(b, { x: 100, y: 100 }).id, 'b')
})

test('frames sit behind other shapes and are only grabbed by their border band', () => {
  let b = add(empty, 'rect', 200, 200, 'box')
  b = add(b, 'frame', 200, 200, 'frame')
  assert.deepEqual(ordered(b).map((s) => s.id), ['frame', 'box'])
  assert.equal(shapeAt(b, { x: 200, y: 200 }).id, 'box')           // inside both: the box wins
  const f = b.shapes.find((s) => s.id === 'frame')
  assert.equal(shapeAt(b, { x: f.x + 4, y: f.y + 150 }).id, 'frame') // left border
  assert.equal(shapeAt(b, { x: f.x + 60, y: f.y + 60 }), null)       // empty interior is not a hit
})

test('moving a line or arrow moves both ends; endpoints can be dragged on their own', () => {
  let b = add(empty, 'arrow', 0, 0, 'ar')
  b = moveShape(b, 'ar', 10, 5)
  const s = b.shapes[0]
  assert.deepEqual([s.x, s.y, s.x2, s.y2], [-70, 5, 90, 5])
  b = moveEndpoint(b, 'ar', 'end', { x: 200, y: 200 })
  assert.deepEqual([b.shapes[0].x, b.shapes[0].x2, b.shapes[0].y2], [-70, 200, 200])
})

test('lines are hit within a few pixels, scaled by zoom', () => {
  const b = add(empty, 'line', 0, 0, 'ln')
  assert.equal(shapeAt(b, { x: 0, y: 6 }).id, 'ln')
  assert.equal(shapeAt(b, { x: 0, y: 30 }), null)
  assert.equal(shapeAt(b, { x: 0, y: 6 }, 4), null) // zoomed in: 8/4 = 2 world units of slop
})

test('ellipses are not hit in their corners', () => {
  const b = add(empty, 'ellipse', 100, 100, 'el')
  assert.equal(shapeAt(b, { x: 100, y: 100 }).id, 'el')
  assert.equal(shapeAt(b, { x: 22, y: 52 }), null)
})

test('resize respects a minimum, ignores lines, and text is capped', () => {
  let b = add(empty, 'rect', 0, 0, 'r')
  b = resizeShape(b, 'r', 1, 1)
  assert.deepEqual([b.shapes[0].w, b.shapes[0].h], [24, 24])
  b = add(b, 'line', 0, 0, 'l')
  assert.deepEqual(resizeShape(b, 'l', 500, 500).shapes[1], b.shapes[1])
  assert.equal(setText(b, 'r', 'x'.repeat(5000)).shapes[0].text.length, 2000)
})

test('delete, duplicate (offset, new id, on top) and bring to front', () => {
  let b = add(add(empty, 'rect', 0, 0, 'a'), 'rect', 0, 0, 'b')
  b = duplicateShape(b, 'a', 'a2')
  const a2 = b.shapes.find((s) => s.id === 'a2'), a = b.shapes.find((s) => s.id === 'a')
  assert.deepEqual([a2.x - a.x, a2.y - a.y], [24, 24])
  assert.equal(ordered(b).at(-1).id, 'a2')
  b = bringToFront(b, 'a')
  assert.equal(ordered(b).at(-1).id, 'a')
  assert.deepEqual(deleteShape(b, 'a').shapes.map((s) => s.id).sort(), ['a2', 'b'])
  assert.equal(duplicateShape(b, 'nope', 'x'), b)
})

test('a board cannot grow without bound', () => {
  let b = empty
  for (let i = 0; i < MAX_SHAPES + 10; i++) b = add(b, 'rect', i, i, `s${i}`)
  assert.equal(b.shapes.length, MAX_SHAPES)
})

test('zoom keeps the point under the cursor fixed and is clamped', () => {
  const vp = { x: 40, y: 20, zoom: 1 }
  const at = { x: 300, y: 200 }
  const before = screenToWorld(vp, at)
  const zoomed = zoomAt(vp, at, 2)
  const after = screenToWorld(zoomed, at)
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9)
  assert.equal(zoomAt(vp, at, 1000).zoom, MAX_ZOOM)
  assert.equal(zoomAt(vp, at, 0.0001).zoom, MIN_ZOOM)
})

test('parseBoard accepts good shapes and drops or repairs everything else', () => {
  const b = parseBoard({ shapes: [
    { id: 'ok', type: 'rect', x: 1, y: 2, w: 50, h: 60, text: 'hi', color: '#10b981', z: 3 },
    { id: 'ok', type: 'rect' },                                   // duplicate id
    { id: 'bad-type', type: 'script' },                           // unknown type
    { type: 'rect' },                                             // no id
    { id: 'huge', type: 'rect', x: 1e12, y: NaN, w: 99999, h: -5, color: 'javascript:alert(1)', text: 42 },
    { id: 'ln', type: 'arrow', x: 0, y: 0, x2: 10, y2: 10 },
  ] })
  assert.deepEqual(b.shapes.map((s) => s.id), ['ok', 'huge', 'ln'])
  const huge = b.shapes[1]
  assert.ok(huge.x <= 100000 && huge.y === 0 && huge.w === 5000 && huge.h === 24)
  assert.equal(huge.color, '#4a63ff')
  assert.equal(huge.text, '')
  assert.deepEqual(parseBoard(null), { shapes: [] })
  assert.deepEqual(parseBoard({ shapes: 'x' }), { shapes: [] })
})

test('fitViewport centres the content and handles an empty board', () => {
  assert.deepEqual(fitViewport(empty, { w: 800, h: 600 }), { x: 0, y: 0, zoom: 1 })
  const b = add(empty, 'rect', 0, 0, 'r')
  const vp = fitViewport(b, { w: 800, h: 600 })
  const c = screenToWorld(vp, { x: 400, y: 300 })
  assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6)
})

test('undo and redo walk through snapshots; a new edit clears redo', () => {
  let h = startHistory(empty)
  h = commit(h, add(h.present, 'rect', 0, 0, 'a'))
  h = commit(h, add(h.present, 'rect', 50, 50, 'b'))
  assert.equal(h.present.shapes.length, 2)
  h = undo(h); assert.equal(h.present.shapes.length, 1)
  h = undo(h); assert.equal(h.present.shapes.length, 0)
  assert.equal(undo(h), h)
  h = redo(h); assert.equal(h.present.shapes.length, 1)
  h = commit(h, add(h.present, 'rect', 9, 9, 'c'))
  assert.equal(h.future.length, 0)
  assert.equal(redo(h), h)
  assert.equal(commit(h, h.present), h)
})
