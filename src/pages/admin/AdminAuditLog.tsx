import { ShieldCheck } from 'lucide-react'
import { Badge, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table } from '../../components/ui'
import { listAuditLogs } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'

const SEVERITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral', warning: 'warning', error: 'danger', critical: 'danger',
}

export function AdminAuditLog() {
  const { data: events, error, loading, reload } = useAsyncData('once', () => listAuditLogs(200))

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="Admin" title="Audit log" description="The most recent 200 security-sensitive events, newest first." />
      {loading && <SkeletonRows rows={6} />}
      {!loading && events !== null && (
        <Table
          rows={events}
          rowKey={(e) => e.id}
          emptyState={<EmptyState icon={ShieldCheck} title="No events recorded yet" description="Security-sensitive actions (logins, provisioning, permission changes) will appear here as they happen." />}
          columns={[
            { key: 'when', header: 'When', render: (e) => new Date(e.created_at).toLocaleString() },
            { key: 'action', header: 'Action', render: (e) => <strong>{e.action}</strong> },
            { key: 'resource', header: 'Resource', render: (e) => `${e.resource_type}${e.resource_id ? ` · ${e.resource_id.slice(0, 8)}…` : ''}` },
            { key: 'severity', header: 'Severity', render: (e) => <Badge tone={SEVERITY_TONE[e.severity] ?? 'neutral'}>{e.severity}</Badge> },
            { key: 'success', header: 'Result', render: (e) => <Badge tone={e.success ? 'neutral' : 'danger'}>{e.success ? 'ok' : 'failed'}</Badge> },
          ]}
        />
      )}
    </div>
  )
}
