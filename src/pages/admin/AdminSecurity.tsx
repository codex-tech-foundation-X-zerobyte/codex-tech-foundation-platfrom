import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, ExternalLink, GitBranch, Globe, Info, Plug, RefreshCw, ShieldAlert, Triangle, XCircle, Database, Monitor } from 'lucide-react'
import { Badge, Button, CopyButton, ErrorState, SkeletonRows, Table } from '../../components/ui'
import { getIntegrationScan, getSecurityPosture, listAuditLogs } from '../../lib/services'
import { attentionList, evaluateBrowser, evaluatePosture, scoreFindings, type Finding, type FindingStatus, type ProviderReport } from '../../lib/securityChecks'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminSecurity.css'

const SECURITY_ACTIONS = new Set(['login.failed', 'worker.status_changed', 'client.status_changed', 'role.assigned', 'permission.granted', 'permission.revoked'])

const ICON: Record<FindingStatus, typeof CheckCircle2> = { ok: CheckCircle2, info: Info, warn: AlertTriangle, fail: XCircle, unavailable: CircleSlash }
const LABEL: Record<FindingStatus, string> = { ok: 'Passing', info: 'Note', warn: 'Needs review', fail: 'Action needed', unavailable: 'Could not check' }

interface Section { id: string; label: string; icon: typeof Database; findings: Finding[]; configured: boolean; setup?: string; error?: string; loading?: boolean }

export function AdminSecurity() {
  const posture = useAsyncData('posture', getSecurityPosture)
  const scan = useAsyncData('scan', getIntegrationScan)
  const events = useAsyncData('events', () => listAuditLogs(200))

  const rescan = () => { posture.reload(); scan.reload(); events.reload() }
  const busy = posture.loading || scan.loading

  const browserFindings = useMemo(() => evaluateBrowser({
    protocol: window.location.protocol,
    supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? ''),
    secureContext: window.isSecureContext,
    debugOn: (() => { try { return localStorage.getItem('ctf:debug') === '1' } catch { return false } })(),
  }), [])

  const sections = useMemo<Section[]>(() => {
    const byProvider = (id: ProviderReport['provider']) => scan.data?.providers.find((p) => p.provider === id)
    const ext = (id: ProviderReport['provider'], label: string, icon: typeof Database): Section => {
      const p = byProvider(id)
      return { id, label, icon, findings: p?.findings ?? [], configured: p?.configured ?? false, setup: p?.setup, error: scan.errorDetail?.message, loading: scan.loading }
    }
    return [
      { id: 'database', label: 'Database & storage', icon: Database, findings: posture.data ? evaluatePosture(posture.data) : [], configured: true, error: posture.errorDetail?.message, loading: posture.loading },
      { id: 'browser', label: 'This browser', icon: Monitor, findings: browserFindings, configured: true },
      ext('github', 'GitHub', GitBranch),
      ext('vercel', 'Vercel', Plug),
      ext('headers', 'Website headers', Globe),
    ]
  }, [posture.data, posture.errorDetail, posture.loading, scan.data, scan.errorDetail, scan.loading, browserFindings])

  const all = sections.flatMap((s) => s.findings.map((f) => ({ ...f, source: s.label })))
  const { score, grade, counts } = scoreFindings(all)
  const attention = attentionList(all)
  const connected = sections.filter((s) => s.configured && s.findings.length > 0).length

  const securityEvents = (events.data ?? []).filter((e) => SECURITY_ACTIONS.has(e.action) || e.severity === 'warning' || e.severity === 'error')

  return (
    <div className="ctf-sec">
      <section className={`ctf-sec__hero ctf-sec__hero--${grade}`}>
        <div className="ctf-sec__ring" role="img" aria-label={`Security score ${score} out of 100, grade ${grade}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="52" className="ctf-sec__ring-track" />
            <circle cx="60" cy="60" r="52" className="ctf-sec__ring-value" style={{ strokeDasharray: `${(score / 100) * 326.7} 326.7` }} />
          </svg>
          <div><strong>{busy && all.length === 0 ? '…' : score}</strong><span>Grade {grade}</span></div>
        </div>
        <div className="ctf-sec__summary">
          <h2>{counts.fail > 0 ? `${counts.fail} thing${counts.fail === 1 ? ' needs' : 's need'} action now` : counts.warn > 0 ? `${counts.warn} thing${counts.warn === 1 ? '' : 's'} worth reviewing` : 'Nothing needs attention'}</h2>
          <p>{all.length} checks across {connected} connected source{connected === 1 ? '' : 's'}. {counts.unavailable > 0 && `${counts.unavailable} could not be checked and are not counted. `}Every line below comes from a live check, not a static claim.</p>
          <div className="ctf-sec__counts">
            <span className="is-fail"><XCircle size={14} /> {counts.fail} action needed</span>
            <span className="is-warn"><AlertTriangle size={14} /> {counts.warn} to review</span>
            <span className="is-ok"><CheckCircle2 size={14} /> {counts.ok} passing</span>
          </div>
        </div>
        <Button variant="secondary" icon={<RefreshCw size={14} />} loading={busy} onClick={rescan}>Scan again</Button>
      </section>

      {attention.length > 0 && (
        <section className="ctf-sec__panel" aria-labelledby="sec-attn">
          <h2 id="sec-attn"><ShieldAlert size={16} /> Needs attention</h2>
          <ul className="ctf-sec__list">{attention.map((f) => <FindingRow key={f.source + f.id} finding={f} source={f.source} />)}</ul>
        </section>
      )}

      <div className="ctf-sec__sections">
        {sections.map((s) => <SectionCard key={s.id} section={s} />)}
      </div>

      <section className="ctf-sec__panel" aria-labelledby="sec-events">
        <h2 id="sec-events"><Triangle size={16} /> Recent security events</h2>
        {events.error ? <ErrorState title="Events didn't load" description={events.errorDetail?.message} onRetry={events.reload} /> : (
          <Table
            caption="Recent security events"
            loading={events.loading}
            rows={securityEvents.slice(0, 25)}
            rowKey={(e) => e.id}
            emptyState={<div className="ctf-muted">No security-relevant events recorded yet.</div>}
            columns={[
              { key: 'when', header: 'When', render: (e) => new Date(e.created_at).toLocaleString() },
              { key: 'action', header: 'Action', render: (e) => <strong>{e.action}</strong> },
              { key: 'resource', header: 'Resource', render: (e) => e.resource_type },
              { key: 'severity', header: 'Severity', render: (e) => <Badge tone={e.severity === 'error' ? 'danger' : e.severity === 'warning' ? 'warning' : 'neutral'}>{e.severity}</Badge> },
              { key: 'result', header: 'Result', render: (e) => <Badge tone={e.success ? 'neutral' : 'danger'}>{e.success ? 'ok' : 'failed'}</Badge> },
            ]}
          />
        )}
      </section>

      <p className="ctf-sec__note">
        What this does not do: it does not test each role against each RLS policy live (see <code>supabase/tests/</code> for that), and it
        cannot see IP addresses or devices (audit logs don't record them). External checks are strictly read-only.
      </p>
    </div>
  )
}

function FindingRow({ finding: f, source }: { finding: Finding; source?: string }) {
  const Icon = ICON[f.status]
  return (
    <li className={`ctf-find ctf-find--${f.status}`}>
      <Icon size={17} aria-label={LABEL[f.status]} />
      <div className="ctf-find__body">
        <strong>{f.title}</strong>
        <p>{f.detail}</p>
        {f.fix && (
          <div className="ctf-find__fix">
            <span>How to fix</span>
            <pre className="mono">{f.fix}</pre>
          </div>
        )}
      </div>
      <div className="ctf-find__side">
        {source && <small>{source}</small>}
        {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.title} (new tab)`}><ExternalLink size={13} /></a>}
      </div>
    </li>
  )
}

