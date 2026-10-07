import type { KeyboardEvent, ReactNode } from 'react'
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
}

export function Table<T>({ columns, rows, rowKey, loading, emptyState, onRowClick, caption }: TableProps<T>) {
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
          <tr>{columns.map((col) => <th key={col.key} scope="col" style={{ width: col.width }}>{col.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'is-clickable' : ''}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(e) => onRowKey(e, row)}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
