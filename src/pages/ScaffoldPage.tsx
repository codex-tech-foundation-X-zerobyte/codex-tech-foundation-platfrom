import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState, SkeletonRows } from '../components/ui'
import { countRows } from '../lib/services'

interface ScaffoldPageProps {
  icon: LucideIcon
  title: string
  description: string
  table?: string
  countLabel?: string
  action?: React.ReactNode
}

/**
 * Used for workspace sections that are wired to real data counts but don't yet have
 * a bespoke interface. Each instance is specific to its page — never the generic
 * "Private data stays private" placeholder every route used to share.
 */
export function ScaffoldPage({ icon, title, description, table, countLabel, action }: ScaffoldPageProps) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!table) return
    void countRows(table).then(({ count: c, error }) => setCount(error ? null : c))
  }, [table])

  return (
    <div>
      {table && (
        <div style={{ marginBottom: 24, fontSize: 13, color: 'var(--text-tertiary)' }}>
          {count === null ? <SkeletonRows rows={1} height="20px" /> : <span>{count} {countLabel ?? 'records'} in the system</span>}
        </div>
      )}
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </div>
  )
}
