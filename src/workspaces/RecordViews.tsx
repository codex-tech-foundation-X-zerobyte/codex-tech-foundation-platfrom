import { useMemo, useState, type FormEvent } from 'react'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Textarea, useToast } from '../components/ui'
import { createRecord, deleteRecord, listDepartmentMembers, listRecords, updateRecord, type DepartmentRecord, type DepartmentRow } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { isClosed, type DepartmentDef, type FieldDef, type RecordKindDef } from './definitions'
import { canEditRecord, cleanFields, expiryLabel, matchesWhere, recordProblem, toFormValues, visibleFields, type FieldValues } from './records'
import type { Viewer } from './DepartmentWork'

const when = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null)


/** A department's records of one kind: list, filter by stage, file new ones, edit, move through the workflow. */
export function RecordsPage({ row, kind, preset, viewer, heading, intro }: { def?: DepartmentDef; row: DepartmentRow; kind: RecordKindDef; preset?: Record<string, string>; viewer: Viewer; heading: string; intro?: string }) {
  const list = useAsyncData(`records:${row.id}:${kind.kind}`, () => listRecords(row.id, kind.kind))
  const [stage, setStage] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [editing, setEditing] = useState<DepartmentRecord | 'new' | null>(null)
  const { push } = useToast()

  const all = (list.data ?? []).filter((r) => matchesWhere(r, preset))
  const shown = all.filter((r) => (stage ? r.stage === stage : showClosed || !isClosed(kind, r.stage)))
  const move = async (r: DepartmentRecord, to: string) => {
    const { error } = await updateRecord(r.id, { stage: to })
    if (error) push(error.message, 'error'); else list.reload()
  }
  const hiddenClosed = all.length - all.filter((r) => !isClosed(kind, r.stage)).length

  if (list.loading) return <SkeletonRows rows={4} height="64px" />
  if (list.error) return <ErrorState title={`${kind.plural} couldn't load`} description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} />

  return (
    <div className="ctf-denv__stack">
      <div className="ctf-denv__board-head">
        <div><h3 className="ctf-denv__h3">{heading}</h3>{intro && <p className="ctf-denv__muted">{intro}</p>}</div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New {kind.label.toLowerCase()}</Button>
      </div>

      {all.length > 0 && (
        <div className="ctf-rec__filters">
          <Select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{showClosed ? 'Every stage' : 'Open items'}</option>
            {kind.stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          {!stage && hiddenClosed > 0 && <label className="ctf-form-check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /><span>Show {hiddenClosed} finished</span></label>}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title={all.length === 0 ? `No ${kind.plural.toLowerCase()} yet` : 'Nothing matches'} description={all.length === 0 ? `Create the first ${kind.label.toLowerCase()} for this department.` : 'Try another stage, or show finished items.'} action={all.length === 0 ? <Button size="sm" variant="primary" onClick={() => setEditing('new')}>New {kind.label.toLowerCase()}</Button> : undefined} />
      ) : (
        <ul className="ctf-rec__list">
          {shown.map((r) => <RecordRow key={r.id} kind={kind} record={r} canEdit={canEditRecord(r, viewer)} onOpen={() => setEditing(r)} onMove={(to) => void move(r, to)} />)}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' || editing === null ? `New ${kind.label.toLowerCase()}` : editing.title} size="lg">
        {editing && <RecordForm key={editing === 'new' ? 'new' : editing.id} row={row} kind={kind} record={editing === 'new' ? null : editing} preset={preset} viewer={viewer} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload() }} />}
      </Modal>
    </div>
  )
}

function RecordRow({ kind, record, canEdit, onOpen, onMove }: { kind: RecordKindDef; record: DepartmentRecord; canEdit: boolean; onOpen: () => void; onMove: (stage: string) => void }) {
  const f = record.fields as Record<string, unknown>
  const expiries = kind.calendar?.map((c) => ({ label: c.label, info: expiryLabel(typeof f[c.field] === 'string' ? (f[c.field] as string) : undefined) })).filter((x) => x.info && kind.kind === 'domain') ?? []
  const summary = kind.fields.filter((x) => x.type !== 'textarea' && f[x.key] != null && f[x.key] !== '').slice(0, 3).map((x) => `${x.label}: ${f[x.key]}`)
  return (
    <li className="ctf-rec__row">
      <button type="button" className="ctf-rec__main" onClick={onOpen}>
        <strong>{record.title}</strong>
        <span className="ctf-denv__muted">{summary.join(' · ') || kind.label}</span>
        <span className="ctf-rec__meta">
          {record.assignee_name && <span>{record.assignee_name}</span>}
          {record.due_date && <span>Due {when(record.due_date)}</span>}
          {expiries.map((e) => <Badge key={e.label} tone={e.info!.tone}>{e.label}: {e.info!.text.toLowerCase()}</Badge>)}
        </span>
      </button>
      {canEdit ? (
        <Select aria-label={`Stage of ${record.title}`} value={record.stage} onChange={(e) => onMove(e.target.value)}>
          {kind.stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      ) : <Badge tone="neutral">{record.stage}</Badge>}
    </li>
  )
}

export function RecordForm({ row, kind, record, preset, viewer, onCancel, onSaved }: { row: DepartmentRow; kind: RecordKindDef; record: DepartmentRecord | null; preset?: Record<string, string>; viewer: Viewer; onCancel: () => void; onSaved: () => void }) {
  const members = useAsyncData(`record-members:${row.id}`, () => listDepartmentMembers(row.id))
  const { push } = useToast()
  const [title, setTitle] = useState(record?.title ?? '')
  const [stage, setStage] = useState(record?.stage ?? kind.stages[0])
  const [assignee, setAssignee] = useState(record?.assignee_id ?? '')
  const [due, setDue] = useState(record?.due_date ?? '')
  const [values, setValues] = useState<FieldValues>(() => ({ ...(preset ?? {}), ...toFormValues(record?.fields ?? {}) }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const fields = useMemo(() => visibleFields(kind, values), [kind, values])
  const editable = !record || canEditRecord(record, viewer)
  const set = (key: string, v: string) => { setValues((p) => ({ ...p, [key]: v })); setError('') }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving || !editable) return
    const problem = recordProblem(kind, title, values)
    if (problem) { setError(problem); return }
    setSaving(true)
    const payload = { title: title.trim(), stage, fields: cleanFields(kind, values), assignee_id: kind.assignable ? assignee || null : null, due_date: kind.due ? due || null : null }
    const { error: err } = record ? await updateRecord(record.id, payload) : await createRecord({ department_id: row.id, kind: kind.kind, ...payload })
    setSaving(false)
    if (err) { setError(err.message); return }
    push(record ? 'Saved.' : `${kind.label} created.`)
    onSaved()
  }
  const remove = async () => {
    if (!record) return
    const { error: err } = await deleteRecord(record.id)
    if (err) { push(err.message, 'error'); return }
    push('Deleted.'); onSaved()
  }

  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Title" htmlFor="rec-title" required><Input id="rec-title" autoFocus maxLength={200} value={title} disabled={!editable} onChange={(e) => { setTitle(e.target.value); setError('') }} autoComplete="off" /></FieldWrap>
      <div className="ctf-form-row">
        <FieldWrap label="Stage" htmlFor="rec-stage"><Select id="rec-stage" value={stage} disabled={!editable} onChange={(e) => setStage(e.target.value)}>{kind.stages.map((s) => <option key={s} value={s}>{s}</option>)}</Select></FieldWrap>
        {kind.assignable && (
          <FieldWrap label="Assigned to" htmlFor="rec-assignee">
            <Select id="rec-assignee" value={assignee} disabled={!editable} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {(members.data ?? []).filter((m) => m.status === 'active' || m.user_id === record?.assignee_id).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </Select>
          </FieldWrap>
        )}
      </div>
      {kind.due && <FieldWrap label="Due date" htmlFor="rec-due" hint="Optional"><Input id="rec-due" type="date" value={due} disabled={!editable} onChange={(e) => setDue(e.target.value)} /></FieldWrap>}
      {fields.map((f) => <DynamicField key={f.key} field={f} value={values[f.key] ?? ''} disabled={!editable} onChange={(v) => set(f.key, v)} />)}
      {record && <p className="ctf-denv__muted">Filed {new Date(record.created_at).toLocaleDateString()}{record.assignee_name ? ` · assigned to ${record.assignee_name}` : ''}</p>}
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        {record && (viewer.isMainAdmin || viewer.isDepartmentAdmin) && (confirmDelete
          ? <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => void remove()}>Confirm delete</Button>
          : <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>Delete</Button>)}
        <Button variant="ghost" onClick={onCancel}>{editable ? 'Cancel' : 'Close'}</Button>
        {editable && <Button type="submit" variant="primary" loading={saving}>{record ? 'Save' : 'Create'}</Button>}
      </div>
    </form>
  )
}

function DynamicField({ field, value, disabled, onChange }: { field: FieldDef; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const id = `rec-f-${field.key}`
  return (
    <FieldWrap label={field.label} htmlFor={id} required={field.required} hint={field.hint}>
      {field.type === 'textarea' ? <Textarea id={id} rows={3} maxLength={5000} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        : field.type === 'select' ? (
          <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            <option value="">{field.required ? 'Select…' : 'Not set'}</option>
            {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : <Input id={id} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} value={value} disabled={disabled} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />}
    </FieldWrap>
  )
}
