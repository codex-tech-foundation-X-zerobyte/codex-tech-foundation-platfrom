import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileQuestion } from 'lucide-react'
import { Button, Modal, SkeletonRows } from './ui'
import { downloadResource, fetchResourceBlob } from '../lib/services'
import { KIND_LABEL, formatBytes, isPreviewable, resourceKind } from '../lib/resourceKinds'
import { hostOf } from '../lib/links'
import type { Resource } from '../lib/types'
import './ResourcePreview.css'

type Loaded =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'toolarge' }
  | { status: 'ready'; url: string; text?: string; truncated?: boolean }

const TEXT_LIMIT = 200_000

/** Opens a resource right on the page: images, PDFs, video, audio and text show inline; anything else offers Download. */
export function ResourcePreview({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const kind = resourceKind(resource)
  const previewable = isPreviewable(kind)
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!previewable) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      const { blob, error, tooLarge } = await fetchResourceBlob(resource)
      if (cancelled) return
      if (tooLarge) { setState({ status: 'toolarge' }); return }
      if (error || !blob) { setState({ status: 'error', message: error?.message ?? 'This file could not be opened.' }); return }
      objectUrl = URL.createObjectURL(blob)
      if (kind === 'text') {
        const text = await blob.slice(0, TEXT_LIMIT).text()
        if (cancelled) { URL.revokeObjectURL(objectUrl); return }
        setState({ status: 'ready', url: objectUrl, text, truncated: blob.size > TEXT_LIMIT })
      } else {
        setState({ status: 'ready', url: objectUrl })
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [resource, kind, previewable])

  const save = async () => {
    setDownloading(true)
    await downloadResource(resource)
    setDownloading(false)
  }

  const meta = [KIND_LABEL[kind], formatBytes(resource.size_bytes)].filter(Boolean).join(' · ')
  const href = resource.url ?? ''

  return (
    <Modal
      open
      onClose={onClose}
      title={resource.title}
      description={meta}
      size="lg"
      footer={(
        <>
          {kind === 'link'
            ? <a className="ctf-btn ctf-btn--primary ctf-btn--md ctf-preview__open" href={href} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink size={14} aria-hidden /> Open link</a>
            : <Button variant="secondary" icon={<Download size={14} />} loading={downloading} onClick={() => void save()}>Download</Button>}
          {state.status === 'ready' && kind !== 'text' && (
            <a className="ctf-btn ctf-btn--secondary ctf-btn--md ctf-preview__open" href={state.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> Open in new tab</a>
          )}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      )}
    >
      <div className="ctf-preview">
        {kind === 'link' && (
          <div className="ctf-preview__note">
            <strong>{hostOf(href)}</strong>
            <span className="ctf-preview__url">{href}</span>
            <small>Links open in a new tab — most sites can&apos;t be shown inside another page.</small>
          </div>
        )}
        {kind !== 'link' && !previewable && (
          <div className="ctf-preview__note">
            <FileQuestion size={28} aria-hidden />
            <strong>This type of file can&apos;t be shown here.</strong>
            <small>Download it to open it on your device.</small>
          </div>
        )}
        {previewable && state.status === 'loading' && <SkeletonRows rows={3} height="60px" />}
        {previewable && state.status === 'error' && <div className="ctf-preview__note" role="alert"><strong>{state.message}</strong></div>}
        {previewable && state.status === 'toolarge' && <div className="ctf-preview__note"><strong>This file is too large to preview.</strong><small>Download it instead.</small></div>}
        {previewable && state.status === 'ready' && (
          <>
            {kind === 'image' && <img className="ctf-preview__image" src={state.url} alt={resource.title} />}
            {kind === 'pdf' && <iframe className="ctf-preview__pdf" src={state.url} title={resource.title} />}
            {kind === 'video' && <video className="ctf-preview__media" src={state.url} controls playsInline />}
            {kind === 'audio' && <audio className="ctf-preview__audio" src={state.url} controls />}
            {kind === 'text' && <pre className="ctf-preview__text">{state.text}{state.truncated ? '\n\n… (preview shows the first part — download for the rest)' : ''}</pre>}
            {kind === 'pdf' && <p className="ctf-preview__hint">If the PDF doesn&apos;t appear (some phones can&apos;t show it here), use <em>Open in new tab</em> or <em>Download</em>.</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
