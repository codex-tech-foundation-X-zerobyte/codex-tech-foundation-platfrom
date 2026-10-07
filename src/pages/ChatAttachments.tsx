import { useEffect, useState } from 'react'
import { FileText, Film, Image as ImageIcon, Music, Paperclip } from 'lucide-react'
import { getChatMediaUrl, type ChatAttachment } from '../lib/services'
import { formatBytes } from '../lib/storagePath'

/** Resolves a short-lived signed URL for a private attachment. */
function useMediaUrl(path: string) {
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void getChatMediaUrl(path).then((url) => { if (!cancelled) setState({ path, url, failed: !url }) }).catch(() => { if (!cancelled) setState({ path, url: null, failed: true }) })
    return () => { cancelled = true }
  }, [path])
  const current = state?.path === path ? state : null
  return { url: current?.url ?? null, failed: current?.failed ?? false }
}

/** The icon for a file type. A component (not a function returning one) so React sees a stable element type. */
export function FileIcon({ mime, size = 16 }: { mime: string; size?: number }) {
  if (mime.startsWith('image/')) return <ImageIcon size={size} />
  if (mime.startsWith('video/')) return <Film size={size} />
  if (mime.startsWith('audio/')) return <Music size={size} />
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText size={size} />
  return <Paperclip size={size} />
}

function Attachment({ item }: { item: ChatAttachment }) {
  const { url, failed } = useMediaUrl(item.path)
  if (failed) return <div className="ctf-att ctf-att--file"><FileIcon mime={item.mime} /><span>{item.name}</span><em>Couldn't load</em></div>
  if (item.mime.startsWith('image/')) {
    return url ? (
      <a className="ctf-att ctf-att--image" href={url} target="_blank" rel="noopener noreferrer" title={`${item.name} · ${formatBytes(item.size)}`}>
        <img src={url} alt={item.name} loading="lazy" />
      </a>
    ) : <div className="ctf-att ctf-att--image ctf-att--loading" aria-label={`Loading ${item.name}`} />
  }
  if (item.mime.startsWith('video/')) return url ? <video className="ctf-att ctf-att--video" src={url} controls preload="metadata" playsInline /> : <div className="ctf-att ctf-att--video ctf-att--loading" aria-label={`Loading ${item.name}`} />
  if (item.mime.startsWith('audio/')) return <div className="ctf-att ctf-att--audio"><span>{item.name}</span>{url ? <audio src={url} controls preload="metadata" /> : <em>Loading…</em>}</div>
  return (
    <a className="ctf-att ctf-att--file" href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url} download={item.name}>
      <FileIcon mime={item.mime} />
      <span>{item.name}</span>
      <em>{formatBytes(item.size)}</em>
    </a>
  )
}

export function MessageAttachments({ items }: { items: ChatAttachment[] }) {
  if (!items?.length) return null
  return <div className="ctf-atts">{items.map((a) => <Attachment key={a.path} item={a} />)}</div>
}
