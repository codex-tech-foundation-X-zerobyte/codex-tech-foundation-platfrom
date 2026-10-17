import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, useToast } from './ui'
import { useAuth } from '../lib/auth'
import { restoreDeleted, type TrashTable } from '../lib/services'

interface DeleteButtonProps {
  /** What is being deleted, singular and lowercase: "post", "lead", "worker". Used in the title and the toast. */
  what: string
  /** The thing's own name, shown bold in the confirmation. */
  name: string
  onDelete: () => Promise<{ error: Error | null }>
  /** Called after a successful delete — typically the list's reload. */
  onDeleted?: () => void
  /** Extra consequences to spell out ("Its 4 applications will be deleted too."). */
  children?: ReactNode
  /** Require typing this before the button enables. Use for things that take real work or people with them. */
  typeToConfirm?: string
  label?: string
  size?: 'sm' | 'md'
  /** Show to every role. Default is Main Admin only, because that is who the database lets delete. */
  anyRole?: boolean
  /** When the delete goes to the trash, pass which table and row so the success message can offer "Undo". */
  undo?: { table: TrashTable; id: string }
}

export function DeleteButton({ what, name, onDelete, onDeleted, children, typeToConfirm, label = 'Delete', size = 'sm', anyRole = false, undo }: DeleteButtonProps) {
  const { profile } = useAuth()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  if (!anyRole && profile?.role !== 'superadmin') return null

  return (
    <>
      <Button variant="ghost" size={size} icon={<Trash2 size={14} />} className="ctf-delete-btn" onClick={() => setOpen(true)} aria-label={label ? undefined : `Delete ${what}: ${name}`} title={label ? undefined : `Delete ${what}`}>{label}</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete this ${what}?`}
        typeToConfirm={typeToConfirm}
        confirmLabel={`Delete ${what}`}
        onConfirm={async () => {
          const { error } = await onDelete()
          if (error) return error.message
          push(`${name ? `“${name}”` : `The ${what}`} was deleted.`, 'success', undo ? {
            action: {
              label: 'Undo',
              onClick: async () => {
                const { error: undoError } = await restoreDeleted(undo.table, [undo.id])
                push(undoError ? undoError.message : `${name ? `“${name}”` : `The ${what}`} was restored.`, undoError ? 'error' : 'success')
                onDeleted?.() // the list reloads either way
              },
            },
          } : undefined)
          onDeleted?.()
          return null
        }}
      >
        {undo
          ? <p><strong>{name || `This ${what}`}</strong> will be deleted. You can undo straight afterwards, and the Main Admin can restore it from the Trash for 30 days.</p>
          : <p><strong>{name || `This ${what}`}</strong> will be permanently deleted. This can&apos;t be undone.</p>}
        {children}
      </ConfirmDialog>
    </>
  )
}
