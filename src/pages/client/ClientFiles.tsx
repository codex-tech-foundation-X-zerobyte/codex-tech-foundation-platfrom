import { Download, FolderOpen } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, useToast } from '../../components/ui'
import { getProjectFileUrl, listMyProjects, listProjectFiles } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

async function fetchAllFiles() {
  const { data: projects, error } = await listMyProjects()
  if (error) return { data: [], error }
  const results = await Promise.all(projects.map(async (p) => {
    const { data } = await listProjectFiles(p.id)
    return data.map((f) => ({ ...f, projectName: p.name }))
  }))
  const all = results.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return { data: all, error: null }
}

export function ClientFiles() {
  const { data: files, error, loading, reload } = useAsyncData('once', fetchAllFiles)
  const { push } = useToast()

  const download = async (path: string) => {
    const { url, error: err } = await getProjectFileUrl(path)
    if (err || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="Project" title="Files" />
      {loading && <SkeletonRows rows={3} />}
      {!loading && files?.length === 0 && (
        <EmptyState icon={FolderOpen} title="No files yet" description="Files shared with you will appear here." />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {files?.map((f) => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-1)' }}>
            <div>
              <strong>{f.name}</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{f.projectName} · {new Date(f.created_at).toLocaleDateString()}</span>
            </div>
            <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void download(f.storage_path)}>Download</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
