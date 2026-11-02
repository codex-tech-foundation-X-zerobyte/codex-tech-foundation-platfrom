export class SupportError extends Error {
  /** The HTTP status, or 0 when the service could not be reached. */
  status: number
  /** Present on a 429: seconds to wait before trying again. */
  retryAfterSeconds?: number
}

export type TicketCategory = 'bug' | 'billing' | 'account' | 'how_to' | 'feedback' | 'other'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export interface TicketReport {
  /** A stable id from YOUR system (an order id, a conversation id). The same value never makes a second ticket, so retries are safe. */
  external_ref: string
  subject: string
  description?: string
  customer_ref?: string
  customer_name?: string
  category?: TicketCategory
  priority?: TicketPriority
}
export type CustomerStatus = 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved' | 'closed'
export interface CustomerTicketView {
  ticket: { ref: string; status: CustomerStatus; subject: string; created_at: string; resolved_at: string | null; rating: number | null; can_reply: boolean; can_rate: boolean }
  messages: { id: string; from: 'customer' | 'support'; body: string; at: string }[]
  attachments: { id: string; name: string; mime_type: string; size_bytes: number }[]
}
export interface SupportClientOptions {
  /** https://<project-ref>.supabase.co/functions/v1 */
  baseUrl: string
  /** The ctfs_… key. SERVER ONLY. */
  key: string
  fetch?: typeof fetch
  timeoutMs?: number
  retries?: number
  wait?: (ms: number) => Promise<void>
}
export interface SupportClient {
  createTicket(report: TicketReport): Promise<{ ticket: string | null; duplicate: boolean }>
  getTicket(externalRef: string): Promise<CustomerTicketView>
  reply(externalRef: string, body: string): Promise<{ ok: true }>
  rate(externalRef: string, rating: 1 | 2 | 3 | 4 | 5, note?: string): Promise<{ ok: true }>
  attachmentLink(externalRef: string, attachmentId: string): Promise<{ url: string; name: string; mime_type: string; expires_in: number }>
}
export function createSupportClient(options: SupportClientOptions): SupportClient

export type CallbackEventName = 'ticket.acknowledged' | 'ticket.reply' | 'ticket.status'
export interface CallbackPayload {
  event: CallbackEventName
  /** Increases with every event. Ignore an event whose sequence is lower than the last one you applied for that ticket. */
  sequence: number
  ticket_ref: string
  external_ref: string
  occurred_at: string
  /** Only on ticket.status */
  status?: CustomerStatus
  /** Only on ticket.reply */
  message?: { body: string; at: string }
  /** Only on ticket.acknowledged */
  acknowledged_at?: string
}
/** `rawBody` must be the exact text received. `header` is the x-codex-signature header. */
export function verifyCallback(secret: string, header: string | null | undefined, rawBody: string, options?: { nowSeconds?: number; toleranceSeconds?: number }): Promise<boolean>
