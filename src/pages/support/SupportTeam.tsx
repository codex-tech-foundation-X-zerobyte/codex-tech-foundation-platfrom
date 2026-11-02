import { useState, type FormEvent } from 'react'
import { CalendarClock, Users } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Table, useToast } from '../../components/ui'
import { addShift, deleteShift, getRoster, getWorkload, type ShiftRow, type WorkloadPerson } from '../../lib/services'
import { localToIso, minutesLabel, shiftLabel } from '../../lib/supportRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import './SupportTeam.css'

function ShiftForm({ people, onDone }: { people: WorkloadPerson[]; onDone: () => void }) {
  const { push } = useToast()
  const [who, setWho] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const r = await addShift(who, localToIso(start), localToIso(end), note.trim())
    setBusy(false)
    if (r.error) { push(r.error.message, 'error'); return }
    push('Shift added.', 'success'); setStart(''); setEnd(''); setNote(''); onDone()
  }
  const invalid = !who || !start || !end || new Date(end) <= new Date(start)
  return (
    <form className="ctf-team__form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Who" htmlFor="sh-who"><Select id="sh-who" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose a person…</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</Select></FieldWrap>
      <FieldWrap label="Starts" htmlFor="sh-start"><Input id="sh-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FieldWrap>
      <FieldWrap label="Ends" htmlFor="sh-end" hint="At most 24 hours after it starts."><Input id="sh-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FieldWrap>
      <FieldWrap label="Note (optional)" htmlFor="sh-note"><Input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></FieldWrap>
      <div className="ctf-team__submit"><Button type="submit" variant="primary" loading={busy} disabled={invalid}>Add shift</Button></div>
    </form>
  )
}

/** For Customer Service leads: who is carrying what, and who is on shift. The roster is a roster only: nothing is assigned or paid from it. */
export function SupportTeam() {
  const load = useAsyncData('support-workload', getWorkload)
  const roster = useAsyncData('support-roster', getRoster)
  const { push } = useToast()
  const w = load.data
  const shifts: ShiftRow[] = roster.data ?? []
  return (
    <div className="ctf-team">
      <h2><Users size={16} aria-hidden /> Workload</h2>
      {load.loading ? <SkeletonRows rows={3} /> : load.error || !w ? <ErrorState title="Workload couldn't load" description={load.errorDetail?.message ?? 'Try again.'} onRetry={load.reload} /> : (
        <>
          <p className="ctf-team__note">{w.unassigned === 0 ? 'Every open ticket has someone on it.' : <><strong>{w.unassigned}</strong> ticket{w.unassigned === 1 ? ' has' : 's have'} nobody assigned.</>} Averages cover the last 7 days (replies) and 30 days (ratings).</p>
          <Table caption="Workload by person" rows={w.people} rowKey={(p) => p.user_id} emptyState={<EmptyState icon={Users} title="No team members yet" description="People in the Customer Service department appear here." />}
            columns={[
              { key: 'n', header: 'Person', render: (p: WorkloadPerson) => <><strong>{p.name}</strong>{p.on_shift && <> <Badge tone="success">On shift</Badge></>}</> },
              { key: 'o', header: 'Open', render: (p: WorkloadPerson) => p.open },
              { key: 'l', header: 'Late for a first reply', render: (p: WorkloadPerson) => (p.overdue ? <Badge tone="danger">{p.overdue}</Badge> : '0') },
              { key: 'w', header: 'Waiting on customer', render: (p: WorkloadPerson) => p.waiting_for_customer },
              { key: 'r', header: 'Resolved, 7 days', render: (p: WorkloadPerson) => p.resolved_7d },
              { key: 'f', header: 'First reply, average', render: (p: WorkloadPerson) => minutesLabel(p.avg_first_response_minutes_7d) },
              { key: 'q', header: 'Rating, 30 days', render: (p: WorkloadPerson) => (p.avg_rating_30d === null ? '—' : `${p.avg_rating_30d} / 5`) },
            ]} />
        </>
      )}
      <h2><CalendarClock size={16} aria-hidden /> Shifts</h2>
      {!load.loading && w && <ShiftForm people={w.people} onDone={() => { roster.reload(); load.reload() }} />}
      {roster.loading ? <SkeletonRows rows={2} /> : roster.error ? <ErrorState title="The roster couldn't load" description={roster.errorDetail?.message ?? 'Try again.'} onRetry={roster.reload} /> : (
        <Table caption="Shifts, next 8 days" rows={shifts} rowKey={(s) => s.id} emptyState={<EmptyState icon={CalendarClock} title="No shifts set" description="Add a shift above. People see the roster; nothing is assigned automatically." />}
          columns={[
            { key: 'n', header: 'Person', render: (s: ShiftRow) => <>{s.name}{s.on_now && <> <Badge tone="success">Now</Badge></>}</> },
            { key: 'w', header: 'When', render: (s: ShiftRow) => shiftLabel(s.starts_at, s.ends_at) },
            { key: 'c', header: 'Note', render: (s: ShiftRow) => s.note ?? '' },
            { key: 'a', header: '', render: (s: ShiftRow) => <Button size="sm" variant="ghost" onClick={() => void deleteShift(s.id).then((r) => { if (r.error) push(r.error.message, 'error'); else roster.reload() })}>Remove</Button> },
          ]} />
      )}
    </div>
  )
}