function SectionCard({ section: s }: { section: Section }) {
  const Icon = s.icon
  const { counts } = scoreFindings(s.findings)
  const state = !s.configured ? 'off' : counts.fail ? 'fail' : counts.warn ? 'warn' : 'ok'
  return (
    <section className={`ctf-sec__card ctf-sec__card--${state}`} aria-label={s.label}>
      <header>
        <span className="ctf-sec__card-icon"><Icon size={17} /></span>
        <h3>{s.label}</h3>
        <span className="ctf-sec__pill">{!s.configured ? 'Not connected' : s.loading && s.findings.length === 0 ? 'Checking…' : s.error && s.findings.length === 0 ? 'Unavailable' : counts.fail ? `${counts.fail} to fix` : counts.warn ? `${counts.warn} to review` : 'All clear'}</span>
      </header>
      {s.loading && s.findings.length === 0 ? <SkeletonRows rows={2} height="40px" />
        : s.error && s.findings.length === 0 ? <p className="ctf-sec__empty">{s.error}</p>
        : !s.configured ? (
          <div className="ctf-sec__setup">
            <p>Connect {s.label} to include it in this report. This is read-only, and the secret stays on the server.</p>
            {s.setup && <><pre className="mono">{s.setup}</pre><CopyButton value={s.setup} label="Copy commands" /></>}
          </div>
        ) : <ul className="ctf-sec__list">{s.findings.map((f) => <FindingRow key={f.id} finding={f} />)}</ul>}
    </section>
  )
}
