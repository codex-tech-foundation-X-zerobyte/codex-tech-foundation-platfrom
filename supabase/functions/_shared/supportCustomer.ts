/**
 * The customer-facing support endpoint, as a pure module: what a connected project's backend may ask, and how a database error becomes an
 * HTTP answer. No Deno imports, so Node tests can load it. The database re-checks everything; this layer refuses junk early and keeps the
 * answers free of internals.
 */
import { findSensitive } from './supportIntake.ts'

export const CUSTOMER_LIMITS = { body: 16 * 1024, ref: 200, reply: 8000, note: 1000 } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CustomerRequest =
  | { action: 'status'; external_ref: string }
  | { action: 'reply'; external_ref: string; body: string }
  | { action: 'rating'; external_ref: string; rating: number; note: string | null }
  | { action: 'attachment'; external_ref: string; attachment_id: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseCustomerRequest(input: unknown): { ok: true; request: CustomerRequest } | { ok: false; error: string } {
  if (!isObject(input)) return { ok: false, error: 'Send a JSON object.' }
  const ref = typeof input.external_ref === 'string' ? input.external_ref.trim() : ''
  if (!ref || ref.length > CUSTOMER_LIMITS.ref) return { ok: false, error: `external_ref is required (1 to ${CUSTOMER_LIMITS.ref} characters).` }
  switch (input.action) {
    case 'status': return { ok: true, request: { action: 'status', external_ref: ref } }
    case 'reply': {
      const body = typeof input.body === 'string' ? input.body.trim() : ''
      if (!body) return { ok: false, error: 'body is required.' }
      if (body.length > CUSTOMER_LIMITS.reply) return { ok: false, error: `body is too long (at most ${CUSTOMER_LIMITS.reply} characters).` }
      const sensitive = findSensitive({ subject: '', description: body })
      if (sensitive) return { ok: false, error: `The message contains ${sensitive}. Ask the customer not to send card numbers or secrets.` }
      return { ok: true, request: { action: 'reply', external_ref: ref, body } }
    }
    case 'rating': {
      const rating = input.rating
      if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'rating must be a whole number from 1 to 5.' }
      const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null
      if (note && note.length > CUSTOMER_LIMITS.note) return { ok: false, error: `note is too long (at most ${CUSTOMER_LIMITS.note} characters).` }
      return { ok: true, request: { action: 'rating', external_ref: ref, rating, note } }
    }
    case 'attachment': {
      const id = typeof input.attachment_id === 'string' ? input.attachment_id.trim() : ''
      if (!UUID.test(id)) return { ok: false, error: 'attachment_id must be an attachment id from the status response.' }
      return { ok: true, request: { action: 'attachment', external_ref: ref, attachment_id: id.toLowerCase() } }
    }
    default: return { ok: false, error: 'action must be one of: status, reply, rating, attachment.' }
  }
}

/** A database error code becomes an HTTP answer. Only messages the database wrote for people are passed on; anything unexpected is a plain 500. */
export function answerForDbError(error: { code?: string; message?: string }): { status: number; message: string } {
  switch (error.code) {
    case 'P0002': return { status: 404, message: 'Ticket not found.' }        // never says whether the key or the reference was wrong
    case '23514': return { status: 409, message: error.message ?? 'That is not possible right now.' }
    case '22023': return { status: 400, message: error.message ?? 'Invalid value.' }
    default: return { status: 500, message: 'Something went wrong. Try again.' }
  }
}
