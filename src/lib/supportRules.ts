/** Support tickets: labels, due-time arithmetic and the numbers shown on the performance tab. */
export type TicketStatus = 'open' | 'assigned' | 'in_progress' | 'waiting_for_customer' | 'escalated' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting_for_customer: 'Waiting for customer', escalated: 'Escalated', resolved: 'Resolved', closed: 'Closed' }
export const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const CATEGORY_LABEL: Record<string, string> = { bug: 'Bug', billing: 'Billing', account: 'Account', how_to: 'How do I…', feedback: 'Feedback', other: 'Other' }
export const TECH_DEPARTMENTS = [['frontend-development', 'Frontend Development'], ['backend-development', 'Backend Development'], ['devops', 'DevOps'], ['cybersecurity', 'Cybersecurity']] as const

export const isLive = (s: TicketStatus) => s !== 'resolved' && s !== 'closed'

export interface TicketLike { status: TicketStatus; due_at: string; first_response_at: string | null; assignee_id: string | null; created_at: string; resolved_at: string | null; rating: number | null }

/** Past its first-response target and still unanswered. */
export const isOverdue = (t: Pick<TicketLike, 'status' | 'due_at' | 'first_response_at'>, now = Date.now()) => isLive(t.status) && !t.first_response_at && new Date(t.due_at).getTime() < now

export function dueLabel(t: Pick<TicketLike, 'status' | 'due_at' | 'first_response_at'>, now = Date.now()): { text: string; tone: 'neutral' | 'warning' | 'danger' } {
  if (!isLive(t.status)) return { text: 'Closed', tone: 'neutral' }
  if (t.first_response_at) return { text: 'Responded', tone: 'neutral' }
  const ms = new Date(t.due_at).getTime() - now
  const abs = Math.abs(ms), h = Math.floor(abs / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000)
  const span = h >= 48 ? `${Math.round(h / 24)} days` : h >= 1 ? `${h}h ${m}m` : `${m}m`
  return ms < 0 ? { text: `Overdue by ${span}`, tone: 'danger' } : { text: `Reply within ${span}`, tone: ms < 3_600_000 * 4 ? 'warning' : 'neutral' }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
export interface AgentStats { agent: string; handled: number; resolved: number; avgFirstResponseH: number | null; avgResolutionH: number | null; avgRating: number | null; rated: number }

/**
 * Per-agent numbers for the performance tab. Counts are shown WITH response time, resolution time and customer rating, never alone:
 * a raw "tickets closed" total rewards quick, easy tickets and says nothing about quality.
 */
export function agentStats(tickets: (TicketLike & { assignee_id: string | null })[], names: Map<string, string>): AgentStats[] {
  const byAgent = new Map<string, typeof tickets>()
  for (const t of tickets) if (t.assignee_id) byAgent.set(t.assignee_id, [...(byAgent.get(t.assignee_id) ?? []), t])
  return [...byAgent].map(([id, ts]) => {
    const ms = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
    const resolved = ts.filter((t) => t.resolved_at)
    const ratings = ts.map((t) => t.rating).filter((r): r is number => r !== null)
    return {
      agent: names.get(id) ?? 'Unknown', handled: ts.length, resolved: resolved.length,
      avgFirstResponseH: avg(ts.filter((t) => t.first_response_at).map((t) => ms(t.created_at, t.first_response_at!))),
      avgResolutionH: avg(resolved.map((t) => ms(t.created_at, t.resolved_at!))),
      avgRating: avg(ratings), rated: ratings.length,
    }
  }).sort((a, b) => b.handled - a.handled)
}

/** SHA-256 of a project key, as lowercase hex: the same function the intake edge function uses. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** A new project key. Shown once; only its hash is stored. */
export function newProjectKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const key = `ctfs_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  return { key, prefix: key.slice(0, 9) }
}
