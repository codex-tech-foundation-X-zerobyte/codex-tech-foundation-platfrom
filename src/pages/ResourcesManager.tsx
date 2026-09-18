import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ChevronRight, Clock, Download, File as FileIcon, FolderOpen, FolderPlus,
  History, Home, RotateCcw, Search, Trash2, Upload, X,
} from 'lucide-react'
import { Button, EmptyState, ErrorState, FieldWrap, Input, Modal, SkeletonRows, useToast } from '../components/ui'
import {
  createFolder, createResourceWithFile, downloadVersion, getFolderPath, getResourceDownloadUrl,
  getStorageUsage, listResources, listTrash, listVersions, moveToTrash, permanentlyDelete,
  restoreFromTrash, searchResources, uploadNewVersion,
} from '../lib/services'
import type { Resource, ResourceVersion } from '../lib/types'
import './ResourcesManager.css'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

export function ResourcesManager() {
  const [view, setView] = useState<'files' | 'trash'>('files')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<Resource[]>([])
  const [items, setItems] = useState<Resource[] | null>(null)
  const [trash, setTrash] = useState<Resource[] | null>(null)
  const [error, setError] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Resource[] | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [usage, setUsage] = useState<{ totalBytes: number; fileCount: number } | null>(null)
  const [versionsFor, setVersionsFor] = useState<Resource | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const versionInputRef = useRef<HTMLInputElement>(null)
  const versionTargetRef = useRef<Resource | null>(null)
  const { push } = useToast()

  const loadFiles = () => {
    setError(false)
    void listResources(folderId).then(({ data, error: err }) => (err ? setError(true) : setItems(data)))
    if (folderId) void getFolderPath(folderId).then(setBreadcrumb)
    else setBreadcrumb([])
  }
  const loadTrash = () => {
    setError(false)
    void listTrash().then(({ data, error: err }) => (err ? setError(true) : setTrash(data)))
  }
  const loadUsage = () => void getStorageUsage().then(({ totalBytes, fileCount }) => setUsage({ totalBytes, fileCount }))

  useEffect(() => { setItems(null); loadFiles() }, [folderId])
  useEffect(loadUsage, [])
  useEffect(() => { if (view === 'trash') { setTrash(null); loadTrash() } }, [view])

  useEffect(() => {
    if (!searchTerm.trim()) { setSearchResults(null); return }
    const handle = setTimeout(() => {
      void searchResources(searchTerm.trim()).then(({ data }) => setSearchResults(data))
    }, 300)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true)
    let failures = 0
    for (const file of Array.from(files)) {
      const { error: err } = await createResourceWithFile({ title: file.name, description: '', category: 'general' }, file, folderId)
      if (err) failures += 1
    }
    setUploading(false)
    if (failures) push(`${failures} file${failures > 1 ? 's' : ''} failed to upload.`, 'error')
    else push(files.length > 1 ? 'Files uploaded' : 'File uploaded')
    loadFiles()
    loadUsage()
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files)
  }

  const makeFolder = async () => {
    if (!newFolderName.trim()) return
    const { error: err } = await createFolder(newFolderName.trim(), folderId)
    if (err) { push('Could not create that folder.', 'error'); return }
    push('Folder created')
    setNewFolderOpen(false)
    setNewFolderName('')
    loadFiles()
  }

  const trashItem = async (resource: Resource) => {
    setItems((prev) => prev?.filter((r) => r.id !== resource.id) ?? prev)
    const { error: err } = await moveToTrash(resource)
    push(err ? 'Could not move that to trash.' : 'Moved to trash', err ? 'error' : 'success')
    if (err) loadFiles()
    loadUsage()
  }

  const restore = async (resource: Resource) => {
    setTrash((prev) => prev?.filter((r) => r.id !== resource.id) ?? prev)
    const { error: err } = await restoreFromTrash(resource)
    push(err ? 'Could not restore that file.' : 'Restored', err ? 'error' : 'success')
    if (err) loadTrash()
  }

  const purge = async (resource: Resource) => {
    if (!window.confirm(`Permanently delete "${resource.title}"? This cannot be undone.`)) return
    setTrash((prev) => prev?.filter((r) => r.id !== resource.id) ?? prev)
    const { error: err } = await permanentlyDelete(resource)
    push(err ? 'Could not delete that file.' : 'Permanently deleted', err ? 'error' : 'success')
    if (err) loadTrash()
    loadUsage()
  }

  const download = async (resource: Resource) => {
    const { url, error: err } = await getResourceDownloadUrl(resource)
    if (err || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
    loadFiles()
  }

  const openVersionUpload = (resource: Resource) => {
    versionTargetRef.current = resource
    versionInputRef.current?.click()
  }
  const handleVersionFile = async (file: File) => {
    const target = versionTargetRef.current
    if (!target) return
    const { error: err } = await uploadNewVersion(target, file)
    push(err ? 'Could not upload a new version.' : 'New version uploaded', err ? 'error' : 'success')
    loadFiles()
  }

  const displayedItems = searchResults ?? items

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="ctf-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'files'} className={`ctf-tabs__item ${view === 'files' ? 'is-active' : ''}`} onClick={() => setView('files')}>Files</button>
          <button role="tab" aria-selected={view === 'trash'} className={`ctf-tabs__item ${view === 'trash' ? 'is-active' : ''}`} onClick={() => setView('trash')}>Trash</button>
        </div>
        {view === 'files' && (
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search files…" style={{ paddingLeft: 30 }} />
          </div>
        )}
        {usage && <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 'auto' }}>{usage.fileCount} files · {formatBytes(usage.totalBytes)} used</span>}
      </div>

      {view === 'files' && !searchResults && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, fontSize: 13, flexWrap: 'wrap' }}>
          <button className="ctf-crumb" onClick={() => setFolderId(null)}><Home size={13} /></button>
          {breadcrumb.map((f) => (
            <span key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronRight size={12} style={{ opacity: 0.4 }} />
              <button className="ctf-crumb" onClick={() => setFolderId(f.id)}>{f.title}</button>
            </span>
          ))}
        </div>
      )}

      {view === 'files' && (
        <div
          className={`ctf-resource-uploader ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <label className="ctf-resource-drop" htmlFor="res-file">
            <Upload size={16} />
            {uploading ? 'Uploading…' : 'Drag files here, or click to browse — multiple files supported'}
          </label>
          <input ref={inputRef} id="res-file" type="file" multiple style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); if (inputRef.current) inputRef.current.value = '' }} />
          <Button variant="secondary" icon={<FolderPlus size={14} />} onClick={() => setNewFolderOpen(true)}>New folder</Button>
        </div>
      )}

      {/* Hidden input reused for "upload new version" on a specific file */}
      <input ref={versionInputRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleVersionFile(f); if (versionInputRef.current) versionInputRef.current.value = '' }} />

      {error && <ErrorState onRetry={view === 'files' ? loadFiles : loadTrash} />}

      {view === 'files' && !error && displayedItems === null && <SkeletonRows rows={4} />}
      {view === 'files' && !error && displayedItems !== null && displayedItems.length === 0 && (
        <EmptyState icon={FolderOpen} title={searchResults ? 'No matching files' : 'No files here yet'} description={searchResults ? 'Try a different search term.' : 'Upload a file or create a folder to get started.'} />
      )}
      {view === 'files' && displayedItems && displayedItems.length > 0 && (
        <div className="ctf-resource-list">
          {displayedItems.map((r) => (
            <div key={r.id} className="ctf-resource-row">
              <button
                className="ctf-resource-row__main"
                onClick={() => { if (r.is_folder) setFolderId(r.id) }}
                style={{ cursor: r.is_folder ? 'pointer' : 'default', textAlign: 'left', background: 'none', border: 'none' }}
              >
                {r.is_folder ? <FolderOpen size={16} /> : <FileIcon size={16} />}
                <div>
                  <strong>{r.title}</strong>
                  <span>
                    {r.is_folder ? 'Folder' : `v${r.current_version} · ${formatBytes(r.size_bytes)}`} · {formatDate(r.created_at)}
                    {!r.is_folder && r.download_count > 0 ? ` · ${r.download_count} download${r.download_count === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
              </button>
              {!r.is_folder && (
                <div className="ctf-resource-row__actions">
                  <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void download(r)}>Download</Button>
                  <Button variant="ghost" size="sm" icon={<History size={14} />} onClick={() => setVersionsFor(r)}>Versions</Button>
                  <Button variant="ghost" size="sm" icon={<Upload size={14} />} onClick={() => openVersionUpload(r)}>New version</Button>
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void trashItem(r)}>Delete</Button>
                </div>
              )}
              {r.is_folder && (
                <div className="ctf-resource-row__actions">
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void trashItem(r)}>Delete</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'trash' && !error && trash === null && <SkeletonRows rows={4} />}
      {view === 'trash' && !error && trash !== null && trash.length === 0 && (
        <EmptyState icon={Trash2} title="Trash is empty" description="Deleted files appear here and can be restored until permanently removed." />
      )}
      {view === 'trash' && trash && trash.length > 0 && (
        <div className="ctf-resource-list">
          {trash.map((r) => (
            <div key={r.id} className="ctf-resource-row">
              <div className="ctf-resource-row__main">
                {r.is_folder ? <FolderOpen size={16} /> : <FileIcon size={16} />}
                <div>
                  <strong>{r.title}</strong>
                  <span><Clock size={11} style={{ verticalAlign: -1 }} /> deleted {formatDate(r.deleted_at!)}</span>
                </div>
              </div>
              <div className="ctf-resource-row__actions">
                <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => void restore(r)}>Restore</Button>
                <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => void purge(r)}>Delete forever</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title="New folder" footer={
        <>
          <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void makeFolder()} disabled={!newFolderName.trim()}>Create</Button>
        </>
      }>
        <FieldWrap label="Folder name" htmlFor="new-folder-name">
          <Input id="new-folder-name" autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void makeFolder() }} />
        </FieldWrap>
      </Modal>

      <VersionsModal resource={versionsFor} onClose={() => setVersionsFor(null)} />
    </div>
  )
}

function VersionsModal({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const [versions, setVersions] = useState<ResourceVersion[] | null>(null)
  const { push } = useToast()

  useEffect(() => {
    if (!resource) { setVersions(null); return }
    void listVersions(resource.id).then(({ data }) => setVersions(data))
  }, [resource])

  const download = async (version: ResourceVersion) => {
    const { url, error } = await downloadVersion(version)
    if (error || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <Modal open={resource !== null} onClose={onClose} title={resource ? `Version history — ${resource.title}` : 'Version history'}>
      {versions === null && <SkeletonRows rows={2} />}
      {versions && versions.length === 0 && <p>No version history yet.</p>}
      {versions && versions.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {versions.map((v) => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-default, #2a2a2a)' }}>
              <div>
                <strong>v{v.version}</strong>{resource?.current_version === v.version ? ' (current)' : ''}
                <div style={{ fontSize: 12, opacity: 0.65 }}>{formatDate(v.created_at)} · {formatBytes(v.size_bytes)}</div>
              </div>
              <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void download(v)}>Download</Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
