import { supabase } from '../supabase'
import type { Resource } from '../types'
import { getCurrentUserId, storage, toError } from './shared'
import { deleteResourceRow } from './removal'
import { safeFileName } from '../storagePath'
import { normalizeUrl } from '../links'
import { contentTypeFor, downloadName } from '../resourceKinds'

export const RESOURCE_MAX_MB = 25
const BUCKET = 'resources'

interface NewResource { title: string; description: string; category: string; department_id?: string | null }

export async function createResourceWithFile(input: NewResource, file: File) {
  if (file.size > RESOURCE_MAX_MB * 1024 * 1024) return { error: new Error(`${file.name} is over ${RESOURCE_MAX_MB} MB.`) }
  const path = `${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await storage.upload(BUCKET, path, file)
  if (uploadError) return { error: uploadError }

  const ownerId = await getCurrentUserId()
  const { error } = await supabase.from('resources').insert({ ...input, storage_path: path, owner_id: ownerId, mime_type: file.type || null, size_bytes: file.size })
  if (error) {
    await storage.remove(BUCKET, [path])
    return { error: toError(error) }
  }
  return { error: null }
}

/** A link dropped or pasted in: stored as a resource with a URL and no file. Only http(s) addresses are accepted. */
export async function createLinkResource(input: NewResource & { url: string }) {
  const href = normalizeUrl(input.url)
  if (!href || href.startsWith('mailto:')) return { error: new Error("That doesn't look like a web link.") }
  const ownerId = await getCurrentUserId()
  const { error } = await supabase.from('resources').insert({
    title: input.title.trim().slice(0, 160) || href, description: input.description, category: input.category, department_id: input.department_id ?? null, url: href, owner_id: ownerId,
  })
  return { error: toError(error) }
}

export async function renameResource(id: string, title: string) {
  const clean = title.trim().slice(0, 160)
  if (!clean) return { error: new Error('A title is needed.') }
  const { data, error } = await supabase.from('resources').update({ title: clean }).eq('id', id).select('id')
  if (error) return { error: toError(error) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to rename this.") }
  return { error: null }
}

/** Goes to the trash (restorable for 30 days). The file itself stays in storage until the trash is purged. */
export const deleteResource = (resource: Pick<Resource, 'id'>) => deleteResourceRow(resource.id)

/** A link to open or save the resource. For a link-type resource, the stored address — re-validated, never trusted blindly. */
export async function getResourceDownloadUrl(resource: Pick<Resource, 'url' | 'storage_path' | 'title'>) {
  if (!resource.storage_path) {
    const href = resource.url ? normalizeUrl(resource.url) : null
    return href ? { url: href, error: null } : { url: null, error: new Error('This link is not a valid web address.') }
  }
  return storage.getSignedUrl(BUCKET, resource.storage_path, 300)
}

function saveFromUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Saves a file to the person's device. This used to open the signed link with window.open() AFTER awaiting the network —
 * browsers (Safari and mobile above all) treat that as a pop-up and block it, so "Download" silently did nothing. A signed
 * link that carries Content-Disposition: attachment, clicked through an anchor, is not a pop-up and always saves.
 */
export async function downloadResource(resource: Pick<Resource, 'url' | 'storage_path' | 'title'>) {
  if (!resource.storage_path) {
    const { url, error } = await getResourceDownloadUrl(resource)
    if (error || !url) return { error: error ?? new Error('No link.') }
    window.open(url, '_blank', 'noopener,noreferrer') // a link, not a file: opening it IS the action, and this is a direct click
    return { error: null }
  }
  const name = downloadName(resource)
  const { url, error } = await storage.getSignedUrl(BUCKET, resource.storage_path, 60, name)
  if (error || !url) return { error: error ?? new Error('Could not create a download link.') }
  saveFromUrl(url, name)
  return { error: null }
}

/** The file's bytes, typed so the browser renders them, for the in-page viewer. Uses the signed-in session, not a public link. */
export async function fetchResourceBlob(resource: Pick<Resource, 'storage_path' | 'mime_type' | 'title'>, maxBytes = RESOURCE_MAX_MB * 1024 * 1024) {
  if (!resource.storage_path) return { blob: null, error: new Error('No file.'), tooLarge: false }
  const { data, error } = await supabase.storage.from(BUCKET).download(resource.storage_path)
  if (error || !data) return { blob: null, error: new Error("This file couldn't be opened. It may have been removed, or you may not have access to it."), tooLarge: false }
  if (data.size > maxBytes) return { blob: null, error: null, tooLarge: true }
  return { blob: new Blob([data], { type: contentTypeFor(resource, data.type) }), error: null, tooLarge: false }
}

/** Files and links, newest first, each with the uploader's name when it can be resolved. */
export async function listResources() {
  const { data, error } = await supabase.from('resources').select('*').is('archived_at', null).order('created_at', { ascending: false })
  if (error) return { data: [] as Resource[], error: toError(error) }
  const rows = (data ?? []) as Resource[]
  const ids = [...new Set(rows.map((r) => r.owner_id).filter((v): v is string => Boolean(v)))]
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]))
  return { data: rows.map((r) => ({ ...r, owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null })), error: null }
}
