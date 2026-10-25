/** Small, pure display helpers (no React, no Supabase) so they can be unit-tested. */

/** "just now", "5 minutes ago", "3 days ago", then a plain date for anything older than ~3 weeks. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 21) return `${days} day${days === 1 ? '' : 's'} ago`
  return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** How long someone has been here, from a YYYY-MM-DD join date: "3 weeks", "8 months", "2 years 4 months". */
export function tenure(joinDate: string | null | undefined, now: Date = new Date()): string | null {
  if (!joinDate) return null
  const start = new Date(joinDate)
  if (Number.isNaN(start.getTime()) || start > now) return null
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 1) {
    const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
    if (days < 7) return days <= 1 ? 'Joined today' : `${days} days`
    const weeks = Math.floor(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return `${years} year${years === 1 ? '' : 's'}${rest ? ` ${rest} month${rest === 1 ? '' : 's'}` : ''}`
}

/** "task.status_changed" → "Task status changed". Unknown shapes still read acceptably. */
export function humanizeAction(action: string): string {
  const text = action.replace(/[._]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Activity'
}

/** True when a piece of text is long enough to deserve a "Read more" instead of being poured onto the page. */
export const isLongText = (text: string | null | undefined, limit = 220) => (text ?? '').trim().length > limit
