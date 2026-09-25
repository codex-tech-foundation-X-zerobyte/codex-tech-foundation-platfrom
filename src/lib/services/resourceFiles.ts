import { supabase } from '../supabase'
import type { Resource, ResourceVersion } from '../types'
import { storage, toError } from './shared'

// One place files are listed from — folders and files are both `resources`
// rows (is_folder distinguishes them), scoped by parent_id. Trashed rows
// (deleted_at set) are excluded here; see listTrash() below.
export async function listResources(parentId: string | null = null) {
  let query = supabase.from('resources').select('*').is('deleted_at', null).order('is_folder', { ascending: false }).order('title', { ascending: true })
  query = parentId === null ? query.is('parent_id', null) : query.eq('parent_id', parentId)
  const { data, error } = await query
  return { data: (data ?? []) as Resource[], error: toError(error) }
}

export async function searchResources(term: string) {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .is('deleted_at', null)
    .eq('is_folder', false)
    .ilike('title', `%${term}%`)
    .order('created_at', { ascending: false })
    .limit(50)
  return { data: (data ?? []) as Resource[], error: toError(error) }
}

export async function listTrash() {
  const { data, error } = await supabase.from('resources').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  return { data: (data ?? []) as Resource[], error: toError(error) }
}

export async function getFolderPath(folderId: string): Promise<Resource[]> {
  // Walks parent_id up to the root. Small team-library scale (see
  // docs/REALTIME.md's "~8-10 internal users" context) — a handful of
  // sequential lookups is fine; this isn't a deeply nested filesystem.
  const path: Resource[] = []
  let currentId: string | null = folderId
  let guard = 0
  while (currentId && guard < 25) {
    const { data }: { data: Resource | null } = await supabase.from('resources').select('*').eq('id', currentId).maybeSingle()
    if (!data) break
    path.unshift(data)
    currentId = data.parent_id
    guard += 1
  }
  return path
}

export async function createFolder(title: string, parentId: string | null) {
  const { error } = await supabase.from('resources').insert({ title, description: '', category: 'folder', is_folder: true, parent_id: parentId })
  return { error: toError(error) }
}

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100MB — matches the resources bucket; adjust in one place if that changes

export async function createResourceWithFile(
  input: { title: string; description: string; category: string },
  file: File,
  parentId: string | null,
) {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: new Error(`File is too large (max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB).`) }
  }
  const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await storage.upload('resources', path, file)
  if (uploadError) return { error: new Error('Unable to upload that file.') }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: resource, error } = await supabase
    .from('resources')
    .insert({ ...input, storage_path: path, parent_id: parentId, size_bytes: file.size, mime_type: file.type || null, current_version: 1 })
    .select('id')
    .single()
  if (error || !resource) {
    await storage.remove('resources', [path])
    return { error: toError(error) ?? new Error('Could not save this file.') }
  }

  await supabase.from('resource_versions').insert({ resource_id: resource.id, version: 1, storage_path: path, size_bytes: file.size, uploaded_by: user?.id ?? null })
  await logFileActivity('file.uploaded', resource.id, { title: input.title, size_bytes: file.size })

  return { error: null }
}

// Uploads a new version onto an EXISTING resource — the old versions stay
// in resource_versions/storage (never overwritten), only current_version
// and the row's storage_path move forward. This is real versioning, not a
// single mutable file pretending to have history.
export async function uploadNewVersion(resource: Resource, file: File) {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: new Error(`File is too large (max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB).`) }
  }
  const nextVersion = resource.current_version + 1
  const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await storage.upload('resources', path, file)
  if (uploadError) return { error: new Error('Unable to upload that file.') }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error: versionError } = await supabase
    .from('resource_versions')
    .insert({ resource_id: resource.id, version: nextVersion, storage_path: path, size_bytes: file.size, uploaded_by: user?.id ?? null })
  if (versionError) {
    await storage.remove('resources', [path])
    return { error: toError(versionError) }
  }

  const { error } = await supabase
    .from('resources')
    .update({ storage_path: path, size_bytes: file.size, mime_type: file.type || null, current_version: nextVersion })
    .eq('id', resource.id)
  if (error) return { error: toError(error) }

  await logFileActivity('file.version_uploaded', resource.id, { version: nextVersion })
  return { error: null }
}

export async function listVersions(resourceId: string) {
  const { data, error } = await supabase.from('resource_versions').select('*').eq('resource_id', resourceId).order('version', { ascending: false })
  return { data: (data ?? []) as ResourceVersion[], error: toError(error) }
}

export async function downloadVersion(version: ResourceVersion) {
  return storage.getSignedUrl('resources', version.storage_path, 300)
}

// Soft delete — moves to trash, storage object is NOT touched, fully
// restorable. See the migration comment for why this replaced the old
// behavior (deleteResource() used to remove the storage object immediately,
// making "archived" files unrecoverable despite looking like a trash).
export async function moveToTrash(resource: Resource) {
  const { error } = await supabase.from('resources').update({ deleted_at: new Date().toISOString() }).eq('id', resource.id)
  if (error) return { error: toError(error) }
  await logFileActivity('file.trashed', resource.id, { title: resource.title })
  return { error: null }
}

export async function restoreFromTrash(resource: Resource) {
  const { error } = await supabase.from('resources').update({ deleted_at: null }).eq('id', resource.id)
  if (error) return { error: toError(error) }
  await logFileActivity('file.restored', resource.id, { title: resource.title })
  return { error: null }
}

// The only path that actually removes bytes from storage. Removes every
// version's object, not just the current one.
export async function permanentlyDelete(resource: Resource) {
  const { data: versions } = await supabase.from('resource_versions').select('storage_path').eq('resource_id', resource.id)
  const paths = (versions ?? []).map((v) => v.storage_path).filter(Boolean)
  if (resource.storage_path && !paths.includes(resource.storage_path)) paths.push(resource.storage_path)
  if (paths.length) await storage.remove('resources', paths)

  const { error } = await supabase.from('resources').delete().eq('id', resource.id)
  if (error) return { error: toError(error) }
  await logFileActivity('file.permanently_deleted', resource.id, { title: resource.title })
  return { error: null }
}

export async function getResourceDownloadUrl(resource: Resource) {
  if (!resource.storage_path) return { url: resource.url, error: null }
  const result = await storage.getSignedUrl('resources', resource.storage_path, 300)
  if (result.url) {
    await supabase.from('resources').update({ download_count: resource.download_count + 1 }).eq('id', resource.id)
    await logFileActivity('file.downloaded', resource.id, { title: resource.title })
  }
  return result
}

// Aggregate storage usage — a real query against size_bytes, not a
// fabricated dashboard number.
export async function getStorageUsage() {
  const { data, error } = await supabase.from('resources').select('size_bytes').is('deleted_at', null).eq('is_folder', false)
  if (error) return { totalBytes: 0, fileCount: 0, error: toError(error) }
  const totalBytes = (data ?? []).reduce((sum, r) => sum + (r.size_bytes ?? 0), 0)
  return { totalBytes, fileCount: data?.length ?? 0, error: null }
}

async function logFileActivity(action: string, resourceId: string, metadata: Record<string, unknown>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Best-effort — a failed activity log should never block the file
  // operation it's describing. The narrow "team logs their own file
  // activity" audit_logs insert policy (see the Pass 4 migration) covers
  // exactly the five actions this function is called with.
  await supabase.from('audit_logs').insert({ actor_user_id: user?.id ?? null, action, resource_type: 'resources', resource_id: resourceId, severity: 'info', success: true, metadata })
}
