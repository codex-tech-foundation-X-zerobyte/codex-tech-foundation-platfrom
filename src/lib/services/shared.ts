import { supabase } from '../supabase'

export type Result<T> = { data: T; error: Error | null }

import { AppError, toError, type ErrorLike } from '../appError'
import { storageError } from '../storagePath'
export { AppError, toError, type ErrorLike }

/** The signed-in user's id, from the locally held session (refreshing if it has expired). `null` means "not signed in". */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * Storage helper. Public assets use getPublicUrl; anything in a private bucket
 * (client files, resumes, worker resources) must use a signed URL — never a public one.
 */
export const storage = {
  /** Uploads one file. `error` is already translated into something a person can act on (see storageError). */
  upload: async (bucket: string, path: string, file: File | Blob) => {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    })
    return { error: error ? storageError(error as unknown as Parameters<typeof storageError>[0]) : null }
  },
  getPublicUrl: (bucket: string, path: string) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
  getSignedUrl: async (bucket: string, path: string, expiresInSeconds = 300) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    return { url: data?.signedUrl ?? null, error: toError(error) }
  },
  remove: (bucket: string, paths: string[]) => supabase.storage.from(bucket).remove(paths),
}
