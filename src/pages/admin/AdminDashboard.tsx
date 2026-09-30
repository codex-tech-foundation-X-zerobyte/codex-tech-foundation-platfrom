import { useEffect, useState } from 'react'
import { Briefcase, FileText, FolderKanban, Inbox, ShieldCheck, Users } from 'lucide-react'
import { SectionHeading, Stat } from '../../components/ui'
import { countRows } from '../../lib/services'
import { supabase } from '../../lib/supabase'
import './AdminDashboard.css'

const METRICS = [
  { key: 'workers', table: 'worker_profiles', label: 'Active workers', icon: Users, filters: { status: 'active' }, idColumn: 'user_id' },
  { key: 'clients', table: 'clients', label: 'Active clients', icon: Briefcase, filters: undefined, idColumn: 'id' },
  { key: 'projects', table: 'projects', label: 'Projects', icon: FolderKanban, filters: undefined, idColumn: 'id' },
  { key: 'leads', table: 'leads', label: 'Open leads', icon: Inbox, filters: { status: 'new' }, idColumn: 'id' },
  { key: 'applications', table: 'applications', label: 'Applications', icon: FileText, filters: undefined, idColumn: 'id' },
  { key: 'published', table: 'blog_posts', label: 'Published posts', icon: ShieldCheck, filters: undefined, idColumn: 'id' },
] as const

type HealthState = 'checking' | 'healthy' | 'degraded' | 'unavailable'

/**
 * Real checks, not claims. Database: a real query, timed — errors mean
 * unavailable, a slow-but-successful response means degraded. Edge
 * functions: an actual invocation of the no-op `health` function. RLS
 * enforcement is NOT checked here — verifying it live would mean
 * deliberately attempting an operation that should be denied, which is
 * exactly the kind of "test in production" behavior worth avoiding; that's
 * still a "not checked" per the spec's own healthy/degraded/unavailable/not
 * checked vocabulary, not a claim either way.
 */
function useHealthChecks() {
  const [db, setDb] = useState<HealthState>('checking')
  const [functions, setFunctions] = useState<HealthState>('checking')

  useEffect(() => {
    const start = performance.now()
    void supabase.from('profiles').select('id', { head: true, count: 'exact' }).then(({ error }) => {
      if (error) { setDb('unavailable'); return }
      setDb(performance.now() - start > 2000 ? 'degraded' : 'healthy')
    })

    const fnStart = performance.now()
    void supabase.functions.invoke('health').then(({ data, error }) => {
      if (error || !data?.ok) { setFunctions('unavailable'); return }
      setFunctions(performance.now() - fnStart > 3000 ? 'degraded' : 'healthy')
    })
  }, [])

  return { db, functions }
}

function HealthRow({ label, state }: { label: string; state: HealthState | 'not_checked' }) {
  const tone = { checking: 'checking', healthy: 'ok', degraded: 'warn', unavailable: 'bad', not_checked: 'checking' }[state]
  const text = { checking: 'Checking…', healthy: 'Healthy', degraded: 'Degraded', unavailable: 'Unavailable', not_checked: 'Not checked' }[state]
  return <li><span className={`ctf-health-dot ctf-health-dot--${tone}`} /> {label}: {text}</li>
}

export function AdminDashboard() {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const { db, functions } = useHealthChecks()

  useEffect(() => {
    METRICS.forEach((m) => {
      void countRows(m.table, m.filters as Record<string, string> | undefined, m.idColumn).then(({ count, error }) => {
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
            <HealthRow label="Database connection" state={db} />
            <HealthRow label="Edge functions" state={functions} />
            <HealthRow label="Row-level security" state="not_checked" />
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
