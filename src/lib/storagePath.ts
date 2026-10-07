import { AppError } from './appError.ts'

/**
 * Supabase Storage rejects object keys containing characters outside a safe set (InvalidKey -> HTTP 400). Real-world file
 * names routinely contain them: macOS screenshots have an invisible U+202F before "AM/PM", phones produce "IMG 0001 (1).JPG",
 * people use emoji, accents, '#', '[', ']'. The user's original name is kept for display (stored in the database row); only
 * the storage KEY is made safe.
 */
export function safeFileName(original: string): string {
  const raw = (original.split(/[\\/]/).pop() ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // drop accents
  const dot = raw.lastIndexOf('.')
  const hasExt = dot > 0 && dot < raw.length - 1
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  const base = clean(hasExt ? raw.slice(0, dot) : raw).slice(0, 80) || 'file'
  const ext = hasExt ? clean(raw.slice(dot + 1)).toLowerCase().slice(0, 10) : ''
  return ext ? `${base}.${ext}` : base
}

/** `<segments>/<timestamp>-<safe name>` — the timestamp keeps keys unique so uploads never need `upsert`. */
export function storageKey(segments: string[], originalName: string, now = Date.now()): string {
  return [...segments, `${now}-${safeFileName(originalName)}`].join('/')
}

/** Mirrors the chat-media bucket's allowed_mime_types and size limit so people get a clear message BEFORE uploading. */
export const CHAT_MAX_BYTES = 50 * 1024 * 1024
export const CHAT_MAX_FILES = 6
const CHAT_MIME = [/^image\//, /^video\//, /^audio\//, /^application\/pdf$/, /^text\/(plain|csv)$/, /^application\/(zip|json|msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/, /^application\/vnd\.openxmlformats-officedocument\./]

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function validateChatFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`
  if (file.size > CHAT_MAX_BYTES) return `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(CHAT_MAX_BYTES)}.`
  if (!CHAT_MIME.some((re) => re.test(file.type))) return `"${file.name}" is a type that can't be sent here (${file.type || 'unknown type'}). Images, video, audio, PDFs, text, Office files and zips are supported.`
  return null
}

interface StorageErrorLike { message: string; statusCode?: string | number; status?: number; error?: string }

/** Storage errors say what went wrong in `message`; this turns the common ones into something a person can act on. */
export function storageError(error: StorageErrorLike): AppError {
  const status = Number(error.statusCode ?? error.status) || undefined
  const msg = error.message ?? ''
  let friendly: string | null = null
  if (status === 413 || /exceeded the maximum allowed size|payload too large/i.test(msg)) friendly = 'That file is larger than the upload limit.'
  else if (/mime type .* is not supported|not supported/i.test(msg)) friendly = "That file type isn't allowed."
  else if (/invalid key|invalidkey/i.test(msg)) friendly = "That file's name has characters the storage service can't accept."
  else if (status === 403 || /row-level security|unauthorized|not authorized/i.test(msg)) friendly = "You don't have permission to upload here."
  else if (status === 401 || /jwt/i.test(msg)) friendly = 'Your session has expired. Please sign in again.'
  else if (status === 409 || /already exists|duplicate/i.test(msg)) friendly = 'A file with that name already exists.'
  else if (status === 404 || /bucket not found/i.test(msg)) friendly = 'The storage location for this upload is missing. Please report this to an administrator.'
  const err = new AppError({ message: msg, code: status ? String(status) : undefined }, status)
  if (friendly) err.message = friendly
  return err
}
