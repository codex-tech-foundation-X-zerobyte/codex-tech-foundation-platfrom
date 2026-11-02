import { useEffect, useRef, useState } from 'react'

/**
 * True once the element has scrolled into view (and stays true — reveals are one-shot, not toggling).
 * If IntersectionObserver doesn't exist, content is simply shown: an animation must never be able to hide content.
 */
export function useReveal<T extends HTMLElement>(threshold = 0.18) {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, visible])

  return { ref, visible }
}
