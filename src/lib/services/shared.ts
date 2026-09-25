import { supabase } from '../supabase'

export type Result<T> = { data: T; error: Error | null }

// Accepts PostgrestError, StorageError, AuthError, or any Supabase client
// error — they all carry a `.message` string, which is everything this
// function actually uses. A structural type here (rather than importing
// and unioning every concrete error class) means storage.remove()/
// storage.upload() errors and database errors can both flow through the
// same toError() call without a type mismatch, which is the real shape of
// how errors get passed around this codebase (see teamAdmin.ts's
// uploadTeamPhoto, resourceFiles.ts, chat.ts's attachment handling).
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
