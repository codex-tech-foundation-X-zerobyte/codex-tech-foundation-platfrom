/** Leads per week for the last 13 weeks (Monday-based), plus counts by status. All from the public-site enquiry form. */
export function summariseLeads(rows: { status: string; created_at: string }[], now: Date = new Date(), weeks = 13) {
  const monday = (d: Date) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime() }
  const start = monday(now) - (weeks - 1) * 7 * 86_400_000
  const buckets = Array.from({ length: weeks }, (_, i) => ({ start: start + i * 7 * 86_400_000, count: 0 }))
  const byStatus: Record<string, number> = {}
  for (const r of rows) {
    const t = new Date(r.created_at); const w = Math.floor((monday(t) - start) / (7 * 86_400_000))
    if (w >= 0 && w < weeks) buckets[w].count++
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  }
  return { buckets, byStatus, total: rows.length }
}

