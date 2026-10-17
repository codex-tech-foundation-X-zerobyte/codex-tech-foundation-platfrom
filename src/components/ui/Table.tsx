import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { SkeletonRows } from './Skeleton'
import './Table.css'

interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  width?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyState?: ReactNode
  onRowClick?: (row: T) => void
  /** Accessible name for the table, announced by screen readers. */
  caption?: string
  /** Adds a checkbox column. The caller owns the selected ids (see useSelection). */
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void; label?: (row: T) => string }
}

export function Table<T>({ columns, rows, rowKey, loading, emptyState, onRowClick, caption, selection }: TableProps<T>) {
  const headCheckbox = useRef<HTMLInputElement>(null)
  const selectedCount = selection ? rows.filter((r) => selection.selected.has(rowKey(r))).length : 0
  const allSelected = rows.length > 0 && selectedCount === rows.length
  // "Some but not all" has no HTML attribute; it is a DOM property.
  useEffect(() => { if (headCheckbox.current) headCheckbox.current.indeterminate = selectedCount > 0 && !allSelected }, [selectedCount, allSelected])

  if (loading) return <SkeletonRows rows={5} />
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  // Clickable rows must be reachable and operable without a mouse.
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!onRowClick || e.target !== e.currentTarget) return // don't hijack keys pressed inside a nested control
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick(row)
    }
  }

  return (
    <div className="ctf-table-wrap">
      <table className="ctf-table">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="ctf-table__select">
                <input ref={headCheckbox} type="checkbox" checked={allSelected} aria-label="Select all rows"
                  onChange={() => selection.onChange(allSelected ? new Set() : new Set(rows.map(rowKey)))} />
              </th>
            )}
            {columns.map((col) => <th key={col.key} scope="col" style={{ width: col.width }}>{col.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`${onRowClick ? 'is-clickable' : ''} ${selection?.selected.has(rowKey(row)) ? 'is-selected' : ''}`.trim()}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(e) => onRowKey(e, row)}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {selection && (
                <td className="ctf-table__select" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selection.selected.has(rowKey(row))} aria-label={selection.label ? `Select ${selection.label(row)}` : 'Select row'}
                    onChange={() => { const next = new Set(selection.selected); const k = rowKey(row); if (next.has(k)) next.delete(k); else next.add(k); selection.onChange(next) }} />
                </td>
              )}
              {columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
