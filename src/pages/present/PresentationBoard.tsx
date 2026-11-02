import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Presentation as PresentationIcon, Radio, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, PageHeader, Select, SkeletonRows, useToast } from '../../components/ui'
import {
  deletePresentation, getMyDepartments, listDepartmentSummaries, listPresentations, startPresentation, subscribeToPresentationList,
  type PresentationListItem, type PresentationVisibility,
} from '../../lib/services'
import { STAGES, isStale, stagesFor, type StageKind } from '../../lib/presentation'
import { timeAgo } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { presentBase } from './paths'
import { STAGE_ICON } from './stageRegistry'
import './Present.css'

/** Everyone presenting right now that you may watch, a button to start your own, and recent presentations. */
export function PresentationBoard() {
  useDocumentTitle('Presentation board')
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = presentBase(pathname)
  const { push } = useToast()
  const [data, setData] = useState<{ live: PresentationListItem[]; recent: PresentationListItem[] } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error: e } = await listPresentations()
    if (e) setError(e); else { setError(null); setData(d) }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load()
    const unsub = subscribeToPresentationList(() => void load())
    const t = setInterval(() => void load(), 30_000)
    return () => { unsub(); clearInterval(t) }
  }, [load])

  const remove = async (s: PresentationListItem) => {
    const { error: e } = await deletePresentation(s.id)
    if (e) push(e.message, 'error'); else { push('Deleted.'); void load() }
  }

  return (
    <div className="ctf-present">
      <PageHeader title="Presentation board" description="Present your work live to your department or the whole company, on a stage that fits what you do." actions={<Button variant="primary" icon={<Radio size={15} />} onClick={() => setStarting(true)}>Start presenting</Button>} />
      {error ? <ErrorState title="The board couldn't load" description={error.message} onRetry={() => void load()} /> : !data ? <SkeletonRows rows={3} height="84px" /> : (
        <>
          <section aria-labelledby="live-h">
            <h2 id="live-h" className="ctf-present__h">Live now</h2>
            {data.live.length === 0
              ? <EmptyState icon={PresentationIcon} title="Nobody is presenting right now" description="Start a presentation and your department gets a notification to join. Presenters use a browser, console, dashboard, cinema or slides stage." action={<Button variant="primary" onClick={() => setStarting(true)}>Start presenting</Button>} />
              : <ul className="ctf-present__grid">{data.live.map((s) => <SessionCard key={s.id} s={s} to={`${base}/${s.id}`} mine={s.presenter_id === profile?.id} />)}</ul>}
          </section>
          {data.recent.length > 0 && (
            <section aria-labelledby="recent-h">
              <h2 id="recent-h" className="ctf-present__h">Recently ended</h2>
              <ul className="ctf-present__grid ctf-present__grid--quiet">{data.recent.map((s) => <SessionCard key={s.id} s={s} to={`${base}/${s.id}`} mine={s.presenter_id === profile?.id} onDelete={s.presenter_id === profile?.id || profile?.role === 'superadmin' ? () => void remove(s) : undefined} />)}</ul>
            </section>
          )}
        </>
      )}
      <Modal open={starting} onClose={() => setStarting(false)} title="Start presenting" description="Pick who it is for and what you will show. You can change what is on stage at any time.">
        {starting && <StartForm onCancel={() => setStarting(false)} onStarted={(id) => { setStarting(false); navigate(`${base}/${id}`) }} />}
      </Modal>
    </div>
  )
}

