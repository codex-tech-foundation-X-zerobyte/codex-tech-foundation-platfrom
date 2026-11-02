import { EmptyState, ErrorState, SkeletonRows, Surface } from '../../components/ui'
import { loadLeadStats } from '../../lib/services'
import { summariseLeads } from '../../lib/leadStats'
import { useAsyncData } from '../../hooks/useAsyncData'

export function LeadStats() {
  const data = useAsyncData('lead-stats', () => loadLeadStats(91))
  if (data.loading) return <SkeletonRows rows={3} height="80px" />
  if (data.error) return <ErrorState title="Lead data couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} />
  const s = summariseLeads(data.data ?? [])
  if (s.total === 0) return <EmptyState title="No leads yet" description="Enquiries submitted through the public site appear here, week by week." />
  const max = Math.max(...s.buckets.map((b) => b.count), 1)
  return (
    <div className="ctf-denv__stack">
      <Surface>
        <h3 className="ctf-denv__h3">{s.total} leads in the last 13 weeks</h3>
        <div className="ctf-bars" role="img" aria-label={`Leads per week: ${s.buckets.map((b) => b.count).join(', ')}`}>
          {s.buckets.map((b) => <div key={b.start} className="ctf-bars__col" title={`${b.count} · week of ${new Date(b.start).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}`}><span style={{ height: `${(b.count / max) * 100}%` }} /></div>)}
        </div>
        <p className="ctf-denv__muted">Oldest week on the left. Source: the public-site enquiry form.</p>
      </Surface>
      <Surface>
        <h3 className="ctf-denv__h3">By status</h3>
        <ul className="ctf-lab__pairs">{Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}><span>{k}</span><strong>{n}</strong></li>)}</ul>
      </Surface>
    </div>
  )
}
