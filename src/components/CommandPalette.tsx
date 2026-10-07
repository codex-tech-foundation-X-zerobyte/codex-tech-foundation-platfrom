import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import './CommandPalette.css'

export interface PaletteItem {
  id: string
  label: string
  group: string
  hint?: string
  keywords?: string[]
  icon: ComponentType<{ size?: number }>
  run: () => void
}

/** Subsequence-aware scoring: exact/prefix/word-start beat scattered matches; no match returns -1. */
function score(item: PaletteItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const label = item.label.toLowerCase()
  const haystack = [label, ...(item.keywords ?? []).map((k) => k.toLowerCase()), (item.hint ?? '').toLowerCase()]
  if (label === q) return 100
  if (label.startsWith(q)) return 90
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 80
  if (label.includes(q)) return 70
  if (haystack.slice(1).some((h) => h.includes(q))) return 50
  // in-order character match, e.g. "jwt" -> "JWT decoder", "dt" -> "Dev tools"
  let i = 0
  for (const ch of label) if (ch === q[i]) i++
  return i === q.length ? 30 : -1
}

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  const results = useMemo(() => {
    const scored = items.map((item) => ({ item, s: score(item, query) })).filter((r) => r.s >= 0)
    if (query.trim()) scored.sort((a, b) => b.s - a.s)
    return scored.map((r) => r.item).slice(0, 30)
  }, [items, query])

  // Reset when reopened. Done during render (not in an effect) via the key-on-open pattern below.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previouslyFocused?.focus?.({ preventScroll: true })
  }, [open])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  if (!open) return null

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return
    onCloseRef.current()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]) }
    else if (e.key === 'Tab') e.preventDefault() // keep focus in the input; arrows navigate
  }

  return createPortal(
    <div className="ctf-palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ctf-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="ctf-palette__input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            placeholder="Search pages, tools and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="ctf-palette-list"
            aria-activedescendant={results[active] ? `ctf-palette-${results[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="kbd">esc</span>
        </div>
        <ul className="ctf-palette__list" id="ctf-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="ctf-palette__empty">Nothing matches “{query}”.</li>}
          {results.map((item, i) => {
            const header = !query.trim() && item.group !== results[i - 1]?.group ? item.group : null
            const Icon = item.icon
            return (
              <li key={item.id} role="presentation">
                {header && <div className="ctf-palette__group">{header}</div>}
                <div
                  id={`ctf-palette-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`ctf-palette__item ${i === active ? 'is-active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <Icon size={16} />
                  <span className="ctf-palette__label">{item.label}</span>
                  {item.hint && <span className="ctf-palette__hint">{item.hint}</span>}
                  {i === active && <CornerDownLeft size={13} aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="ctf-palette__foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span>
          <span><span className="kbd">↵</span> to open</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
