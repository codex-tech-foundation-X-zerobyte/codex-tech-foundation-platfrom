import { Link } from 'react-router'
import { Gauge } from 'lucide-react'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui'
import { getSuperDashboard, type MoneyLine, type SuperDashboardData } from '../../lib/services'
import { BASIS_LABEL } from '../../lib/monitorRules'
import { money } from '../../lib/fundWorkflow'
import { humanizeAction, timeAgo } from '../../lib/format'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useAuth } from '../../lib/auth'
import './SuperDashboard.css'

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'warning' }) {
  return <div className={`ctf-sdash__stat${tone ? ` is-${tone}` : ''}`}><dt>{label}</dt><dd>{value}</dd></div>
}

/** Money is always shown with what KIND of figure it is, so a pending amount is never mistaken for money that was paid. */
function MoneyLines({ title, lines }: { title: string; lines: MoneyLine[] }) {
  return (
    <div className="ctf-sdash__money">
      <h3>{title}</h3>
      {lines.length === 0 ? <p className="ctf-sdash__none">None</p> : (
        <ul>{lines.map((l) => <li key={`${l.basis}-${l.currency}`}><strong>{money(l.amount, l.currency)}</strong>{l.count !== undefined && <span className="ctf-sdash__sub"> · {l.count} request{l.count === 1 ? '' : 's'}</span>} <Badge tone={l.basis === 'estimated' ? 'warning' : l.basis === 'pending' ? 'neutral' : 'success'}>{BASIS_LABEL[l.basis]?.label ?? l.basis}</Badge></li>)}</ul>
      )}
    </div>
  )
}

function Card({ id, title, link, linkLabel, children }: { id: string; title: string; link?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="ctf-sdash__card" aria-labelledby={`sd-${id}`}>
      <div className="ctf-sdash__head"><h2 id={`sd-${id}`}>{title}</h2>{link && <Link to={link} className="text-link">{linkLabel ?? 'Open'}</Link>}</div>
      {children}
    </section>
  )
}

