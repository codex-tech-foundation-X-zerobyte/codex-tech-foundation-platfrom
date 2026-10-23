import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clampRect, FloatingPanel } from '../../src/components/FloatingPanel'

const MIN = { w: 260, h: 150 }

describe('clampRect', () => {
  const vp = { w: 1000, h: 700 }
  it('pulls a panel dragged off the screen back so its title bar is always reachable', () => {
    expect(clampRect({ x: -400, y: -50, w: 300, h: 200 }, MIN, vp)).toMatchObject({ x: 8, y: 8 })
    expect(clampRect({ x: 5000, y: 5000, w: 300, h: 200 }, MIN, vp)).toMatchObject({ x: 1000 - 300 - 8, y: 700 - 200 - 8 })
  })
  it('never lets a panel be bigger than the screen, or smaller than its minimum', () => {
    expect(clampRect({ x: 0, y: 0, w: 9999, h: 9999 }, MIN, vp)).toMatchObject({ w: 984, h: 684 })
    expect(clampRect({ x: 0, y: 0, w: 10, h: 10 }, MIN, vp)).toMatchObject({ w: 260, h: 150 })
  })
  it('copes with a phone narrower than the minimum width', () => {
    const r = clampRect({ x: 0, y: 0, w: 400, h: 300 }, MIN, { w: 240, h: 500 })
    expect(r.w).toBeLessThanOrEqual(240 - 16)
  })
})

describe('FloatingPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })

  const mount = () => render(
    <FloatingPanel id="t" label="Test call" title="Maya" defaultSize={{ w: 400, h: 300 }} footer={<button>End</button>}>
      <audio data-testid="remote-audio" />
    </FloatingPanel>,
  )
  const panel = () => screen.getByRole('dialog', { name: 'Test call' }) as HTMLElement

  it('opens docked bottom-right, inside the screen', () => {
    mount()
    expect(panel().style.left).toBe(`${1200 - 400 - 20}px`)
    expect(panel().style.top).toBe(`${800 - 300 - 20}px`)
  })

  it('moves when the title bar is dragged, and remembers where it was left', () => {
    mount()
    const head = panel().querySelector('header') as HTMLElement
    fireEvent.pointerDown(head, { clientX: 500, clientY: 500, pointerId: 1, button: 0 })
    fireEvent.pointerMove(head, { clientX: 300, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(head, { clientX: 300, clientY: 400, pointerId: 1 })
    expect(panel().style.left).toBe(`${780 - 200}px`)
    expect(panel().style.top).toBe(`${480 - 100}px`)
    expect(JSON.parse(localStorage.getItem('ctf:panel:t')!)).toMatchObject({ x: 580, y: 380 })
  })

  it('cannot be dragged off the screen', () => {
    mount()
    const head = panel().querySelector('header') as HTMLElement
    fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1, button: 0 })
    fireEvent.pointerMove(head, { clientX: -9000, clientY: -9000, pointerId: 1 })
    fireEvent.pointerUp(head, { pointerId: 1 })
    expect(panel().style.left).toBe('8px')
    expect(panel().style.top).toBe('8px')
  })

  it('resizes from its corner handle', () => {
    mount()
    const handle = panel().querySelector('.ctf-fp__edge--nw') as HTMLElement
    fireEvent.pointerDown(handle, { clientX: 780, clientY: 480, pointerId: 2, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 680, clientY: 380, pointerId: 2 })
    fireEvent.pointerUp(handle, { pointerId: 2 })
    expect(panel().style.width).toBe('500px')
    expect(panel().style.height).toBe('400px')
  })

  it('restores a saved position next time, even after the window shrank', () => {
    localStorage.setItem('ctf:panel:t', JSON.stringify({ x: 5000, y: 5000, w: 400, h: 300 }))
    mount()
    expect(parseInt(panel().style.left, 10)).toBeLessThanOrEqual(1200 - 400)
  })

  it('keeps the call audio element mounted while minimised, so the call does not go silent', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /minimise call window/i }))
    expect(panel().contains(screen.getByTestId('remote-audio'))).toBe(true)
    expect((panel().querySelector('.ctf-fp__body') as HTMLElement).hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /expand call window/i }))
    expect((panel().querySelector('.ctf-fp__body') as HTMLElement).hidden).toBe(false)
  })

  it('maximises and restores', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /maximise call window/i }))
    expect(panel().classList.contains('ctf-fp--max')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /restore call window/i }))
    expect(panel().classList.contains('ctf-fp--normal')).toBe(true)
  })

  it('can be moved from the keyboard', () => {
    mount()
    const head = panel().querySelector('header') as HTMLElement
    const before = parseInt(panel().style.left, 10)
    fireEvent.keyDown(head, { key: 'ArrowLeft' })
    expect(parseInt(panel().style.left, 10)).toBe(before - 16)
  })
})
