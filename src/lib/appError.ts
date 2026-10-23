// Dependency-free so it can be unit-tested without a Supabase client or environment variables.
export interface ErrorLike {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
  status?: number
  name?: string
}

/**
 * An error that keeps what PostgREST / Supabase actually said. Previously every failure was flattened to
 * `new Error(message)`, so the UI could only ever show a generic "could not do X" and a developer had nothing to go on.
 *
 * `message` is written for people. `technical`, `code`, `details` and `hint` are for diagnostics (see logSupabaseError).
 */
export class AppError extends Error {
  code?: string
  status?: number
  details?: string | null
  hint?: string | null
  technical: string

  constructor(source: ErrorLike, status?: number) {
    super(friendlyMessage(source, status))
    this.name = 'AppError'
    this.code = source.code
    this.status = status ?? source.status
    this.details = source.details
    this.hint = source.hint
    this.technical = source.message
  }

  /** True when the database refused the action on permission grounds (RLS / missing privilege / 401 / 403). */
  get isPermissionDenied() {
    return this.code === '42501' || this.status === 401 || this.status === 403
  }
}

/** Plain-language text for the codes people actually meet. Anything unrecognised keeps the server's own message. */
function friendlyMessage(e: ErrorLike, status?: number): string {
  const code = e.code ?? ''
  const http = status ?? e.status
  if (code === '42501' || http === 403) return "You don't have permission to do that."
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt (expired|invalid)/i.test(e.message) || http === 401) return 'Your session has expired. Please sign in again.'
  if (code === '23505') return 'That already exists.'
  if (code === '23503') return 'That refers to something that no longer exists, or is still in use.'
  if (code === '23502') return 'A required value is missing.'
  if (code === '23514') return "One of the values isn't allowed."
  if (code === '22P02' || code === '22007' || code === '22008') return 'One of the values has the wrong format.'
  if (code === '42703' || code === '42P01' || code === '42883' || code === 'PGRST204' || code === 'PGRST202') {
    // A schema/code mismatch: not something the person can fix, and the raw text is database internals.
    return `The server could not complete that (internal error ${code}). This has been logged — please report it.`
  }
  return e.message
}

/**
 * Normalises anything with a `message` — PostgrestError, StorageError, FunctionsError — into an AppError, keeping the
 * code/details/hint. Kept as the one shared normaliser per ARCHITECTURE.md's "one implementation per concept" rule.
 * Pass the HTTP `status` from the Supabase response when you have it.
 */
export function toError(error: ErrorLike | null, status?: number): AppError | null {
  return error ? new AppError(error, status) : null
}
