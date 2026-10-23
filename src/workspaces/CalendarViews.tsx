import { useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Video } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Surface, Textarea, useToast } from '../components/ui'
import {
  addActionItem, createMeeting, deleteMeeting, getMeeting, listCalendarEvents, listDepartmentCalendar, listDepartmentSummaries, listInvitablePeople,
  setActionItemDone, updateMeeting, type DepartmentRow, type MeetingDetail,
} from '../lib/services'
import { groupByDate, isoDate, monthGrid, monthRange, type CalendarEvent, type EventGroup } from '../lib/calendar'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../lib/auth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import './DepartmentEnvironment.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GROUP_LABEL: Record<EventGroup, string> = { meeting: 'Meetings', deadline: 'Project deadlines', task: 'Tasks', work: 'Department work' }
const GROUP_TONE: Record<EventGroup, 'accent' | 'danger' | 'neutral' | 'success'> = { meeting: 'accent', deadline: 'danger', task: 'neutral', work: 'success' }
const longDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

export function CalendarGrid({ year, month, events, selected, onSelect }: { year: number; month: number; events: CalendarEvent[]; selected: string; onSelect: (d: string) => void }) {
  const byDate = useMemo(() => groupByDate(events), [events])
  const today = new Date(); const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate())
  return (
    <div className="ctf-cal" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
      <div className="ctf-cal__head" role="row">{DAYS.map((d) => <span key={d} role="columnheader">{d}</span>)}</div>
      {monthGrid(year, month).map((week, i) => (
        <div key={i} className="ctf-cal__week" role="row">
          {week.map((cell) => {
            const list = byDate.get(cell.date) ?? []
            return (
              <button key={cell.date} type="button" role="gridcell" aria-selected={cell.date === selected} aria-label={`${longDay(cell.date)}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`}
                className={`ctf-cal__day ${cell.inMonth ? '' : 'is-out'} ${cell.date === selected ? 'is-selected' : ''} ${cell.date === todayIso ? 'is-today' : ''}`} onClick={() => onSelect(cell.date)}>
                <span>{Number(cell.date.slice(8))}</span>
                {list.length > 0 && <span className="ctf-cal__dots" aria-hidden="true">{Array.from(new Set(list.map((e) => e.group))).map((g) => <i key={g} className={`is-${g}`} />)}<b>{list.length > 1 ? list.length : ''}</b></span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function useMonth() {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selected, setSelected] = useState(isoDate(now.getFullYear(), now.getMonth(), now.getDate()))
  const step = (d: number) => setYm(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  return { ...ym, selected, setSelected, step, range: monthRange(ym.y, ym.m) }
}

function MonthBar({ y, m, step, onToday }: { y: number; m: number; step: (d: number) => void; onToday: () => void }) {
  return (
    <div className="ctf-cal__bar">
      <Button variant="ghost" size="sm" aria-label="Previous month" icon={<ChevronLeft size={15} />} onClick={() => step(-1)} />
      <h3>{MONTHS[m]} {y}</h3>
      <Button variant="ghost" size="sm" aria-label="Next month" icon={<ChevronRight size={15} />} onClick={() => step(1)} />
      <Button variant="secondary" size="sm" onClick={onToday}>Today</Button>
    </div>
  )
}

function DayList({ date, events, onOpen }: { date: string; events: CalendarEvent[]; onOpen?: (e: CalendarEvent) => void }) {
  const list = groupByDate(events).get(date) ?? []
  return (
    <Surface>
      <h4 className="ctf-denv__h3">{longDay(date)}</h4>
      {list.length === 0 ? <p className="ctf-denv__muted">Nothing scheduled.</p> : (
        <ul className="ctf-cal__list">
          {list.map((e) => (
            <li key={e.id}>
              {e.time && <time>{e.time}</time>}
              <div>{e.group === 'meeting' && onOpen ? <button type="button" className="ctf-cal__link" onClick={() => onOpen(e)}>{e.title}</button> : <strong>{e.title}</strong>}{e.detail && <span>{e.detail}</span>}</div>
              <Badge tone={GROUP_TONE[e.group]}>{GROUP_LABEL[e.group].replace(/s$/, '')}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  )
}

/** The company calendar: meetings, project deadlines, task due dates and department work, as far as the viewer may see them. */
export function CalendarPage() {
  useDocumentTitle('Calendar')
  const { y, m, selected, setSelected, step, range } = useMonth()
  const data = useAsyncData(`calendar:${range.from}`, () => listCalendarEvents(range.from, range.to))
  const [hidden, setHidden] = useState<Set<EventGroup>>(new Set())
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const events = (data.data ?? []).filter((e) => !hidden.has(e.group))
  const toggle = (g: EventGroup) => setHidden((h) => { const n = new Set(h); if (n.has(g)) n.delete(g); else n.add(g); return n })

  return (
    <div className="ctf-denv__stack">
      <div className="ctf-denv__board-head">
        <MonthBar y={y} m={m} step={step} onToday={() => { const t = new Date(); step((t.getFullYear() - y) * 12 + (t.getMonth() - m)); setSelected(isoDate(t.getFullYear(), t.getMonth(), t.getDate())) }} />
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New meeting</Button>
      </div>
      <div className="ctf-cal__filters" role="group" aria-label="Show">
        {(Object.keys(GROUP_LABEL) as EventGroup[]).map((g) => <button key={g} type="button" aria-pressed={!hidden.has(g)} className={!hidden.has(g) ? 'is-on' : ''} onClick={() => toggle(g)}><i className={`is-${g}`} aria-hidden="true" />{GROUP_LABEL[g]}</button>)}
      </div>
      {data.loading ? <SkeletonRows rows={5} height="56px" /> : data.error ? <ErrorState title="The calendar couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <div className="ctf-cal__layout">
          <CalendarGrid year={y} month={m} events={events} selected={selected} onSelect={setSelected} />
          <DayList date={selected} events={events} onOpen={(e) => setOpen(e.id.replace(/^m:/, ''))} />
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New meeting" size="lg">{creating && <MeetingForm defaultDate={selected} onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); data.reload() }} />}</Modal>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Meeting" size="lg">{open && <MeetingView id={open} onClose={() => setOpen(null)} onChanged={data.reload} />}</Modal>
    </div>
  )
}

/** A department's own calendar of dated work: publishing dates, campaigns, expiries, deadlines. */
export function RecordCalendarTool({ row }: { row: DepartmentRow }) {
  const { y, m, selected, setSelected, step, range } = useMonth()
  const data = useAsyncData(`dept-calendar:${row.id}:${range.from}`, () => listDepartmentCalendar(row.id, range.from, range.to))
  if (data.error) return <ErrorState title="The calendar couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} />
  const events = data.data ?? []
  return (
    <div className="ctf-denv__stack">
      <MonthBar y={y} m={m} step={step} onToday={() => { const t = new Date(); step((t.getFullYear() - y) * 12 + (t.getMonth() - m)); setSelected(isoDate(t.getFullYear(), t.getMonth(), t.getDate())) }} />
      {data.loading ? <SkeletonRows rows={5} height="56px" /> : (
        <>
          {events.length === 0 && <EmptyState title="Nothing dated this month" description="Dates you add to this department's records (publish dates, campaign dates, expiries) appear here." />}
          <div className="ctf-cal__layout"><CalendarGrid year={y} month={m} events={events} selected={selected} onSelect={setSelected} /><DayList date={selected} events={events} /></div>
        </>
      )}
    </div>
  )
}

function MeetingForm({ defaultDate, onCancel, onCreated }: { defaultDate: string; onCancel: () => void; onCreated: () => void }) {
  const { profile } = useAuth()
  const people = useAsyncData('invitable', listInvitablePeople)
  const depts = useAsyncData('meeting-depts', listDepartmentSummaries)
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('10:30')
  const [location, setLocation] = useState('')
  const [agenda, setAgenda] = useState('')
  const [dept, setDept] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await createMeeting({ title, starts_at: new Date(`${date}T${from}`).toISOString(), ends_at: new Date(`${date}T${to}`).toISOString(), location: location.trim(), agenda: agenda.trim(), department_id: dept || null, project_id: null, participants: [...chosen].filter((id) => id !== profile?.id) })
    setSaving(false)
    if (err) { setError(err.message); return }
    push('Meeting scheduled.'); onCreated()
  }
  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Title" htmlFor="mt-title" required><Input id="mt-title" autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" /></FieldWrap>
      <div className="ctf-form-row"><FieldWrap label="Date" htmlFor="mt-date" required><Input id="mt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FieldWrap>
        <div className="ctf-form-row"><FieldWrap label="Starts" htmlFor="mt-from"><Input id="mt-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></FieldWrap><FieldWrap label="Ends" htmlFor="mt-to"><Input id="mt-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></FieldWrap></div></div>
      <div className="ctf-form-row">
        <FieldWrap label="Where" htmlFor="mt-loc" hint="A room, or a call link"><Input id="mt-loc" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} autoComplete="off" /></FieldWrap>
        <FieldWrap label="Department" htmlFor="mt-dept" hint="Everyone in it will see the meeting">
          <Select id="mt-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Invited people only</option>{(depts.data?.departments ?? []).filter((d) => d.slug).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </FieldWrap>
      </div>
      <FieldWrap label="Agenda" htmlFor="mt-agenda"><Textarea id="mt-agenda" rows={3} maxLength={5000} value={agenda} onChange={(e) => setAgenda(e.target.value)} /></FieldWrap>
      <fieldset className="ctf-cal__people"><legend>Invite</legend>
        {people.loading ? <SkeletonRows rows={2} /> : <ul>{(people.data ?? []).filter((p) => p.id !== profile?.id).map((p) => <li key={p.id}><label className="ctf-form-check"><input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} /><span>{p.name}</span></label></li>)}</ul>}
      </fieldset>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>Schedule</Button></div>
    </form>
  )
}

function MeetingView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsyncData(`meeting:${id}`, () => getMeeting(id))
  const { profile } = useAuth()
  const { push } = useToast()
  const [notes, setNotes] = useState<string | null>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [action, setAction] = useState('')

  if (detail.loading) return <SkeletonRows rows={4} />
  const m: MeetingDetail | null = detail.data
  if (detail.error || !m) return <ErrorState title="Meeting couldn't load" description={detail.errorDetail?.message ?? 'It may have been removed.'} onRetry={detail.reload} />
  const when = `${new Date(m.starts_at).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${new Date(m.ends_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  const mine = m.created_by === profile?.id || profile?.role === 'superadmin'

  const saveNotes = async () => {
    const { error } = await updateMeeting(id, { notes: notes ?? m.notes, recording_url: (recording ?? m.recording_url).trim() })
    if (error) push(error.message, 'error'); else { push('Saved.'); detail.reload() }
  }
  const addAction = async () => {
    const { error } = await addActionItem(id, action, null, null)
    if (error) push(error.message, 'error'); else { setAction(''); detail.reload() }
  }
  const tick = async (aid: string, done: boolean) => { const { error } = await setActionItemDone(aid, done); if (error) push(error.message, 'error'); else detail.reload() }
  const remove = async () => { const { error } = await deleteMeeting(id); if (error) push(error.message, 'error'); else { onChanged(); onClose() } }

  return (
    <div className="ctf-denv__stack">
      <div><h3 className="ctf-denv__h3">{m.title}</h3><p className="ctf-denv__muted">{when}{m.location ? ` · ${m.location}` : ''}</p></div>
      {m.agenda && <section><h4>Agenda</h4><p className="ctf-cal__pre">{m.agenda}</p></section>}
      <section><h4>Participants ({m.participants.length})</h4>{m.participants.length === 0 ? <p className="ctf-denv__muted">No one invited yet.</p> : <p>{m.participants.map((p) => p.name).join(', ')}</p>}</section>
      <section>
        <h4>Notes</h4>
        <Textarea aria-label="Meeting notes" rows={5} maxLength={20000} disabled={!mine} value={notes ?? m.notes} onChange={(e) => setNotes(e.target.value)} placeholder={mine ? 'What was decided?' : 'No notes yet.'} />
        <FieldWrap label="Recording link" htmlFor="mt-rec" hint="A link to where the recording is kept"><Input id="mt-rec" disabled={!mine} value={recording ?? m.recording_url} onChange={(e) => setRecording(e.target.value)} placeholder="https://…" autoComplete="off" /></FieldWrap>
        {m.recording_url && /^https:\/\//.test(m.recording_url) && <a className="ctf-gh__open" href={m.recording_url} target="_blank" rel="noopener noreferrer"><Video size={12} aria-hidden="true" /> Open recording</a>}
        {mine && <div><Button size="sm" variant="secondary" onClick={() => void saveNotes()}>Save notes</Button></div>}
      </section>
      <section>
        <h4>Action items</h4>
        {m.actions.length === 0 && <p className="ctf-denv__muted">None yet.</p>}
        <ul className="ctf-cal__actions">{m.actions.map((a) => <li key={a.id}><label className="ctf-form-check"><input type="checkbox" checked={a.done} onChange={(e) => void tick(a.id, e.target.checked)} /><span className={a.done ? 'is-done' : ''}>{a.body}{a.assignee_name ? ` — ${a.assignee_name}` : ''}</span></label></li>)}</ul>
        {mine && <div className="ctf-lab__row"><Input aria-label="New action item" value={action} maxLength={500} onChange={(e) => setAction(e.target.value)} placeholder="Add an action item" autoComplete="off" /><Button variant="secondary" disabled={!action.trim()} onClick={() => void addAction()}>Add</Button></div>}
      </section>
      <div className="ctf-form__actions">{mine && <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove()}>Delete meeting</Button>}<Button variant="primary" onClick={onClose}>Close</Button></div>
    </div>
  )
}
