/**
 * The numbers behind the overview pages. Pure functions of data + "now", so every rule is testable and no component calls
 * Date.now() while rendering. Dates are day-granular: a task due today is NOT overdue until tomorrow.
 */
export interface TaskLike { id: string; assignee_id: string | null; status: 'todo' | 'in_progress' | 'blocked' | 'done'; priority: string; due_date: string | null; completed_at: string | null; project_id: string; title: string }
export interface MilestoneLike { project_id: string; status: string; percentage: number }
export interface ProjectLike { id: string; status: string; due_date: string | null }

const DAY = 86_400_000
/** Midnight (local) of the day containing `t`. A bare "YYYY-MM-DD" is read as a LOCAL calendar day, not UTC midnight. */
export function startOfDay(t: number | string | Date): number {
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
  const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime()
}
export const daysBetween = (from: number | string | Date, to: number | string | Date) => Math.round((startOfDay(to) - startOfDay(from)) / DAY)

/** "Today", "Tomorrow", "Yesterday", "in 5 days", "3 days ago" — relative to now, by calendar day. */
export function relativeDay(date: string, now: number): string {
  const n = daysBetween(now, date)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

export function greeting(now: number, name: string): string {
  const h = new Date(now).getHours()
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const first = name.trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 }

export function summariseTasks(tasks: TaskLike[], meId: string | undefined, now: number) {
  const open = tasks.filter((t) => t.status !== 'done')
  const mine = meId ? open.filter((t) => t.assignee_id === meId) : []
  const today = startOfDay(now)
  const overdue = mine.filter((t) => t.due_date && startOfDay(t.due_date) < today)
  const dueSoon = mine.filter((t) => t.due_date && startOfDay(t.due_date) >= today && startOfDay(t.due_date) <= today + 7 * DAY)
  // What to look at first: overdue (oldest first), then due soon (soonest first), ties broken by priority.
  const order = (a: TaskLike, b: TaskLike) => startOfDay(a.due_date!) - startOfDay(b.due_date!) || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
  const byStatus = { todo: 0, in_progress: 0, blocked: 0, done: 0 }
  for (const t of tasks.filter((x) => x.assignee_id === meId)) byStatus[t.status] += 1
  return {
    mine, overdue: [...overdue].sort(order), dueSoon: [...dueSoon].sort(order),
    blocked: mine.filter((t) => t.status === 'blocked'), byStatus,
    focus: [...overdue.sort(order), ...dueSoon.sort(order)],
  }
}

/** Completions per day for the last `days` days, oldest first (today is the last bucket). */
export function dailyCounts(isoDates: (string | null)[], days: number, now: number): number[] {
  const today = startOfDay(now)
  const buckets = Array.from({ length: days }, () => 0)
  for (const iso of isoDates) {
    if (!iso) continue
    const ago = Math.round((today - startOfDay(iso)) / DAY)
    if (ago >= 0 && ago < days) buckets[days - 1 - ago] += 1
  }
  return buckets
}

/** Real progress from milestones (a completed milestone counts 100%), not inferred from the project's status label. */
export function milestoneProgress(milestones: MilestoneLike[]): { percent: number; done: number; total: number } | null {
  if (milestones.length === 0) return null
  const done = milestones.filter((m) => m.status === 'complete').length
  const sum = milestones.reduce((s, m) => s + (m.status === 'complete' ? 100 : Math.max(0, Math.min(100, m.percentage || 0))), 0)
  return { percent: Math.round(sum / milestones.length), done, total: milestones.length }
}

export function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) { const k = key(r); out[k] = (out[k] ?? 0) + 1 }
  return out
}

/** Projects past their due date that are neither finished nor archived. */
export function overdueProjects<P extends ProjectLike>(projects: P[], now: number): P[] {
  const today = startOfDay(now)
  return projects.filter((p) => p.due_date && startOfDay(p.due_date) < today && p.status !== 'completed' && p.status !== 'archived')
}

export const OPEN_REQUEST = (status: string) => status === 'open' || status === 'in_review'
