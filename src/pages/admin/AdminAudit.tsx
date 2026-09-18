import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Badge, EmptyState, Select, Table } from '../../components/ui'
import { listAuditLogs } from '../../lib/services'
import type { AuditLogEntry } from '../../lib/types'

const SEVERITY_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
}

export function AdminAudit() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null)
  const [severity, setSeverity] = useState('')

  useEffect(() => {
    setEntries(null)
    void listAuditLogs({ severity: severity || undefined }).then((r) => setEntries(r.data))
  }, [severity])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity" style={{ maxWidth: 200 }}>
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </Select>
      </div>
      <Table
        loading={entries === null}
        rows={entries ?? []}
        rowKey={(e) => e.id}
        emptyState={
          <EmptyState
            icon={ShieldCheck}
            title="No recorded events"
            description="Security-sensitive actions (account creation, role changes, suspensions) will appear here as they happen."
          />
        }
        columns={[
          { key: 'when', header: 'When', render: (e) => new Date(e.created_at).toLocaleString() },
          { key: 'action', header: 'Action', render: (e) => <code>{e.action}</code> },
          { key: 'resource', header: 'Resource', render: (e) => `${e.resource_type}${e.resource_id ? ` · ${e.resource_id.slice(0, 8)}…` : ''}` },
          { key: 'severity', header: 'Severity', render: (e) => <Badge tone={SEVERITY_TONE[e.severity] ?? 'neutral'}>{e.severity}</Badge> },
          { key: 'result', header: 'Result', render: (e) => <Badge tone={e.success ? 'success' : 'danger'}>{e.success ? 'success' : 'failed'}</Badge> },
        ]}
      />
    </div>
  )
}
