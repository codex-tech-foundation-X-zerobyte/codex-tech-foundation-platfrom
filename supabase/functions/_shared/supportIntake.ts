/**
 * support-intake: the pure parts (no Deno, no network) so they can be unit-tested.
 * A connected project's BACKEND sends a customer's report here. The function checks the body, hashes the project key and hands
 * both to the database, which authenticates the key, de-duplicates by external_ref and creates the ticket.
 */
export const LIMITS = { subject: 200, description: 8000, customerRef: 200, customerName: 120, externalRef: 200, body: 32 * 1024 } as const
const CATEGORIES = ['bug', 'billing', 'account', 'how_to', 'feedback', 'other']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']

export interface IntakeReport { external_ref: string; customer_ref: string; customer_name: string; subject: string; description: string; category: string; priority: string }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Validates a report. Unknown categories/priorities are not an error (the project may be newer than us): they fall back to defaults. */
export function parseReport(input: unknown): { ok: true; report: IntakeReport } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Send a JSON object.' }
  const o = input as Record<string, unknown>
  const external_ref = str(o.external_ref), subject = str(o.subject)
  if (!external_ref) return { ok: false, error: 'external_ref is required: a stable id from your system, so a retry cannot create a second ticket.' }
  if (external_ref.length > LIMITS.externalRef) return { ok: false, error: `external_ref is too long (max ${LIMITS.externalRef}).` }
  if (subject.length < 3) return { ok: false, error: 'subject is required (at least 3 characters).' }
  if (subject.length > LIMITS.subject) return { ok: false, error: `subject is too long (max ${LIMITS.subject}).` }
  const description = str(o.description), customer_ref = str(o.customer_ref), customer_name = str(o.customer_name)
  if (description.length > LIMITS.description) return { ok: false, error: `description is too long (max ${LIMITS.description}).` }
  if (customer_ref.length > LIMITS.customerRef) return { ok: false, error: 'customer_ref is too long.' }
  if (customer_name.length > LIMITS.customerName) return { ok: false, error: 'customer_name is too long.' }
  const category = str(o.category).toLowerCase(), priority = str(o.priority).toLowerCase()
  return { ok: true, report: { external_ref, customer_ref, customer_name, subject, description, category: CATEGORIES.includes(category) ? category : 'other', priority: PRIORITIES.includes(priority) ? priority : 'normal' } }
}

/** Data a ticket must never carry: if a project forwards these, we refuse rather than store them. */
const SECRET_SHAPES: [RegExp, string][] = [
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/, 'what looks like a payment provider secret key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'what looks like an access token'],
  [/\bpassword\s*[:=]\s*\S+/i, 'a password'],
]
/** Luhn checksum: real card numbers pass it, order and phone numbers almost never do. */
export function luhn(digits: string): boolean {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9 } sum += n; alt = !alt }
  return digits.length > 0 && sum % 10 === 0
}
const hasCardNumber = (text: string) => [...text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)].some((m) => { const d = m[0].replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) })

/** Looks for card numbers, secret keys, tokens and passwords in the free text. Returns what it found, or null. */
export function findSensitive(report: Pick<IntakeReport, 'subject' | 'description'>): string | null {
  const text = `${report.subject}\n${report.description}`
  if (hasCardNumber(text)) return 'what looks like a card number'
  for (const [re, what] of SECRET_SHAPES) if (re.test(text)) return what
  return null
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const KEY_SHAPE = /^ctfs_[0-9a-f]{48}$/
