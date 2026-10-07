import { supabase } from '../supabase'
import type { Resource } from '../types'
import { storage, toError } from './shared'
import { safeFileName } from '../storagePath'

export async function createResourceWithFile(input: { title: string; description: string; category: string }, file: File) {
  const path = `${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await storage.upload('resources', path, file)
  if (uploadError) return { error: uploadError }

  const { error } = await supabase.from('resources').insert({ ...input, storage_path: path })
  if (error) {
    await storage.remove('resources', [path])
    return { error: toError(error) }
  }
  return { error: null }
}

export async function deleteResource(resource: Resource) {
  const { error } = await supabase.from('resources').update({ archived_at: new Date().toISOString() }).eq('id', resource.id)
  if (error) return { error: toError(error) }
  if (resource.storage_path) await storage.remove('resources', [resource.storage_path])
  return { error: null }
}

export async function getResourceDownloadUrl(resource: Resource) {
  if (!resource.storage_path) return { url: resource.url, error: null }
  return storage.getSignedUrl('resources', resource.storage_path, 300)
}
