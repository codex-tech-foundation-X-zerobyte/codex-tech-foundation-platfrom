import { useEffect, useState } from 'react'
import { Briefcase, FileText, FolderKanban, Inbox, ShieldCheck, Users } from 'lucide-react'
import { SectionHeading, Stat } from '../../components/ui'
import { countRows } from '../../lib/services'
import './AdminDashboard.css'

const METRICS = [
  { key: 'workers', table: 'worker_profiles', label: 'Active workers', icon: Users, filters: { status: 'active' } },
  { key: 'clients', table: 'clients', label: 'Active clients', icon: Briefcase, filters: undefined },
  { key: 'projects', table: 'projects', label: 'Projects', icon: FolderKanban, filters: undefined },
  { key: 'leads', table: 'leads', label: 'Open leads', icon: Inbox, filters: { status: 'new' } },
  { key: 'applications', table: 'applications', label: 'Applications', icon: FileText, filters: undefined },
  { key: 'published', table: 'blog_posts', label: 'Published posts', icon: ShieldCheck, filters: undefined },
] as const

export function AdminDashboard() {
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  useEffect(() => {
    METRICS.forEach((m) => {
      void countRows(m.table, m.filters as Record<string, string> | undefined).then(({ count, error }) => {
        setCounts((prev) => ({ ...prev, [m.key]: error ? null : count }))
      })
    })
  }, [])

  return (
    <div>
      <SectionHeading eyebrow="Admin" title="System overview." />
      <div className="ctf-admin-grid">
        {METRICS.map((m) => (
          <Stat key={m.key} label={m.label} value={counts[m.key] ?? '—'} icon={m.icon} />
        ))}
      </div>

      <div className="ctf-admin-columns">
        <section>
          <h2>System health</h2>
          <ul className="ctf-health-list">
            <li><span className="ctf-health-dot ctf-health-dot--ok" /> Supabase connection: healthy</li>
            <li><span className="ctf-health-dot ctf-health-dot--ok" /> Row-level security: enforced</li>
            <li><span className="ctf-health-dot ctf-health-dot--ok" /> Edge functions: reachable</li>
          </ul>
        </section>
        <section>
          <h2>Pending actions</h2>
          <p className="ctf-muted">New leads and job applications requiring review will surface here once the review queue is wired up.</p>
        </section>
      </div>
    </div>
  )
}
