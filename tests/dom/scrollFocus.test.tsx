import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrollFocus } from '../../src/hooks/useScrollFocus'

let roCallbacks: Array<() => void> = []
class FakeRO { constructor(cb: () => void) { roCallbacks.push(cb) } observe() {} disconnect() {} }
class FakeMO { constructor(_cb: () => void) {} observe() {} disconnect() {} }

function setSize(el: HTMLElement, o: { sh: number; ch: number; sw?: number; cw?: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: o.sh })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: o.ch })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: o.sw ?? 100 })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: o.cw ?? 100 })
}
const flush = () => act(async () => { roCallbacks.forEach((cb) => cb()) })

function Box({ native = false }: { native?: boolean }) {
  const props = useScrollFocus<HTMLDivElement>('Dialog content', native ? 'native' : 'region')
  return <div data-testid="box" {...props}>content</div>
}

describe('useScrollFocus', () => {
  beforeEach(() => { roCallbacks = []; vi.stubGlobal('ResizeObserver', FakeRO); vi.stubGlobal('MutationObserver', FakeMO) })
  afterEach(() => vi.unstubAllGlobals())

  it('does not add a tab stop while the content fits', async () => {
    render(<Box />)
    setSize(screen.getByTestId('box'), { sh: 100, ch: 100 })
    await flush()
    const el = screen.getByTestId('box')
    expect(el.hasAttribute('tabindex')).toBe(false)
    expect(el.hasAttribute('role')).toBe(false)
  })

  it('becomes a focusable, named region once the content overflows, so the keyboard can scroll it', async () => {
    render(<Box />)
    setSize(screen.getByTestId('box'), { sh: 400, ch: 200 })
    await flush()
    const el = screen.getByTestId('box')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.getAttribute('role')).toBe('region')
    expect(el.getAttribute('aria-label')).toBe('Dialog content')
  })

  it('also reacts to sideways overflow', async () => {
    render(<Box />)
    setSize(screen.getByTestId('box'), { sh: 100, ch: 100, sw: 900, cw: 300 })
    await flush()
    expect(screen.getByTestId('box').getAttribute('tabindex')).toBe('0')
  })

  it('keeps a list its own role (a role override would orphan the list items)', async () => {
    render(<Box native />)
    setSize(screen.getByTestId('box'), { sh: 400, ch: 200 })
    await flush()
    const el = screen.getByTestId('box')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.hasAttribute('role')).toBe(false)
    expect(el.getAttribute('aria-label')).toBe('Dialog content')
  })

  it('an unnamed box is focusable but is not announced as a region, so two of them cannot collide', async () => {
    function Unnamed() { const props = useScrollFocus<HTMLDivElement>(''); return <div data-testid="box" {...props}>x</div> }
    render(<Unnamed />)
    setSize(screen.getByTestId('box'), { sh: 400, ch: 200 })
    await flush()
    const el = screen.getByTestId('box')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.hasAttribute('role')).toBe(false)
    expect(el.hasAttribute('aria-label')).toBe(false)
  })

  it('goes back to not focusable when the content shrinks', async () => {
    render(<Box />)
    const el = screen.getByTestId('box')
    setSize(el, { sh: 400, ch: 200 }); await flush()
    expect(el.getAttribute('tabindex')).toBe('0')
    setSize(el, { sh: 100, ch: 200 }); await flush()
    expect(el.hasAttribute('tabindex')).toBe(false)
  })

  it('does nothing, and does not crash, where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Box />)
    expect(screen.getByTestId('box').hasAttribute('tabindex')).toBe(false)
  })
})

import { Table } from '../../src/components/ui/Table'
describe('Table keeps a stable hook order across loading, empty and filled renders', () => {
  it('does not throw when it goes from loading to rows to empty', () => {
    const cols = [{ key: 'a', header: 'A', render: (r: { id: string }) => r.id }]
    const { rerender } = render(<Table columns={cols} rows={[]} rowKey={(r) => r.id} loading />)
    rerender(<Table columns={cols} rows={[{ id: 'x' }]} rowKey={(r) => r.id} caption="Things" />)
    expect(screen.getByText('x')).toBeTruthy()
    rerender(<Table columns={cols} rows={[]} rowKey={(r) => r.id} emptyState={<p>Nothing</p>} />)
    expect(screen.getByText('Nothing')).toBeTruthy()
    rerender(<Table columns={cols} rows={[{ id: 'y' }]} rowKey={(r) => r.id} />)
    expect(screen.getByText('y')).toBeTruthy()
  })
})

describe('Table column headers are never empty for assistive technology', () => {
  it('names a header-less column "Actions" for screen readers only', () => {
    const cols = [{ key: 'a', header: 'Name', render: (r: { id: string }) => r.id }, { key: 'act', header: '', render: () => <button>Go</button> }]
    render(<Table columns={cols} rows={[{ id: 'x' }]} rowKey={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy()
  })
})
