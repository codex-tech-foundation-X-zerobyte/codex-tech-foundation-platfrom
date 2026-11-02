import { useState, type ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, useToast } from './ui'
import { deleteMany, restoreDeleted, type TrashTable } from '../lib/services'
import { useAuth } from '../lib/auth'
import './BulkActions.css'

/** Floats at the bottom of the screen while rows are ticked. Put the bulk controls inside as children. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children?: ReactNode }) {
  if (count === 0) return null
  return (
    <div className="ctf-bulkbar" role="region" aria-label="Bulk actions">
      <span className="ctf-bulkbar__count" aria-live="polite">{count} selected</span>
      <div className="ctf-bulkbar__actions">{children}</div>
      <button type="button" className="ctf-bulkbar__clear" onClick={onClear} aria-label="Clear selection"><X size={16} /></button>
    </div>
  )
}

interface BulkDeleteProps {
  table: TrashTable
  ids: string[]
  /** Singular, lowercase: "lead". */
  what: string
  plural?: string
  onDone: () => void
  /** Extra consequences to spell out in the confirmation. */
  children?: ReactNode
  /** Offer to every role that can see the list (use for files, which workers may delete). Default: Main Admin only. */
  anyRole?: boolean
}

/** Delete every ticked row after one confirmation, then offer Undo. */
export function BulkDelete({ table, ids, what, plural, onDone, children, anyRole = false }: BulkDeleteProps) {
  const { profile } = useAuth()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  if (!anyRole && profile?.role !== 'superadmin') return null
  const noun = (n: number) => (n === 1 ? what : plural ?? `${what}s`)

  return (
    <>
      <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setOpen(true)}>Delete {ids.length}</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${ids.length} ${noun(ids.length)}?`}
        confirmLabel={`Delete ${ids.length} ${noun(ids.length)}`}
        onConfirm={async () => {
          const { removed, error } = await deleteMany(table, ids)
          if (error) return removed > 0 ? `${removed} deleted before something went wrong: ${error.message}` : error.message
          push(`${removed} ${noun(removed)} deleted.`, 'success', {
            action: {
              label: 'Undo',
              onClick: async () => {
                const { restored, error: undoError } = await restoreDeleted(table, ids)
                push(undoError ? undoError.message : `${restored} ${noun(restored)} restored.`, undoError ? 'error' : 'success')
                onDone()
              },
            },
          })
          onDone()
          return null
        }}
      >
        <p>These {ids.length} {noun(ids.length)} will be deleted. You can undo straight afterwards, and the Main Admin can restore them from the Trash for 30 days.</p>
        {children}
      </ConfirmDialog>
    </>
  )
}
