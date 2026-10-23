/**
 * "Start a project" submissions are flattened by the submit-lead function into one text field:
 *   Project type: Web app\nProblem: …\nBudget: …
 * This reads that back into labelled fields so a lead can be shown as a tidy summary instead of a wall of text. A plain
 * contact-form message (no labels) comes back untouched as `rest`. Pure, so it is unit-tested.
 */

export interface LeadField { label: string; value: string }
export interface ParsedLeadMessage { fields: LeadField[]; rest: string; phone: string | null }

const LABELS = ['Project type', 'Problem', 'Desired outcome', 'Budget', 'Timeline', 'Existing system', 'Phone', 'Additional information'] as const
const LABEL_LINE = new RegExp(`^(${LABELS.join('|')}):\\s*(.*)$`, 'i')

export function parseLeadMessage(message: string): ParsedLeadMessage {
  const fields: LeadField[] = []
  const rest: string[] = []
  let current: LeadField | null = null

  for (const line of message.replace(/\r\n/g, '\n').split('\n')) {
    const match = LABEL_LINE.exec(line)
    if (match) {
      const label = LABELS.find((l) => l.toLowerCase() === match[1].toLowerCase()) ?? match[1]
      current = { label, value: match[2] }
      fields.push(current)
    } else if (current) {
      current.value += `\n${line}`           // a value that itself spans several lines
    } else {
      rest.push(line)
    }
  }

  // One stray "Budget: …" line inside an ordinary message is not a structured submission.
  if (fields.length < 2) return { fields: [], rest: message.trim(), phone: null }

  const clean = fields.map((f) => ({ label: f.label, value: f.value.trim() })).filter((f) => f.value)
  const phone = clean.find((f) => f.label === 'Phone')?.value ?? null
  return { fields: clean, rest: rest.join('\n').trim(), phone }
}

/** A phone number as a safe tel: href (digits and a leading +), or null if it doesn't look like one. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d+]/g, '')
  return /^\+?\d{6,15}$/.test(digits) ? `tel:${digits}` : null
}
