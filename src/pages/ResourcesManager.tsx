import { useMemo, useState } from 'react'
import {
  AlertCircle, Archive, Download, ExternalLink, Eye, File as FileIcon, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, Music, Pencil, Presentation, RotateCw, Video, X,
  type LucideIcon,
} from 'lucide-react'
import { Button, EmptyState, ErrorState, FieldWrap, Input, Modal, SearchInput, SkeletonRows, Tabs, useToast } from '../components/ui'
import { BulkBar, BulkDelete } from '../components/BulkActions'
import { DeleteButton } from '../components/DeleteButton'
import { FileDropZone } from '../components/FileDropZone'
import { ResourcePreview } from '../components/ResourcePreview'
import { RESOURCE_MAX_MB, createLinkResource, createResourceWithFile, deleteResource, downloadResource, listResources, renameResource } from '../lib/services'
import { KIND_LABEL, formatBytes, resourceKind, titleFromFilename, type ResourceKind } from '../lib/resourceKinds'
import { hostOf, titleFromUrl } from '../lib/links'
import { timeAgo } from '../lib/format'
import { useAuth } from '../lib/auth'
import { useAsyncData } from '../hooks/useAsyncData'
import { useSelection } from '../hooks/useSelection'
import type { Resource } from '../lib/types'
import './ResourcesManager.css'

const ICONS: Record<ResourceKind, LucideIcon> = {
  link: Link2, image: ImageIcon, pdf: FileText, video: Video, audio: Music, text: FileText, document: FileText, spreadsheet: FileSpreadsheet, presentation: Presentation, archive: Archive, file: FileIcon,
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Links' },
  { id: 'images', label: 'Images' },
]

/** A file or link that has been dropped but is not in the list yet (or failed to get there). Shown immediately. */
interface Pending { id: string; name: string; isLink: boolean; status: 'working' | 'error'; error?: string; file?: File; url?: string }

/** Runs `worker` over `items` with at most `limit` in flight, so dropping thirty files doesn't open thirty uploads. */
async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++])
  }))
}

