import { ShieldAlert, ShieldCheck, UserX } from 'lucide-react'
import { Badge, ErrorState, SectionHeading, SkeletonRows, Stat, Table } from '../../components/ui'
import { listAuditLogs } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import './AdminSecurity.css'

const SECURITY_ACTIONS = new Set([
  'login.failed', 'worker.status_changed', 'client.status_changed',
  'role.assigned', 'permission.granted', 'permission.revoked',
])

export function AdminSecurity() {
  const { data: events, error, loading, reload } = useAsyncData('once', () => listAuditLogs(200))

  if (error) return <ErrorState onRetry={reload} />

  const securityEvents = (events ?? []).filter((e) => SECURITY_ACTIONS.has(e.action) || e.severity === 'warning' || e.severity === 'error')
  const failedLogins = (events ?? []).filter((e) => e.action === 'login.failed')
  const statusChanges = (events ?? []).filter((e) => e.action === 'worker.status_changed' || e.action === 'client.status_changed')

  return (
    <div>
      <SectionHeading eyebrow="Admin" title="Security overview" description="Derived from real audit_logs entries — nothing on this page is a static claim." />

      {loading && <SkeletonRows rows={4} />}
      {!loading && (
        <>
          <div className="ctf-security-grid">
            <Stat label="Failed logins (recent)" value={failedLogins.length} icon={ShieldAlert} />
            <Stat label="Account status changes" value={statusChanges.length} icon={UserX} />
            <Stat label="Security-relevant events" value={securityEvents.length} icon={ShieldCheck} />
          </div>

          <h2 className="ctf-security-subhead">Recent security events</h2>
          <Table
            rows={securityEvents.slice(0, 50)}
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
        </>
      )}

      <div className="ctf-security-note">
        <p>
          <strong>What this page does not show:</strong> live RLS test results (verifying every policy against
          every role requires exercising them live against a real project — see docs/RBAC.md), and IP/device
          data (not currently captured on audit_logs).
        </p>
      </div>
    </div>
  )
}
