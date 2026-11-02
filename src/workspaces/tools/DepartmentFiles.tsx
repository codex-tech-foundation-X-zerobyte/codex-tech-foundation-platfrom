import { useState } from 'react'
import { Download, ExternalLink, Eye, Link2, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, SkeletonRows, useToast } from '../../components/ui'
import { FileDropZone } from '../../components/FileDropZone'
import { ResourcePreview } from '../../components/ResourcePreview'
import {
  RESOURCE_MAX_MB, createLinkResource, createResourceWithFile, deleteResource, downloadResource, listDepartmentFiles, type DepartmentRow, type DepartmentFile,
} from '../../lib/services'
import { KIND_LABEL, formatBytes, resourceKind, titleFromFilename } from '../../lib/resourceKinds'
import { hostOf, titleFromUrl } from '../../lib/links'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Viewer } from '../DepartmentWork'
import type { Resource } from '../../lib/types'

/** A department's own file shelf for one category (brand assets, media, final assets, design versions). Scoped by the database to the department. */
export function DepartmentFiles({ row, category, heading }: { row: DepartmentRow; category: string; heading: string; viewer: Viewer }) {
  const files = useAsyncData(`dfiles:${row.id}:${category}`, () => listDepartmentFiles(row.id, category))
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(0)
  const [viewing, setViewing] = useState<DepartmentFile | null>(null)
  const { push } = useToast()

  // Everything dropped, pasted or typed in lands here: files and links alike, added straight away, with the optional note.
  const add = async (jobs: Array<() => Promise<{ error: Error | null }>>) => {
    setWorking((n) => n + jobs.length)
    let added = 0
    for (const job of jobs) {
      const { error } = await job()
      setWorking((n) => n - 1)
      if (error) push(error.message, 'error'); else { added += 1; files.reload() }
    }
    if (added) push(added === 1 ? 'Added.' : `${added} items added.`)
  }
  const base = { description: note.trim(), category, department_id: row.id }
  const addFiles = (list: File[]) => void add(list.map((f) => () => createResourceWithFile({ ...base, title: titleFromFilename(f.name) }, f)))
  const addLinks = (urls: string[]) => void add(urls.map((url) => () => createLinkResource({ ...base, title: titleFromUrl(url), url })))

  const remove = async (f: DepartmentFile) => {
    const { error } = await deleteResource(f)
    if (error) push(error.message, 'error'); else { push('Removed.'); files.reload() }
  }

  return (
    <div className="ctf-denv__stack">
      <h3 className="ctf-denv__h3">{heading}</h3>
      <FileDropZone onFiles={addFiles} onLinks={addLinks} onReject={(m) => push(m, 'error')} maxMb={RESOURCE_MAX_MB} hint="only your department can see it" />
      <FieldWrap label="Note" htmlFor="df-note" hint="Optional — added to everything you drop next: version, usage, who approved it">
        <Input id="df-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </FieldWrap>
      {working > 0 && <p className="ctf-denv__muted" role="status">Adding {working} item{working === 1 ? '' : 's'}…</p>}

      {files.loading ? <SkeletonRows rows={2} /> : files.error ? <ErrorState title="Files couldn't load" description={files.errorDetail?.message ?? 'Try again.'} onRetry={files.reload} /> : ((files.data ?? []).length === 0
        ? <EmptyState title="No files yet" description="Drop the first one above." />
        : (
          <ul className="ctf-rec__list">
            {(files.data ?? []).map((f) => {
              const kind = resourceKind(f)
              const isLink = kind === 'link'
              const meta = [KIND_LABEL[kind], isLink && f.url ? hostOf(f.url) : formatBytes(f.size_bytes), f.description, new Date(f.created_at).toLocaleDateString()].filter(Boolean).join(' · ')
              return (
                <li key={f.id} className="ctf-rec__row">
                  <div className="ctf-rec__main">
                    <strong>{isLink && <Link2 size={13} aria-hidden style={{ marginRight: 6, verticalAlign: '-2px' }} />}{f.title}</strong>
                    <span className="ctf-denv__muted">{meta}</span>
                  </div>
                  <Badge tone="neutral">{category}</Badge>
                  <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={() => setViewing(f)}>View</Button>
                  {isLink
                    ? <a className="ctf-btn ctf-btn--ghost ctf-btn--sm" href={f.url ?? '#'} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ExternalLink size={13} aria-hidden /> Open</a>
                    : <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => void downloadResource(f).then(({ error }) => { if (error) push(error.message, 'error') })}>Download</Button>}
                  <Button size="sm" variant="ghost" aria-label={`Remove ${f.title}`} icon={<Trash2 size={13} />} onClick={() => void remove(f)} />
                </li>
              )
            })}
          </ul>
        ))}
      {viewing && <ResourcePreview resource={viewing as unknown as Resource} onClose={() => setViewing(null)} />}
    </div>
  )
}
