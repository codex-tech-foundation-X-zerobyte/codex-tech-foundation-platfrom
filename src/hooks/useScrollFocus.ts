import { useEffect, useState, type HTMLAttributes } from 'react'

/**
 * Keyboard users cannot scroll a box that only the mouse can reach (WCAG 2.1.1; axe: scrollable-region-focusable).
 * Spread the result on a scrolling element: it becomes a focusable, named region only while its content really overflows,
 * so short modals and tables do not gain a pointless extra tab stop.
 *
 *   const scroll = useScrollFocus<HTMLDivElement>('Dialog content')   // pass 'native' as 2nd argument for <ol>/<ul>, which keep their list role
 *   <div className="ctf-modal__body" {...scroll}>
 *
 * Nothing is measured during render (it reads layout inside observer callbacks only), and nothing happens where
 * ResizeObserver is missing (old browsers, jsdom): the element is then simply not focusable, as before.
 */
export function useScrollFocus<T extends HTMLElement>(label: string, role: 'region' | 'native' = 'region') {
  const [node, setNode] = useState<T | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
    const ro = new ResizeObserver(measure) // fires once on observe, then on every size change
    ro.observe(node)
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure) // content added or removed
    mo?.observe(node, { childList: true, subtree: true, characterData: true })
    return () => { ro.disconnect(); mo?.disconnect() }
  }, [node])

  const props: HTMLAttributes<T> & { ref: (el: T | null) => void } = { ref: setNode }
  if (overflowing) {
    props.tabIndex = 0   // enough for the keyboard to scroll it
    if (label) {        // only a box with a real name is announced as a region: unnamed ones would collide (two "Table" regions on one page)
      props['aria-label'] = label
      if (role === 'region') props.role = 'region' // a generic div/pre may not carry a label without a role; a list keeps its own role
    }
  }
  return props
}
