import { useRef, useState } from 'react'
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react'
import { Button, EmptyState, ErrorState, FieldWrap, Input, SkeletonRows, useToast } from '../components/ui'
import { createResourceWithFile, deleteResource, getResourceDownloadUrl, listResources } from '../lib/services'
import type { Resource } from '../lib/types'
import { useAsyncData } from '../hooks/useAsyncData'
import './ResourcesManager.css'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

export function ResourcesManager() {
  const { data: resources, error, loading, reload } = useAsyncData('once', listResources)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { push } = useToast()

  const upload = async () => {
    if (!file || !title.trim()) return
    setUploading(true)
    const { error: err } = await createResourceWithFile({ title: title.trim(), description: '', category: 'general' }, file)
    setUploading(false)
    if (err) {
      push('Upload failed. Please try again.', 'error')
      return
    }
    push('File uploaded')
    setTitle('')
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    reload()
  }

  const remove = async (resource: Resource) => {
    const { error: err } = await deleteResource(resource)
    push(err ? 'Could not delete that file.' : 'File deleted', err ? 'error' : 'success')
    reload()
  }

  const download = async (resource: Resource) => {
    const { url, error: err } = await getResourceDownloadUrl(resource)
    if (err || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div>
      <div className="ctf-resource-uploader">
        <FieldWrap label="File title" htmlFor="res-title">
          <Input id="res-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client onboarding checklist" />
        </FieldWrap>
        <label className="ctf-resource-drop" htmlFor="res-file">
          <Upload size={16} />
          {file ? file.name : 'Drop a file here, or browse'}
        </label>
        <input ref={inputRef} id="res-file" type="file" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="primary" onClick={upload} loading={uploading} disabled={!file || !title.trim()}>Upload</Button>
      </div>

      {error && <ErrorState onRetry={reload} />}
      {!error && loading && <SkeletonRows rows={4} />}
      {!error && !loading && resources !== null && resources.length === 0 && (
        <EmptyState icon={FolderOpen} title="No resources yet" description="Files uploaded by the team will appear here." />
      )}
      {resources && resources.length > 0 && (
        <div className="ctf-resource-list">
          {resources.map((r) => (
            <div key={r.id} className="ctf-resource-row">
              <div>
                <strong>{r.title}</strong>
                <span>{r.category} · {formatDate(r.created_at)}</span>
              </div>
              <div className="ctf-resource-row__actions">
                <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void download(r)}>Download</Button>
                <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void remove(r)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
