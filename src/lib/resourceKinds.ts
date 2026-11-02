/** What kind of thing a resource is (file type or link), how big it is, and what to call it. Pure, unit-tested. */

export type ResourceKind = 'link' | 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'file'

const EXT_KIND: Record<string, ResourceKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', bmp: 'image',
  pdf: 'pdf',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', aac: 'audio',
  txt: 'text', md: 'text', json: 'text', csv: 'text', log: 'text', xml: 'text', yml: 'text', yaml: 'text', html: 'text', css: 'text',
  js: 'text', ts: 'text', tsx: 'text', jsx: 'text', py: 'text', sql: 'text', sh: 'text',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
}

export const KIND_LABEL: Record<ResourceKind, string> = {
  link: 'Link', image: 'Image', pdf: 'PDF', video: 'Video', audio: 'Audio', text: 'Text', document: 'Document', spreadsheet: 'Spreadsheet', presentation: 'Presentation', archive: 'Archive', file: 'File',
}

export const extOf = (name: string | null | undefined) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec((name ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}

interface KindInput { url?: string | null; storage_path?: string | null; mime_type?: string | null; title?: string | null }

export function resourceKind(r: KindInput): ResourceKind {
  if (!r.storage_path && r.url) return 'link'
  const mime = (r.mime_type ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  // Browsers report octet-stream (or nothing) for plenty of real files — the extension is the better witness.
  return EXT_KIND[extOf(r.storage_path) || extOf(r.title)] ?? 'file'
}

/** Kinds the viewer can show on the page itself. Everything else offers Download. */
export const isPreviewable = (kind: ResourceKind) => kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio' || kind === 'text'

/** The content type to give a downloaded blob so the browser renders it properly (servers sometimes say octet-stream). */
export function contentTypeFor(r: KindInput, served?: string | null): string {
  const s = (served ?? '').toLowerCase()
  if (s && s !== 'application/octet-stream') return s
  return r.mime_type || EXT_MIME[extOf(r.storage_path) || extOf(r.title)] || 'application/octet-stream'
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** "Q3_report-final.pdf" → "Q3 report final": a readable title for a dropped file. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_]+/g, ' ').replace(/-{2,}/g, ' ').replace(/\s+/g, ' ').trim()
  return (base || name).slice(0, 160)
}

/** The filename a download should get: the title, plus the original extension if the title lost it. */
export function downloadName(r: { title: string; storage_path?: string | null }): string {
  const ext = extOf(r.storage_path)
  // Drop control characters, then the characters operating systems refuse in file names.
  const printable = [...r.title].filter((c) => c.charCodeAt(0) >= 32).join('')
  const safe = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'download'
  return ext && extOf(safe) !== ext ? `${safe}.${ext}` : safe
}
