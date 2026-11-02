import { useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, Tabs, useToast } from '../../components/ui'
import { BulkBar } from '../../components/BulkActions'
import { TRASH_KINDS, listTrash, purgeExpiredTrash, purgeTrashItems, restoreTrashItems, type TrashItem } from '../../lib/services'
import { timeAgo } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useSelection } from '../../hooks/useSelection'

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))

/** Main Admin: everything deleted from blog, leads, careers, case studies, team, applications and files, for 30 days. */
export function AdminTrash() {
  // Housekeeping rides along with loading: anything past its 30 days goes for good (files included) before the list is read.
  const { data: items, error, loading, reload } = useAsyncData('once', async () => { await purgeExpiredTrash(); return listTrash() })
  const [filter, setFilter] = useState('all')
  const [purging, setPurging] = useState<TrashItem[] | null>(null)
  const [emptying, setEmptying] = useState(false)
  const { push } = useToast()

  // Housekeeping: anything past 30 days goes for good (files included) when the Main Admin opens this page.
  const visible = useMemo(() => (items ?? []).filter((i) => filter === 'all' || i.table_name === filter), [items, filter])
  const sel = useSelection(visible, (i) => i.id)
  const kinds = useMemo(() => [...new Set((items ?? []).map((i) => i.table_name))], [items])
  const tabs = [{ id: 'all', label: `All${items ? ` (${items.length})` : ''}` }, ...kinds.map((k) => ({ id: k, label: TRASH_KINDS[k] ?? k }))]

  const restore = async (ids: string[]) => {
    const { restored, error: err } = await restoreTrashItems(ids)
    push(err ? err.message : `${restored} item${restored === 1 ? '' : 's'} restored.`, err ? 'error' : 'success')
    sel.clear()
    reload()
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading
        eyebrow="System"
        title="Trash"
        description="Deleted items are kept for 30 days, then removed for good along with their uploaded files. Projects, workers and clients are not kept here."
        action={(items?.length ?? 0) > 0 ? <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setEmptying(true)}>Empty trash</Button> : undefined}
      />
      {tabs.length > 2 && <div className="ctf-filter-row"><Tabs tabs={tabs} active={filter} onChange={setFilter} /></div>}
      {loading && <SkeletonRows rows={4} />}
      {!loading && items && (
        <>
          <Table
            rows={visible}
            rowKey={(i) => i.id}
            selection={{ selected: sel.selected, onChange: sel.onChange, label: (i) => i.label || 'item' }}
            emptyState={<EmptyState icon={Trash2} title="Trash is empty" description="Things you delete from the blog, leads, careers, case studies, team and files show up here." />}
            columns={[
              { key: 'label', header: 'Item', render: (i) => <div><strong>{i.label || 'Untitled'}</strong></div> },
              { key: 'kind', header: 'Type', render: (i) => <Badge tone="neutral">{TRASH_KINDS[i.table_name] ?? i.table_name}</Badge> },
              { key: 'when', header: 'Deleted', render: (i) => <span title={new Date(i.deleted_at).toLocaleString()}>{timeAgo(i.deleted_at)}{i.deleted_by_name ? ` · ${i.deleted_by_name}` : ''}</span> },
              { key: 'left', header: 'Kept for', render: (i) => { const d = daysLeft(i.expires_at); return <Badge tone={d <= 3 ? 'danger' : 'neutral'}>{d} day{d === 1 ? '' : 's'}</Badge> } },
              {
                key: 'actions',
                header: '',
                render: (i) => (
                  <div className="ctf-row-actions">
                    <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={() => void restore([i.id])}>Restore</Button>
                    <Button variant="ghost" size="sm" className="ctf-delete-btn" icon={<Trash2 size={14} />} aria-label={`Delete ${i.label} forever`} onClick={() => setPurging([i])} />
                  </div>
                ),
              },
            ]}
          />
          <BulkBar count={sel.count} onClear={sel.clear}>
            <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={() => void restore(sel.ids)}>Restore {sel.count}</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setPurging(visible.filter((i) => sel.selected.has(i.id)))}>Delete {sel.count} forever</Button>
          </BulkBar>
        </>
      )}

      <ConfirmDialog
        open={purging !== null}
        onClose={() => setPurging(null)}
        title={purging && purging.length === 1 ? 'Delete forever?' : `Delete ${purging?.length ?? 0} items forever?`}
        confirmLabel="Delete forever"
        onConfirm={async () => {
          const { error: err } = await purgeTrashItems(purging ?? [])
          if (err) return err.message
          push('Deleted for good.')
          sel.clear(); reload()
          return null
        }}
      >
        <p>{purging && purging.length === 1 ? <><strong>{purging[0].label || 'This item'}</strong> and its uploaded files</> : 'These items and their uploaded files'} will be removed permanently. <strong>This cannot be undone.</strong></p>
      </ConfirmDialog>

      <ConfirmDialog
        open={emptying}
        onClose={() => setEmptying(false)}
        title="Empty the trash?"
        confirmLabel="Empty trash"
        typeToConfirm="EMPTY"
        onConfirm={async () => {
          const { error: err } = await purgeTrashItems(items ?? [])
          if (err) return err.message
          push('Trash emptied.')
          sel.clear(); reload()
          return null
        }}
      >
        <p>Everything in the trash ({items?.length ?? 0} item{items?.length === 1 ? '' : 's'}) and its uploaded files will be removed permanently. <strong>This cannot be undone.</strong></p>
      </ConfirmDialog>
    </div>
  )
}