export function ResourcesManager() {
  const { profile } = useAuth()
  const { data: resources, error, loading, reload } = useAsyncData('once', listResources)
  const { push } = useToast()
  const [pending, setPending] = useState<Pending[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [viewing, setViewing] = useState<Resource | null>(null)
  const [renaming, setRenaming] = useState<Resource | null>(null)
  const [busyDownload, setBusyDownload] = useState<string | null>(null)

  // Managers can look at files (the database lets them) but not add or remove them.
  const canEdit = profile?.role === 'worker' || profile?.role === 'superadmin'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (resources ?? []).filter((r) => {
      const kind = resourceKind(r)
      const inFilter = filter === 'all' || (filter === 'links' ? kind === 'link' : filter === 'files' ? kind !== 'link' : kind === 'image')
      return inFilter && (!q || `${r.title} ${r.description} ${r.owner_name ?? ''} ${r.url ?? ''}`.toLowerCase().includes(q))
    })
  }, [resources, query, filter])
  const sel = useSelection(visible, (r) => r.id)

  const settle = (id: string, error?: string) => setPending((cur) => error ? cur.map((p) => p.id === id ? { ...p, status: 'error', error } : p) : cur.filter((p) => p.id !== id))

  const run = async (items: Pending[]) => {
    let added = 0
    await runLimited(items, 3, async (item) => {
      const { error: err } = item.isLink
        ? await createLinkResource({ title: titleFromUrl(item.url as string), url: item.url as string, description: '', category: 'general' })
        : await createResourceWithFile({ title: titleFromFilename(item.name), description: '', category: 'general' }, item.file as File)
      if (!err) { added += 1; reload() }
      settle(item.id, err?.message ?? undefined)
    })
    if (added > 0) push(added === 1 ? 'Added.' : `${added} items added.`)
  }

  const addFiles = (files: File[]) => {
    const items = files.map((file): Pending => ({ id: crypto.randomUUID(), name: file.name, isLink: false, status: 'working', file }))
    setPending((cur) => [...items, ...cur])
    void run(items)
  }
  const addLinks = (urls: string[]) => {
    const known = new Set((resources ?? []).map((r) => r.url).filter(Boolean))
    const fresh = urls.filter((u) => !known.has(u))
    if (fresh.length < urls.length) push(urls.length === 1 ? 'That link is already here.' : `${urls.length - fresh.length} already here — skipped.`, 'info')
    const items = fresh.map((url): Pending => ({ id: crypto.randomUUID(), name: titleFromUrl(url), isLink: true, status: 'working', url }))
    if (!items.length) return
    setPending((cur) => [...items, ...cur])
    void run(items)
  }
  const retry = (item: Pending) => {
    setPending((cur) => cur.map((p) => p.id === item.id ? { ...p, status: 'working', error: undefined } : p))
    void run([{ ...item, status: 'working' }])
  }

  const save = async (resource: Resource) => {
    setBusyDownload(resource.id)
    const { error: err } = await downloadResource(resource)
    setBusyDownload(null)
    if (err) push(err.message, 'error')
  }

  return (
    <div className="ctf-res">
      {canEdit && <FileDropZone onFiles={addFiles} onLinks={addLinks} onReject={(m) => push(m, 'error')} maxMb={RESOURCE_MAX_MB} />}

      {pending.length > 0 && (
        <ul className="ctf-res__pending" aria-label="Being added">
          {pending.map((p) => (
            <li key={p.id} className={p.status === 'error' ? 'is-error' : ''}>
              {p.status === 'working' ? <Loader2 size={16} className="ctf-res__spin" aria-hidden /> : <AlertCircle size={16} aria-hidden />}
              <div><strong>{p.name}</strong><small>{p.status === 'working' ? (p.isLink ? 'Adding link…' : 'Uploading…') : p.error}</small></div>
              {p.status === 'error' && (
                <>
                  <Button variant="ghost" size="sm" icon={<RotateCw size={14} />} onClick={() => retry(p)}>Retry</Button>
                  <button type="button" className="ctf-res__x" aria-label={`Dismiss ${p.name}`} onClick={() => setPending((cur) => cur.filter((x) => x.id !== p.id))}><X size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <ErrorState onRetry={reload} />}
      {!error && loading && <SkeletonRows rows={4} />}

      {!error && !loading && resources !== null && (
        <>
          {resources.length > 0 && (
            <div className="ctf-res__tools">
              <Tabs tabs={FILTERS} active={filter} onChange={setFilter} />
              <SearchInput value={query} onChange={setQuery} placeholder="Search files and links" aria-label="Search files and links" />
            </div>
          )}

          {resources.length === 0 && pending.length === 0 && (
            <EmptyState icon={FolderOpen} title="Nothing here yet" description={canEdit ? 'Drop files or links above, or paste them. They appear here straight away.' : 'Files and links shared with you will appear here.'} />
          )}
          {resources.length > 0 && visible.length === 0 && <EmptyState icon={FolderOpen} title="Nothing matches" description="Try a different search or filter." />}

          {visible.length > 0 && (
            <ul className="ctf-res__list">
              {visible.map((r) => {
                const kind = resourceKind(r)
                const Icon = ICONS[kind]
                const isLink = kind === 'link'
                const meta = [KIND_LABEL[kind], isLink && r.url ? hostOf(r.url) : formatBytes(r.size_bytes), r.owner_name, timeAgo(r.created_at)].filter(Boolean).join(' · ')
                return (
                  <li key={r.id} className={sel.selected.has(r.id) ? 'is-selected' : ''}>
                    {canEdit && (
                      <input type="checkbox" className="ctf-res__check" checked={sel.selected.has(r.id)} aria-label={`Select ${r.title}`}
                        onChange={() => { const next = new Set(sel.selected); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); sel.onChange(next) }} />
                    )}
                    <span className={`ctf-res__icon ctf-res__icon--${kind}`} aria-hidden><Icon size={20} /></span>
                    <button type="button" className="ctf-res__main" onClick={() => setViewing(r)}>
                      <strong>{r.title}</strong>
                      <small>{meta}</small>
                    </button>
                    <div className="ctf-res__actions">
                      <Button variant="ghost" size="sm" icon={<Eye size={14} />} onClick={() => setViewing(r)}>View</Button>
                      {isLink
                        ? <a className="ctf-btn ctf-btn--ghost ctf-btn--sm ctf-res__open" href={r.url ?? '#'} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink size={14} aria-hidden /> Open</a>
                        : <Button variant="ghost" size="sm" icon={<Download size={14} />} loading={busyDownload === r.id} onClick={() => void save(r)}>Download</Button>}
                      {canEdit && <Button variant="ghost" size="sm" icon={<Pencil size={14} />} aria-label={`Rename ${r.title}`} onClick={() => setRenaming(r)} />}
                      {canEdit && <DeleteButton what={isLink ? 'link' : 'file'} name={r.title} label="" anyRole onDelete={() => deleteResource(r)} undo={{ table: 'resources', id: r.id }} onDeleted={reload} />}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {canEdit && (
            <BulkBar count={sel.count} onClear={sel.clear}>
              <BulkDelete table="resources" ids={sel.ids} what="item" anyRole onDone={() => { sel.clear(); reload() }} />
            </BulkBar>
          )}
        </>
      )}

      {viewing && <ResourcePreview resource={viewing} onClose={() => setViewing(null)} />}
      {renaming && <RenameModal resource={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); reload() }} />}
    </div>
  )
}

function RenameModal({ resource, onClose, onSaved }: { resource: Resource; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(resource.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setSaving(true); setError('')
    const { error: err } = await renameResource(resource.id, title)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Rename" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void submit()}>Save</Button></>}>
      <FieldWrap label="Title" htmlFor="res-rename">
        <Input id="res-rename" value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void submit() }} />
      </FieldWrap>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
    </Modal>
  )
}
