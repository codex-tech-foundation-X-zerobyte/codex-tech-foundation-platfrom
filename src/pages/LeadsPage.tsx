import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Modal, Select, SkeletonRows, Table, Textarea, useToast } from '../components/ui'
import { assignLead, listLeads, updateLeadNotes, updateLeadStatus } from '../lib/services/leads'
import { getProfilesByIds, listWorkers } from '../lib/services'
import type { Lead, LeadStatus } from '../lib/types'
import type { WorkerRow } from '../lib/services/workers'

const STATUS_TONE: Record<LeadStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  new: 'neutral',
  contacted: 'warning',
  qualified: 'warning',
  converted: 'success',
  closed: 'danger',
}
const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'closed']

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null)
  const [detail, setDetail] = useState<Lead | null>(null)
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listLeads().then(async ({ data, error: err }) => {
      if (err) { setError(true); return }
      setLeads(data)
      const assignedIds = data.map((l) => l.assigned_to).filter((x): x is string => !!x)
      const { data: nameMap } = await getProfilesByIds(assignedIds)
      setNames(nameMap)
    })
  }
  useEffect(load, [])
  useEffect(() => { void listWorkers().then((r) => setWorkers(r.data)) }, [])

  const changeStatus = async (lead: Lead, status: LeadStatus) => {
    setLeads((prev) => prev?.map((l) => (l.id === lead.id ? { ...l, status } : l)) ?? prev)
    const { error: err } = await updateLeadStatus(lead.id!, status)
    if (err) { push('Could not update status.', 'error'); load(); return }
    push('Status updated.')
  }

  const filtered = statusFilter ? leads?.filter((l) => l.status === statusFilter) : leads

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 200 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
      {leads === null && <SkeletonRows rows={4} />}
      {leads !== null && (
        <Table
          rows={filtered ?? []}
          rowKey={(l) => l.id!}
          onRowClick={(l) => setDetail(l)}
          emptyState={<EmptyState icon={Inbox} title="No leads yet" description="Enquiries submitted through the public site's contact and start-project forms will appear here." />}
          columns={[
            { key: 'name', header: 'Name', render: (l) => <strong>{l.name}</strong> },
            { key: 'email', header: 'Email', render: (l) => l.email },
            { key: 'company', header: 'Company', render: (l) => l.company || '—' },
            { key: 'source', header: 'Source', render: (l) => l.source || 'website' },
            { key: 'assigned', header: 'Assigned to', render: (l) => (l.assigned_to && names.get(l.assigned_to)) || '—' },
            {
              key: 'status',
              header: 'Status',
              render: (l) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Select value={l.status} onChange={(e) => void changeStatus(l, e.target.value as LeadStatus)} aria-label={`Status for ${l.name}`}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </div>
              ),
            },
            { key: 'badge', header: '', render: (l) => <Badge tone={STATUS_TONE[l.status ?? 'new']}>{l.status}</Badge> },
          ]}
        />
      )}

      <LeadDetailModal lead={detail} workers={workers} onClose={() => setDetail(null)} onSaved={load} />
    </div>
  )
}

function LeadDetailModal({
  lead,
  workers,
  onClose,
  onSaved,
}: {
  lead: Lead | null
  workers: WorkerRow[] | null
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lead) return
    setNotes(lead.notes ?? '')
    setAssignedTo(lead.assigned_to ?? '')
  }, [lead])

  const save = async () => {
    if (!lead?.id) return
    setSaving(true)
    const [{ error: notesError }, { error: assignError }] = await Promise.all([
      updateLeadNotes(lead.id, notes),
      assignLead(lead.id, assignedTo || null),
    ])
    setSaving(false)
    if (notesError || assignError) { push('Could not save changes.', 'error'); return }
    push('Saved.')
    onSaved()
    onClose()
  }

  return (
    <Modal
      open={lead !== null}
      onClose={onClose}
      title={lead?.name ?? 'Lead'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      {lead && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary, #999)' }}>
            <div>{lead.email}</div>
            {lead.company && <div>{lead.company}</div>}
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>Message</strong>
            <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{lead.message || '—'}</p>
          </div>
          {workers && workers.length > 0 && (
            <FieldWrap label="Assign to" htmlFor="lead-assignee">
              <Select id="lead-assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Unassigned</option>
                {workers.map((w) => (
                  <option key={w.user_id} value={w.user_id}>{w.display_name}</option>
                ))}
              </Select>
            </FieldWrap>
          )}
          <FieldWrap label="Notes" htmlFor="lead-notes">
            <Textarea id="lead-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes about this lead…" />
          </FieldWrap>
        </div>
      )}
    </Modal>
  )
}
