import { supabase } from '../supabase'

export type Result<T> = { data: T; error: Error | null }

/**
 * Accepts anything with a `message` string — both PostgrestError (database
 * errors) and StorageError (storage errors) have this shape but are
 * otherwise structurally different types, so a single narrow PostgrestError
 * parameter type doesn't fit calls from storage operations. Kept as one
 * shared normalizer rather than a parallel toStorageError() — same
 * function, wider input type, per ARCHITECTURE.md's "one implementation per
 * concept" rule.
 */
export function toError(error: { message: string } | null): Error | null {
  return error ? new Error(error.message) : null
}

/**
 * Storage helper. Public assets use getPublicUrl; anything in a private bucket
 * (client files, resumes, worker resources) must use a signed URL — never a public one.
 */
export const storage = {
  upload: (bucket: string, path: string, file: File) =>
    supabase.storage.from(bucket).upload(path, file, { upsert: false }),
  getPublicUrl: (bucket: string, path: string) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
  getSignedUrl: async (bucket: string, path: string, expiresInSeconds = 300) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    return { url: data?.signedUrl ?? null, error: toError(error) }
  },
  remove: (bucket: string, paths: string[]) => supabase.storage.from(bucket).remove(paths),
}