function SessionCard({ s, to, mine, onDelete }: { s: PresentationListItem; to: string; mine: boolean; onDelete?: () => void }) {
  const Icon = STAGE_ICON[s.kind]
  const live = s.status === 'live'
  const paused = live && isStale(s.updated_at)
  return (
    <li className={`ctf-pcard ${live ? 'is-live' : ''}`}>
      <Link to={to} className="ctf-pcard__link">
        <span className="ctf-pcard__icon"><Icon size={20} aria-hidden="true" /></span>
        <span className="ctf-pcard__body">
          <strong>{s.title}</strong>
          <span>{mine ? 'You' : s.presenter_name} · {s.visibility === 'company' ? 'Whole company' : s.department_name ?? 'Department'} · {STAGES[s.kind].label}</span>
          <small>{live ? `Started ${timeAgo(s.started_at)}` : `Ended ${timeAgo(s.ended_at)}`}</small>
        </span>
        {live ? (paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="danger">● Live</Badge>) : <Badge tone="neutral">Ended</Badge>}
      </Link>
      {onDelete && <button type="button" className="ctf-pcard__delete" onClick={onDelete} aria-label={`Delete ${s.title}`}><Trash2 size={15} /></button>}
    </li>
  )
}

function StartForm({ onCancel, onStarted }: { onCancel: () => void; onStarted: (id: string) => void }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const isMainAdmin = profile?.role === 'superadmin'
  const mine = useAsyncData(`present-depts:${profile?.id}`, async () => {
    if (!profile) return { data: [] as { id: string; name: string; slug: string | null }[], error: null }
    if (isMainAdmin) { const r = await listDepartmentSummaries(); return { data: r.data.departments.map((d) => ({ id: d.id, name: d.name, slug: d.slug })), error: r.error } }
    const r = await getMyDepartments(profile.id)
    return { data: r.data.map((m) => ({ id: m.department.id, name: m.department.name, slug: m.department.slug })), error: r.error }
  })
  const depts = useMemo(() => mine.data ?? [], [mine.data])
  const [title, setTitle] = useState('')
  const [deptId, setDeptId] = useState<string | undefined>(undefined)
  const [visibility, setVisibility] = useState<PresentationVisibility>('department')
  const [kind, setKind] = useState<StageKind | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen = deptId ?? depts[0]?.id ?? ''                       // default to the first department until they choose
  const dept = depts.find((d) => d.id === chosen) ?? null
  const noDept = depts.length === 0
  const effVisibility: PresentationVisibility = noDept ? 'company' : visibility
  const options = stagesFor(dept?.slug)
  const effKind = kind ?? options[0]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const { data, error } = await startPresentation({ department_id: noDept ? null : chosen, title, kind: effKind, visibility: effVisibility })
    setBusy(false)
    if (error || !data) { push(error?.message ?? 'Could not start.', 'error'); return }
    onStarted(data.id)
  }

  return (
    <form className="ctf-pstart" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Title" htmlFor="ps-title" required hint="What people will see in the list.">
        <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Checkout redesign walkthrough" autoFocus />
      </FieldWrap>
      {!noDept && (
        <div className="ctf-pstart__row">
          <FieldWrap label="Department" htmlFor="ps-dept">
            <Select id="ps-dept" value={chosen} onChange={(e) => { setDeptId(e.target.value); setKind(null) }}>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </FieldWrap>
          <FieldWrap label="Who can watch" htmlFor="ps-vis">
            <Select id="ps-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as PresentationVisibility)}>
              <option value="department">{dept?.name ?? 'My department'} only</option>
              <option value="company">The whole company</option>
            </Select>
          </FieldWrap>
        </div>
      )}
      {noDept && !mine.loading && <p className="ctf-pstart__note">You are not in a department yet, so this will be visible to the whole company.</p>}
      <fieldset className="ctf-pstart__stages">
        <legend>Stage</legend>
        {options.map((k, i) => {
          const Icon = STAGE_ICON[k]
          return (
            <label key={k} className={effKind === k ? 'is-on' : ''}>
              <input type="radio" name="stage" checked={effKind === k} onChange={() => setKind(k)} />
              <Icon size={18} aria-hidden="true" />
              <span><strong>{STAGES[k].label}{i === 0 && dept ? <em>Suggested</em> : null}</strong><small>{STAGES[k].blurb}</small></span>
            </label>
          )
        })}
      </fieldset>
      <div className="ctf-pstart__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || mine.loading}>Go live</Button>
      </div>
    </form>
  )
}
