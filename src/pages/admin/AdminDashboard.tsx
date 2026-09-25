import { useEffect, useState } from 'react'
import { Briefcase, FileText, FolderKanban, Inbox, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { Button, SectionHeading, Stat } from '../../components/ui'
import { checkDatabaseHealth, checkEdgeFunctionHealth, countRows } from '../../lib/services'
import type { HealthCheckResult } from '../../lib/services/healthCheck'
import './AdminDashboard.css'

const METRICS = [
  { key: 'workers', table: 'worker_profiles', label: 'Active workers', icon: Users, filters: { status: 'active' }, idColumn: 'user_id' },
  { key: 'clients', table: 'clients', label: 'Active clients', icon: Briefcase, filters: undefined, idColumn: 'id' },
  { key: 'projects', table: 'projects', label: 'Projects', icon: FolderKanban, filters: undefined, idColumn: 'id' },
  { key: 'leads', table: 'leads', label: 'Open leads', icon: Inbox, filters: { status: 'new' }, idColumn: 'id' },
  { key: 'applications', table: 'applications', label: 'Applications', icon: FileText, filters: undefined, idColumn: 'id' },
  { key: 'published', table: 'blog_posts', label: 'Published posts', icon: ShieldCheck, filters: undefined, idColumn: 'id' },
] as const

export function AdminDashboard() {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [dbHealth, setDbHealth] = useState<HealthCheckResult>({ status: 'checking', latencyMs: null })
  const [fnHealth, setFnHealth] = useState<HealthCheckResult>({ status: 'checking', latencyMs: null })
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    METRICS.forEach((m) => {
      void countRows(m.table, m.filters as Record<string, string> | undefined, m.idColumn).then(({ count, error }) => {
        setCounts((prev) => ({ ...prev, [m.key]: error ? null : count }))
      })
    })
  }, [])

  const runHealthChecks = () => {
    setChecking(true)
    setDbHealth({ status: 'checking', latencyMs: null })
    setFnHealth({ status: 'checking', latencyMs: null })
    void Promise.all([checkDatabaseHealth(), checkEdgeFunctionHealth()]).then(([db, fn]) => {
      setDbHealth(db)
      setFnHealth(fn)
      setLastChecked(new Date())
      setChecking(false)
    })
  }
  useEffect(runHealthChecks, [])

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2>System health</h2>
            <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={runHealthChecks} loading={checking}>Recheck</Button>
          </div>
          {/* Every line here is a real, just-measured network check — not a
              hardcoded status. RLS enforcement isn't listed as a live check:
              it can't be verified from an authenticated admin session (an
              admin session is SUPPOSED to see broad data — that's not a
              useful signal either way), and claiming it's "enforced" without
              actually testing it would be exactly the fake-status problem
              this replaced. See docs/DATABASE-SCHEMA.md for what's actually
              in place; a real automated RLS test suite is still open work. */}
          <ul className="ctf-health-list">
            <HealthRow label="Database" result={dbHealth} />
            <HealthRow label="Edge functions" result={fnHealth} />
          </ul>
          {lastChecked && <p className="ctf-muted" style={{ fontSize: 12, marginTop: 8 }}>Last checked {lastChecked.toLocaleTimeString()}</p>}
        </section>
        <section>
          <h2>Pending actions</h2>
          <p className="ctf-muted">New leads and job applications requiring review will surface here once the review queue is wired up.</p>
        </section>
      </div>
    </div>
  )
}

function HealthRow({ label, result }: { label: string; result: HealthCheckResult }) {
  const tone = result.status === 'checking' ? 'checking' : result.status === 'healthy' ? 'ok' : result.status === 'degraded' ? 'warn' : 'down'
  const text =
    result.status === 'checking' ? `${label}: checking…` :
    result.status === 'healthy' ? `${label}: healthy (${result.latencyMs}ms)` :
    result.status === 'degraded' ? `${label}: slow (${result.latencyMs}ms)` :
    `${label}: unavailable${result.error ? ` — ${result.error}` : ''}`
  return (
    <li>
      <span className={`ctf-health-dot ctf-health-dot--${tone}`} />
      {text}
    </li>
  )
}
