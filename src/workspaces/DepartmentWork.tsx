import { useState, type FormEvent } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Surface, Textarea, useToast } from '../components/ui'
import {
  ASSIGNMENT_STATUS_LABEL, createDepartmentTask, listDepartmentAssignments, listDepartmentMembers, listDepartmentTasks,
  listRecords, moveTaskToStage, setAssignmentStatus, updateRecord, type AssignmentStatus, type DepartmentRecord, type DepartmentRow, type DepartmentTask, type ProjectAssignment,
} from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { boardOf, recordKindOf, type DepartmentDef } from './definitions'
import { RecordForm } from './RecordViews'
import { canEditRecord } from './records'
import { TaskDrawer } from './TaskDrawer'

export interface Viewer { id: string | undefined; isMainAdmin: boolean; isDepartmentAdmin: boolean }

const when = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null)
const STATUS_TONE: Record<AssignmentStatus, 'warning' | 'accent' | 'neutral' | 'danger' | 'success'> = {
  assigned: 'warning', accepted: 'accent', in_review: 'neutral', changes_requested: 'danger', completed: 'success',
}

/** Projects the Main Admin has assigned to this department, with the actions each role may take. */
export function Assignments({ def, row, viewer }: { def: DepartmentDef; row: DepartmentRow | null; viewer: Viewer }) {
  const list = useAsyncData(`assignments:${row?.id ?? 'none'}`, () => (row ? listDepartmentAssignments(row.id) : Promise.resolve({ data: [] as ProjectAssignment[], error: null })))
  const { push } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  if (list.loading) return <SkeletonRows rows={2} height="72px" />
  if (list.error) return <ErrorState title="Assignments couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} />
  const items = list.data ?? []
  if (items.length === 0) return <EmptyState icon={ClipboardList} title="No project assignments yet" description={`When a project is assigned to ${def.name}, the work arrives here for the Department Admin to break into tasks.`} />

  const move = async (a: ProjectAssignment, status: AssignmentStatus, done: string) => {
    setBusy(a.id)
    const { error } = await setAssignmentStatus(a.id, status)
    setBusy(null)
    if (error) push(error.message, 'error'); else { push(done); list.reload() }
  }
  const mayAct = viewer.isDepartmentAdmin || viewer.isMainAdmin

  return (
    <div className="ctf-denv__stack">
      <h3 className="ctf-denv__h3">Project assignments</h3>
      <ul className="ctf-denv__assignments">
        {items.map((a) => (
          <li key={a.id}>
            <Surface>
              <div className="ctf-denv__asg-top">
                <div>
                  <strong>{a.project_name}</strong>
                  {a.deadline && <span className="ctf-denv__muted"> · due {when(a.deadline)}</span>}
                </div>
                <Badge tone={STATUS_TONE[a.status]}>{ASSIGNMENT_STATUS_LABEL[a.status]}</Badge>
              </div>
              {a.objective && <p className="ctf-denv__objective">{a.objective}</p>}
              {a.deliverables.length > 0 && <ul className="ctf-denv__chips" aria-label="Deliverables">{a.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>}
              {mayAct && (
                <div className="ctf-denv__asg-actions">
                  {a.status === 'assigned' && <Button size="sm" variant="primary" loading={busy === a.id} onClick={() => void move(a, 'accepted', 'Assignment accepted.')}>Accept</Button>}
                  {viewer.isDepartmentAdmin && (a.status === 'accepted' || a.status === 'changes_requested') && <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => void move(a, 'in_review', 'Submitted for review.')}>Submit for review</Button>}
                  {viewer.isMainAdmin && a.status === 'in_review' && (
                    <>
                      <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => void move(a, 'changes_requested', 'Changes requested.')}>Request changes</Button>
                      <Button size="sm" variant="primary" loading={busy === a.id} onClick={() => void move(a, 'completed', 'Marked completed.')}>Mark completed</Button>
                    </>
                  )}
                </div>
              )}
            </Surface>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The department's workflow board, backed by real tasks and (for some departments) the records that ARE the work. */
export function TaskBoard({ def, row, boardId, viewer }: { def: DepartmentDef; row: DepartmentRow; boardId?: string; viewer: Viewer }) {
  // No board named => the department's primary board, where its tasks live.
  const board = boardId ? boardOf(def, boardId) : def.boards[0]
  const tasks = useAsyncData(`dtasks:${row.id}`, () => listDepartmentTasks(row.id))
  const recordKind = board?.recordKind ? recordKindOf(def, board.recordKind) : undefined
  const records = useAsyncData(`board-records:${row.id}:${recordKind?.kind ?? 'none'}`, () => (recordKind ? listRecords(row.id, recordKind.kind) : Promise.resolve({ data: [] as DepartmentRecord[], error: null })))
  const { push } = useToast()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [editing, setEditing] = useState<DepartmentRecord | 'new' | null>(null)
  if (!board) return <EmptyState title="No board" description="This department has no board configured." />
  // Tasks live on the department's primary board; a second board (e.g. a lab) holds tools, not tasks.
  const holdsTasks = def.boards[0]?.id === board.id

  const list = holdsTasks ? tasks.data ?? [] : []
  const recs = records.data ?? []
  const stageOf = (t: { stage: string | null }) => (t.stage && board.stages.includes(t.stage) ? t.stage : board.stages[0])
  const mayMove = (t: DepartmentTask) => viewer.isMainAdmin || viewer.isDepartmentAdmin || (!!viewer.id && t.assignee_id === viewer.id)
  const move = async (t: DepartmentTask, stage: string) => {
    setBusy(t.id)
    const { error } = await moveTaskToStage(t.id, board.stages, stage)
    setBusy(null)
    if (error) push(error.message, 'error'); else tasks.reload()
  }
  const moveRecord = async (r: DepartmentRecord, stage: string) => {
    setBusy(r.id)
    const { error } = await updateRecord(r.id, { stage })
    setBusy(null)
    if (error) push(error.message, 'error'); else records.reload()
  }
  const open = list.find((t) => t.id === openTask) ?? null
  const loading = (holdsTasks && tasks.loading) || records.loading
  const failed = (holdsTasks && tasks.error) || records.error
  const empty = list.length === 0 && recs.length === 0

  return (
    <div className="ctf-denv__stack">
      <div className="ctf-denv__board-head">
        <div>
          <h3 className="ctf-denv__h3">{board.name}</h3>
          <p className="ctf-denv__muted">{board.description}</p>
        </div>
        <div className="ctf-denv__asg-actions">
          {recordKind && <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New {recordKind.label.toLowerCase()}</Button>}
          {holdsTasks && (viewer.isDepartmentAdmin || viewer.isMainAdmin) && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New task</Button>}
        </div>
      </div>

      {failed ? <ErrorState title="The board couldn't load" description={(tasks.errorDetail ?? records.errorDetail)?.message ?? 'Try again.'} onRetry={() => { tasks.reload(); records.reload() }} /> : loading ? <SkeletonRows rows={2} height="96px" /> : (
        <div className="ctf-denv__board" role="list" aria-label={`${board.name} stages`}>
          {board.stages.map((stage, i) => {
            const here = list.filter((t) => stageOf(t) === stage)
            const hereRecs = recs.filter((r) => stageOf(r) === stage)
            const count = here.length + hereRecs.length
            return (
              <section key={stage} role="listitem" className="ctf-denv__column">
                <header><span className="ctf-denv__step">{i + 1}</span><h4>{stage}</h4>{count > 0 && <span className="ctf-denv__count">{count}</span>}</header>
                {count === 0 ? <p>No work in this stage.</p> : (
                  <ul className="ctf-denv__tasks">
                    {here.map((t) => (
                      <li key={t.id} className={`ctf-denv__task ${viewer.id && t.assignee_id === viewer.id ? 'is-mine' : ''}`}>
                        <button type="button" className="ctf-denv__task-open" onClick={() => setOpenTask(t.id)}><strong>{t.title}</strong></button>
                        <span className="ctf-denv__muted">{t.project_name}</span>
                        <div className="ctf-denv__task-meta">
                          <span>{t.assignee_id === viewer.id ? 'You' : t.assignee_name ?? 'Unassigned'}</span>
                          {t.due_date && <span>Due {when(t.due_date)}</span>}
                          {(t.priority === 'high' || t.priority === 'urgent') && <Badge tone="danger">{t.priority}</Badge>}
                          {t.review_state === 'requested' && <Badge tone="warning">In review</Badge>}
                          {t.review_state === 'changes_requested' && <Badge tone="danger">Changes</Badge>}
                          {t.review_state === 'approved' && <Badge tone="success">Approved</Badge>}
                        </div>
                        {mayMove(t) && (
                          <Select aria-label={`Move ${t.title}`} value={stage} disabled={busy === t.id} onChange={(e) => void move(t, e.target.value)}>
                            {board.stages.map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        )}
                      </li>
                    ))}
                    {hereRecs.map((r) => (
                      <li key={r.id} className={`ctf-denv__task is-record ${viewer.id && r.assignee_id === viewer.id ? 'is-mine' : ''}`}>
                        <button type="button" className="ctf-denv__task-open" onClick={() => setEditing(r)}><strong>{r.title}</strong></button>
                        <span className="ctf-denv__muted">{recordKind?.label}{typeof r.fields.type === 'string' ? ` · ${r.fields.type}` : typeof r.fields.asset_type === 'string' ? ` · ${r.fields.asset_type}` : ''}</span>
                        <div className="ctf-denv__task-meta"><span>{r.assignee_id === viewer.id ? 'You' : r.assignee_name ?? 'Unassigned'}</span>{r.due_date && <span>Due {when(r.due_date)}</span>}</div>
                        {canEditRecord(r, viewer) && (
                          <Select aria-label={`Move ${r.title}`} value={stage} disabled={busy === r.id} onChange={(e) => void moveRecord(r, e.target.value)}>
                            {board.stages.map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
      {empty && !loading && !failed && (
        <p className="ctf-denv__muted">{recordKind ? `Add a ${recordKind.label.toLowerCase()} to start the board, or wait for a project assignment to be broken into tasks.` : `Work reaches this board when a project is assigned to ${def.name} and its Department Admin breaks it into tasks.`}</p>
      )}
      {holdsTasks && <NewTaskModal open={creating} def={def} row={row} firstStage={board.stages[0]} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); tasks.reload() }} />}
      <Modal open={!!open} onClose={() => setOpenTask(null)} title={open?.title ?? 'Task'} size="lg">
        {open && <TaskDrawer task={open} stages={board.stages} siblings={list} viewer={viewer} onChanged={() => tasks.reload()} />}
      </Modal>
      {recordKind && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' || !editing ? `New ${recordKind.label.toLowerCase()}` : editing.title} size="lg">
          {editing && <RecordForm key={editing === 'new' ? 'new' : editing.id} row={row} kind={recordKind} record={editing === 'new' ? null : editing} viewer={viewer} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); records.reload() }} />}
        </Modal>
      )}
    </div>
  )
}

function NewTaskModal({ open, def, row, firstStage, onClose, onCreated }: { open: boolean; def: DepartmentDef; row: DepartmentRow; firstStage: string; onClose: () => void; onCreated: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New task" description={`A task for ${def.name}.`}>
      {open && <NewTaskForm row={row} firstStage={firstStage} onCancel={onClose} onCreated={onCreated} />}
    </Modal>
  )
}

function NewTaskForm({ row, firstStage, onCancel, onCreated }: { row: DepartmentRow; firstStage: string; onCancel: () => void; onCreated: () => void }) {
  const assignments = useAsyncData(`new-task-asg:${row.id}`, () => listDepartmentAssignments(row.id))
  const members = useAsyncData(`new-task-members:${row.id}`, () => listDepartmentMembers(row.id))
  const { push } = useToast()
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [due, setDue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Only accepted assignments can be broken into tasks (the database enforces it too).
  const open = (assignments.data ?? []).filter((a) => a.status !== 'assigned' && a.status !== 'completed')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await createDepartmentTask({ project_id: projectId, department_id: row.id, title, description, priority, due_date: due || null, assignee_id: assignee || null, stage: firstStage })
    setSaving(false)
    if (err) { setError(err.message); return }
    push('Task created.')
    onCreated()
  }

  if (assignments.loading || members.loading) return <SkeletonRows rows={3} />
  if (open.length === 0) return <EmptyState icon={ClipboardList} title="Accept an assignment first" description="Tasks are created from an assignment you've accepted." />

  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Project" htmlFor="nt-project" required>
        <Select id="nt-project" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="" disabled>Select a project</option>
          {open.map((a) => <option key={a.project_id} value={a.project_id}>{a.project_name}</option>)}
        </Select>
      </FieldWrap>
      <FieldWrap label="Title" htmlFor="nt-title" required><Input id="nt-title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" /></FieldWrap>
      <FieldWrap label="Description" htmlFor="nt-desc"><Textarea id="nt-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></FieldWrap>
      <div className="ctf-form-row">
        <FieldWrap label="Assign to" htmlFor="nt-assignee">
          <Select id="nt-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {(members.data ?? []).filter((m) => m.status === 'active').map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </Select>
        </FieldWrap>
        <FieldWrap label="Priority" htmlFor="nt-priority">
          <Select id="nt-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </Select>
        </FieldWrap>
      </div>
      <FieldWrap label="Due date" htmlFor="nt-due" hint="Optional"><Input id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FieldWrap>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!projectId || !title.trim()}>Create task</Button>
      </div>
    </form>
  )
}
