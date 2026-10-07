import { useMemo, useState } from 'react'
import { Inbox } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, Select, SkeletonRows, StatusBadge, Table, Tabs, useToast } from '../../components/ui'
import { listAllLeads, updateLeadStatus } from '../../lib/services'
import type { Lead, LeadStatus } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'closed']
const FILTERS = [{ id: 'all', label: 'All' }, ...STATUSES.map((s) => ({ id: s, label: s }))]

export function AdminLeads() {
  const { data: leads, error, loading, reload } = useAsyncData('once', listAllLeads)
  const [filter, setFilter] = useState('all')
  const { push } = useToast()

  const filtered = useMemo(() => (leads ?? []).filter((l) => filter === 'all' || l.status === filter), [leads, filter])

  const changeStatus = async (lead: Lead, status: LeadStatus) => {
    if (!lead.id) return
    const { error: err } = await updateLeadStatus(lead.id, status)
    push(err ? 'Could not update status.' : 'Status updated', err ? 'error' : 'success')
    reload()
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="CRM" title="Leads" />
      <div style={{ marginBottom: 20 }}>
        <Tabs tabs={FILTERS} active={filter} onChange={setFilter} />
      </div>
      {loading && <SkeletonRows rows={5} />}
      {!loading && (
        <Table
          rows={filtered}
          rowKey={(l) => l.id ?? l.email}
          emptyState={<EmptyState icon={Inbox} title="No leads yet" description="Leads submitted through the public site will appear here." />}
          columns={[
            { key: 'name', header: 'Name', render: (l) => <strong>{l.name}</strong> },
            { key: 'email', header: 'Email', render: (l) => l.email },
            { key: 'company', header: 'Company', render: (l) => l.company || '—' },
            { key: 'source', header: 'Source', render: (l) => l.source || '—' },
            { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status ?? 'new'} /> },
            {
              key: 'actions',
              header: 'Update',
              render: (l) => (
                <Select
                  value={l.status ?? 'new'}
                  onChange={(e) => void changeStatus(l, e.target.value as LeadStatus)}
                  aria-label={`Change status for ${l.name}`}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
