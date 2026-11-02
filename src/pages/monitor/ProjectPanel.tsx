import { useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { getOccurrences, getSeries, getTopErrors, openIncident, type IncidentRow, type MonitorProject, type SeriesPoint } from '../../lib/services'
import { HEALTH_LABEL, HEALTH_TONE, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, STATUS_LABEL, STATUS_TONE, barHeights, fillHours, heartbeatLabel, p95Label, type Severity } from '../../lib/monitorRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { timeAgo } from '../../lib/format'

const ZERO: Omit<SeriesPoint, 'bucket'> = { events: 0, errors: 0, fatals: 0, heartbeats: 0, avg_ms: null, p95_ms: null, max_ms: null }

/** Errors per hour for the last 24 hours. A quiet hour is a visible gap, not a missing bar. */
function HourlyChart({ points }: { points: SeriesPoint[] }) {
  const hours = useMemo(() => fillHours(points, 24, ZERO), [points])
  const values = hours.map((h) => h.errors + h.fatals)
  const heights = barHeights(values)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = Math.max(0, ...values)
  return (
    <div className="ctf-mon-chart" role="img" aria-label={`${total} errors in the last 24 hours${peak ? `, at most ${peak} in a single hour` : ''}`}>
      {hours.map((h, i) => <span key={h.bucket} className={values[i] > 0 ? 'has' : ''} style={{ height: `${Math.max(heights[i], 2)}%` }} title={`${new Date(h.bucket).getHours()}:00 · ${values[i]} errors`} />)}
    </div>
  )
}

function Occurrences({ project, fingerprint }: { project: string; fingerprint: string }) {
  const occ = useAsyncData(`monitor-occ:${project}:${fingerprint}`, () => getOccurrences(project, fingerprint))
  if (occ.loading) return <SkeletonRows rows={2} />
  if (occ.error) return <p className="ctf-mon__sub">Couldn&apos;t load occurrences: {occ.errorDetail?.message}</p>
  return (
    <ul className="ctf-mon-occ">
      {(occ.data ?? []).map((o) => (
        <li key={o.occurred_at + o.message}>
          <div className="ctf-mon__sub">{timeAgo(o.occurred_at)} · {o.environment}{o.release ? ` · ${o.release}` : ''}{o.route ? ` · ${o.route}` : ''}</div>
          <p>{o.message || '(no message)'}</p>
          {o.stack && <pre tabIndex={0} aria-label="Stack trace">{o.stack}</pre>}
        </li>
      ))}
    </ul>
  )
}

function OpenIncidentForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const r = await openIncident(projectId, title.trim(), severity, note.trim())
    setBusy(false)
    if (r.error) { push(r.error.message, 'error'); return }
    push('Incident opened.', 'success'); onDone()
  }
  return (
    <form className="ctf-inc__form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="What is wrong?" htmlFor="oi-title" required><Input id="oi-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus /></FieldWrap>
      <FieldWrap label="Severity" htmlFor="oi-sev"><Select id="oi-sev" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}</Select></FieldWrap>
      <FieldWrap label="First note" htmlFor="oi-note" hint="Do not paste secrets or customer details."><Textarea id="oi-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></FieldWrap>
      <div className="ctf-inc__row"><Button type="submit" variant="primary" disabled={busy || title.trim().length < 3}>Open incident</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  )
}

/** One project: how it is doing, what is failing, and its open incidents. */
export function ProjectPanel({ project: p, incidents, onOpenIncident, onChanged }: { project: MonitorProject; incidents: IncidentRow[]; onOpenIncident: (id: string) => void; onChanged: () => void }) {
  const series = useAsyncData(`monitor-series:${p.id}`, () => getSeries(p.id, 24))
  const top = useAsyncData(`monitor-top:${p.id}`, () => getTopErrors(p.id))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const beat = heartbeatLabel(p.last_heartbeat_at, p.heartbeat_seconds)
  const mine = incidents.filter((i) => i.project_id === p.id)
  return (
    <div className="ctf-mon-project">
      <div className="ctf-inc__badges">
        <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>
        <Badge tone={beat.tone}>Heartbeat: {beat.text}</Badge>
        {p.owner_department && <Badge>{p.owner_department}</Badge>}
        {p.sdk_version && <Badge>SDK {p.sdk_version}</Badge>}
        {p.release && <Badge>Release {p.release}</Badge>}
      </div>
      <h3 className="ctf-inc__h">Errors per hour, last 24 hours</h3>
      {series.loading ? <SkeletonRows rows={1} /> : series.error ? <ErrorState title="The chart couldn't load" description={series.errorDetail?.message ?? 'Try again.'} onRetry={series.reload} /> : <HourlyChart points={series.data ?? []} />}
      <p className="ctf-mon__sub">{p.events_24h.toLocaleString()} events · {p.errors_24h.toLocaleString()} errors · the slowest 5% of requests took {p95Label(p.p95_ms_24h)}</p>

      <div className="ctf-mon-project__head"><h3 className="ctf-inc__h">Incidents</h3><Button size="sm" variant="secondary" onClick={() => setOpening((v) => !v)}>{opening ? 'Close form' : 'Open an incident'}</Button></div>
      {opening && <OpenIncidentForm projectId={p.id} onDone={() => { setOpening(false); onChanged() }} />}
      {mine.length === 0 ? <p className="ctf-mon__sub">No incidents{opening ? '' : ' for this project right now'}.</p> : (
        <ul className="ctf-mon-list">
          {mine.map((i) => <li key={i.id}><button type="button" onClick={() => onOpenIncident(i.id)}><span><strong>{i.ref}</strong> {i.title}</span><span className="ctf-inc__badges"><Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge><Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge></span></button></li>)}
        </ul>
      )}

      <h3 className="ctf-inc__h">Most recent errors</h3>
      {top.loading ? <SkeletonRows rows={3} /> : top.error ? <ErrorState title="Errors couldn't load" description={top.errorDetail?.message ?? 'Try again.'} onRetry={top.reload} /> : (top.data ?? []).length === 0 ? <EmptyState title="No errors recorded" description="When this project reports an error, it appears here, grouped with the same error." /> : (
        <ul className="ctf-mon-list">
          {(top.data ?? []).map((e) => (
            <li key={e.fingerprint}>
              <button type="button" aria-expanded={expanded === e.fingerprint} onClick={() => setExpanded(expanded === e.fingerprint ? null : e.fingerprint)}>
                <span><strong>{e.message || '(no message)'}</strong><span className="ctf-mon__sub"> {e.occurrences.toLocaleString()}× · last {timeAgo(e.last_seen)}{e.release ? ` · ${e.release}` : ''}</span></span>
                {e.incident_ref && <Badge tone="warning">{e.incident_ref}</Badge>}
              </button>
              {expanded === e.fingerprint && <Occurrences project={p.id} fingerprint={e.fingerprint} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