function Sections({ d, base }: { d: SuperDashboardData; base: string }) {
  const m = d.monitoring, s = d.support, f = d.finance, r = d.renewals, a = d.audit
  return (
    <div className="ctf-sdash__grid">
      {m && (
        <Card id="monitoring" title="Monitoring" link={`${base}/monitor`} linkLabel="Open Super Monitor">
          <dl className="ctf-sdash__stats">
            <Stat label="Projects" value={m.projects.total} />
            <Stat label="Healthy" value={m.projects.healthy} />
            <Stat label="Degraded" value={m.projects.degraded} tone={m.projects.degraded ? 'warning' : undefined} />
            <Stat label="Down" value={m.projects.down} tone={m.projects.down ? 'danger' : undefined} />
            <Stat label="Open incidents" value={m.incidents.open} />
            <Stat label="Critical" value={m.incidents.critical} tone={m.incidents.critical ? 'danger' : undefined} />
            <Stat label="Unacknowledged" value={m.incidents.unacknowledged} tone={m.incidents.unacknowledged ? 'warning' : undefined} />
            <Stat label="Errors, 24 h" value={m.errors_24h.toLocaleString()} />
          </dl>
          {m.incidents.oldest_unacknowledged_minutes !== null && m.incidents.oldest_unacknowledged_minutes > 0 && <p className="ctf-sdash__sub">The longest-waiting incident has gone unacknowledged for {m.incidents.oldest_unacknowledged_minutes} minute{m.incidents.oldest_unacknowledged_minutes === 1 ? '' : 's'}.</p>}
        </Card>
      )}
      {s && (
        <Card id="support" title="Customer support" link={`${base}/support`} linkLabel="Open Support desk">
          <dl className="ctf-sdash__stats"><Stat label="Open tickets" value={s.open} /><Stat label="Past first-reply target" value={s.overdue} tone={s.overdue ? 'danger' : undefined} /><Stat label="Unassigned" value={s.unassigned} tone={s.unassigned ? 'warning' : undefined} /><Stat label="Urgent" value={s.urgent} tone={s.urgent ? 'danger' : undefined} /></dl>
        </Card>
      )}
      {f && (
        <Card id="finance" title="Spending" link={`${base}/funds`} linkLabel="Open Fund requests">
          {f.needs_attention > 0 && <p className="ctf-sdash__alert" role="status"><strong>{f.needs_attention}</strong> request{f.needs_attention === 1 ? ' needs' : 's need'} attention: a failed or reversed payment, or one waiting to be reconciled.</p>}
          <MoneyLines title="Waiting for a decision" lines={f.pending_decision} />
          <MoneyLines title="Approved, not yet paid" lines={f.approved_unpaid} />
          <MoneyLines title="Paid in the last 30 days" lines={f.paid_30d} />
          <MoneyLines title="Reconciled in the last 30 days" lines={f.reconciled_30d} />
          <ul className="ctf-sdash__legend" aria-label="What the labels mean">{Object.values(BASIS_LABEL).map((b) => <li key={b.label}><strong>{b.label}</strong>: {b.hint}</li>)}</ul>
        </Card>
      )}
      {r && (
        <Card id="renewals" title="Renewals" link={`${base}/finance`} linkLabel="Open Finance office">
          <dl className="ctf-sdash__stats"><Stat label="Due in 30 days" value={r.due_30d_count} /><Stat label="Critical" value={r.critical_due_30d} tone={r.critical_due_30d ? 'warning' : undefined} /><Stat label="Overdue" value={r.overdue} tone={r.overdue ? 'danger' : undefined} /></dl>
          <MoneyLines title="Expected in the next 30 days" lines={r.due_30d_amount} />
        </Card>
      )}
      {a && (
        <Card id="audit" title="Security and audit" link="/admin/audit" linkLabel="Open Audit log">
          <dl className="ctf-sdash__stats"><Stat label="Events, 24 h" value={a.events_24h} /><Stat label="Warnings" value={a.warnings_24h} tone={a.warnings_24h ? 'warning' : undefined} /><Stat label="Critical" value={a.critical_24h} tone={a.critical_24h ? 'danger' : undefined} /><Stat label="Failed" value={a.failed_24h} tone={a.failed_24h ? 'warning' : undefined} /></dl>
          {a.recent.length > 0 && <ul className="ctf-sdash__recent" aria-label="Recent warnings">{a.recent.map((e, i) => <li key={i}><Badge tone={e.severity === 'critical' ? 'danger' : 'warning'}>{e.severity}</Badge> {humanizeAction(e.action)} <span className="ctf-sdash__sub">{timeAgo(e.created_at)}</span></li>)}</ul>}
        </Card>
      )}
    </div>
  )
}

/** One read-only summary. Each section appears only for people whose own permission covers that data; the rest is simply absent. */
export function SuperDashboard() {
  useDocumentTitle('Super Dashboard')
  const { profile } = useAuth()
  const dash = useAsyncData('super-dashboard', getSuperDashboard)
  const d = dash.data
  const base = profile?.role === 'superadmin' ? '/admin' : '/worker'
  return (
    <div className="ctf-sdash">
      <PageHeader title="Super Dashboard" description="The company at a glance: system health, support, spending, renewals and security. You see the sections your role covers." />
      {dash.loading ? <SkeletonRows rows={4} /> : dash.error ? <ErrorState title="The dashboard couldn't load" description={dash.errorDetail?.message ?? 'Try again.'} onRetry={dash.reload} /> : !d || d.sections.length === 0
        ? <EmptyState icon={Gauge} title="Nothing here for you yet" description="The Super Dashboard shows monitoring to DevOps and Cybersecurity, support to the Customer Service lead, spending to Finance, and everything to the Main Admin." />
        : <><Sections d={d} base={base} /><p className="ctf-sdash__sub">Updated {timeAgo(d.generated_at)}. Refresh the page for current figures.</p></>}
    </div>
  )
}
