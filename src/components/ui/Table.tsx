import type { ReactNode } from 'react'
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
}

export function Table<T>({ columns, rows, rowKey, loading, emptyState, onRowClick }: TableProps<T>) {
  if (loading) return <SkeletonRows rows={5} />
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  return (
    <div className="ctf-table-wrap">
      <table className="ctf-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width }}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={onRowClick ? 'is-clickable' : ''} onClick={() => onRowClick?.(row)}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
