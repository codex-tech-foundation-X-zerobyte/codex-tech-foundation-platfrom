import { useMemo, useState } from 'react'
import { Inbox } from 'lucide-react'
import { EmptyState, ErrorState, SearchInput, SectionHeading, Select, SkeletonRows, StatusBadge, Table, Tabs, useToast } from '../../components/ui'
import { BulkBar, BulkDelete } from '../../components/BulkActions'
import { DeleteButton } from '../../components/DeleteButton'
import { deleteLead, listAllLeads, updateLeadStatus, updateLeadStatusMany } from '../../lib/services'
import { timeAgo } from '../../lib/format'
import type { Lead, LeadStatus } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useSelection } from '../../hooks/useSelection'
import { LeadDetail } from './LeadDetail'

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'closed']
const FILTERS = [{ id: 'all', label: 'All' }, ...STATUSES.map((s) => ({ id: s, label: s }))]

export function AdminLeads() {
  const { data: leads, error, loading, reload } = useAsyncData('once', listAllLeads)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const { push } = useToast()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (leads ?? []).filter((l) =>
      (filter === 'all' || l.status === filter)
      && (!q || [l.name, l.email, l.company, l.message].some((v) => (v ?? '').toLowerCase().includes(q))))
  }, [leads, filter, query])

  const sel = useSelection(filtered, (l) => l.id ?? l.email)

  const changeStatus = async (lead: Lead, status: LeadStatus) => {
    if (!lead.id) return
    const { error: err } = await updateLeadStatus(lead.id, status)
    push(err ? 'Could not update status.' : 'Status updated', err ? 'error' : 'success')
    reload()
  }
  const bulkStatus = async (status: LeadStatus) => {
    const { updated, error: err } = await updateLeadStatusMany(sel.ids, status)
    push(err ? 'Could not update those leads.' : `${updated} lead${updated === 1 ? '' : 's'} marked ${status}.`, err ? 'error' : 'success')
    sel.clear()
    reload()
  }

  // The open lead and its neighbours, within whatever is currently filtered, so Next/Previous walk the visible list.
  const openIndex = openId ? filtered.findIndex((l) => l.id === openId) : -1
  const open = openIndex >= 0 ? filtered[openIndex] : null

  if (error) return <ErrorState onRetry={reload} />
  const newCount = (leads ?? []).filter((l) => l.status === 'new').length

  return (
    <div>
      <SectionHeading eyebrow="CRM" title="Leads" description={newCount > 0 ? `${newCount} new — click a lead to read it in full.` : 'Click a lead to read it in full.'} />
      <div className="ctf-filter-row">
        <Tabs tabs={FILTERS} active={filter} onChange={setFilter} />
      </div>
      <div className="ctf-filter-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, email, company or message" aria-label="Search leads" />
      </div>
      {loading && <SkeletonRows rows={5} />}
      {!loading && (
        <>
          <Table
            rows={filtered}
            rowKey={(l) => l.id ?? l.email}
            selection={{ selected: sel.selected, onChange: sel.onChange, label: (l) => l.name }}
            onRowClick={(l) => l.id && setOpenId(l.id)}
            emptyState={<EmptyState icon={Inbox} title={query || filter !== 'all' ? 'No leads match' : 'No leads yet'} description={query || filter !== 'all' ? 'Try a different search or filter.' : 'Leads submitted through the public site will appear here.'} />}
            columns={[
              { key: 'name', header: 'Name', render: (l) => <strong>{l.name}</strong> },
              { key: 'email', header: 'Email', render: (l) => l.email },
              { key: 'company', header: 'Company', render: (l) => l.company || '—' },
              { key: 'source', header: 'Source', render: (l) => l.source || '—' },
              { key: 'received', header: 'Received', render: (l) => <span title={l.created_at ? new Date(l.created_at).toLocaleString() : undefined}>{timeAgo(l.created_at)}</span> },
              { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status ?? 'new'} /> },
              {
                key: 'actions',
                header: 'Update',
                render: (l) => (
                  <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                    <Select value={l.status ?? 'new'} onChange={(e) => void changeStatus(l, e.target.value as LeadStatus)} aria-label={`Change status for ${l.name}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                    {l.id && (
                      <DeleteButton what="lead" name={l.name} label="" onDelete={() => deleteLead(l.id as string)} undo={{ table: 'leads', id: l.id }} onDeleted={reload}>
                        <p>If this is spam, that is exactly what you want.</p>
                      </DeleteButton>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <BulkBar count={sel.count} onClear={sel.clear}>
            <Select value="" onChange={(e) => e.target.value && void bulkStatus(e.target.value as LeadStatus)} aria-label="Mark selected leads as">
              <option value="">Mark as…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <BulkDelete table="leads" ids={sel.ids} what="lead" onDone={() => { sel.clear(); reload() }}>
              <p>If these are spam, that is exactly what you want.</p>
            </BulkDelete>
          </BulkBar>
        </>
      )}

      {open && (
        <LeadDetail
          key={open.id}
          lead={open}
          position={{ index: openIndex, total: filtered.length }}
          onPrev={openIndex > 0 ? () => setOpenId(filtered[openIndex - 1].id ?? null) : null}
          onNext={openIndex < filtered.length - 1 ? () => setOpenId(filtered[openIndex + 1].id ?? null) : null}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
