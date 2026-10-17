import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowUpRight, Cable, MessagesSquare, ShieldAlert, Users } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Modal, Select, SkeletonRows, Surface, Textarea, useToast } from '../components/ui'
import {
  listDepartmentChannels, listDepartmentMembers, listDepartmentSummaries, loadDepartmentStats, loadIntegrationState, raiseSuspensionCase, resolveMetric, setDepartmentAdmin,
  setWorkerDepartment, type DepartmentMember, type DepartmentRow,
} from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  INTEGRATIONS, boardOf, integrationStatus, toolOf, toolStatus, toolTarget,
  type CardDef, type DepartmentDef, type IntegrationId, type IntegrationState, type SectionDef, type ToolDef,
} from './definitions'
import { Assignments, TaskBoard, type Viewer } from './DepartmentWork'
import { OnboardingCard } from './OnboardingCard'
import type { StatsData } from './records'
import './DepartmentEnvironment.css'

interface Props {
  def: DepartmentDef
  /** The seeded database row. Null means the migration that provisions departments hasn't been applied. */
  row: DepartmentRow | null
  base: '/worker' | '/admin'
  /** Main Admin only: move workers and assign Department Admins. */
  canManage?: boolean
  /** The viewer is this department's admin. */
  viewerIsDepartmentAdmin?: boolean
  /** The signed-in user, so a worker's own tasks can be highlighted and moved. */
  viewerId?: string
}

const STATUS_COPY = { not_connected: 'Not connected', needs_authorization: 'Needs authorization', connected: 'Connected', error: 'Error' } as const

/**
 * One department's environment, rendered entirely from its definition. Every department goes through this component, but what
 * it shows (sections, boards, tools, cards, metrics, onboarding) comes from data, so each looks and works like its own
 * environment. Numbers come from real rows; an unconnected integration says so; nothing is sample data.
 */
export function DepartmentEnvironment({ def, row, base, canManage = false, viewerIsDepartmentAdmin = false, viewerId }: Props) {
  useDocumentTitle(def.dashboardTitle)
  const viewer: Viewer = { id: viewerId, isMainAdmin: canManage, isDepartmentAdmin: viewerIsDepartmentAdmin }
  const [params, setParams] = useSearchParams()
  const sections = def.sections
  const active = sections.find((s) => s.id === params.get('section')) ?? sections[0]
  const Icon = def.icon
  const integrations = useAsyncData('integration-state', loadIntegrationState)
  const state = integrations.data ?? {}

  return (
    <div className="ctf-denv" style={{ ['--dept-accent' as string]: def.accent }}>
      <header className="ctf-denv__head">
        <span className="ctf-denv__icon" aria-hidden="true"><Icon size={22} /></span>
        <div className="ctf-denv__titles">
          <span className="ctf-denv__eyebrow">{def.dashboardTitle === def.name ? 'Department' : def.name}</span>
          <h2>{def.dashboardTitle}</h2>
          <p>{def.tagline}</p>
        </div>
        {viewerIsDepartmentAdmin && <Badge tone="accent">Department Admin</Badge>}
      </header>

      {!row && (
        <Surface variant="warning" className="ctf-denv__warn" role="alert">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>This department hasn&apos;t been provisioned in the database yet. Apply the latest migration (<code>20260926000000_preprovisioned_departments</code>) to assign workers to it.</span>
        </Surface>
      )}

      <nav className="ctf-denv__tabs" role="tablist" aria-label={`${def.shortName} sections`}>
        {sections.map((s) => (
          <button key={s.id} type="button" role="tab" id={`tab-${s.id}`} aria-selected={s.id === active.id} aria-controls="denv-panel" className={`ctf-denv__tab ${s.id === active.id ? 'is-active' : ''}`}
            onClick={() => setParams(s.id === sections[0].id ? {} : { section: s.id }, { replace: true })}>
            {s.label}
          </button>
        ))}
      </nav>

      <div id="denv-panel" role="tabpanel" aria-labelledby={`tab-${active.id}`} className="ctf-denv__panel">
        <SectionView def={def} row={row} section={active} base={base} canManage={canManage} viewer={viewer} state={state} />
      </div>
    </div>
  )
}

function SectionView({ def, row, section, base, canManage, viewer, state }: { def: DepartmentDef; row: DepartmentRow | null; section: SectionDef; base: '/worker' | '/admin'; canManage: boolean; viewer: Viewer; state: IntegrationState }) {
  switch (section.kind) {
    case 'overview': return <Overview def={def} row={row} base={base} viewer={viewer} state={state} />
    case 'board': return <Board def={def} row={row} boardId={section.boardId} viewer={viewer} />
    case 'tools': return <Tools def={def} section={section} base={base} state={state} />
    case 'integrations': return <Integrations def={def} base={base} state={state} isMainAdmin={canManage} />
    case 'channels': return <Channels def={def} row={row} base={base} />
    case 'team': return <Team def={def} row={row} canManage={canManage} viewer={viewer} />
  }
}

function Overview({ def, row, base, viewer, state }: { def: DepartmentDef; row: DepartmentRow | null; base: '/worker' | '/admin'; viewer: Viewer; state: IntegrationState }) {
  const stats = useAsyncData(`dept-stats:${row?.id ?? 'none'}`, () => (row ? loadDepartmentStats(def, row.id) : Promise.resolve({ data: null as StatsData | null, error: null })))
  const data = stats.data
  const show = (item: { source?: CardDef['source']; integration?: IntegrationId }) => {
    if (item.integration && integrationStatus(item.integration, state) !== 'connected') return { text: `${INTEGRATIONS[item.integration].name} not connected`, warn: true as const }
    if (item.integration) return { text: 'Connected', warn: false as const }
    if (!item.source) return { text: '', warn: false as const }
    if (stats.loading) return { text: 'Loading…', warn: false as const }
    if (!data) return { text: 'Unavailable', warn: true as const }
    const r = resolveMetric(def, item, data)
    return r?.value == null ? { text: 'No data yet', warn: false as const } : { text: String(r.value), note: r.note, big: true as const, warn: false as const }
  }
  return (
    <div className="ctf-denv__stack">
      {viewer.id && base === '/worker' && row && <OnboardingCard def={def} base={base} userId={viewer.id} />}
      {/* What the Main Admin has asked of this department comes first; the rest is reference. */}
      <Assignments def={def} row={row} viewer={viewer} />
      {stats.error && <ErrorState title="Numbers couldn't load" description={stats.errorDetail?.message ?? 'Try again.'} onRetry={stats.reload} />}
      <div className="ctf-denv__cards">
        {def.cards.map((c) => {
          const v = show(c)
          const tool = c.tool ? toolOf(def, c.tool) : undefined
          const target = tool ? toolTarget(base, def, tool, state) : null
          const body = (
            <>
              <h3>{c.label}</h3>
              <p>{c.description}</p>
              {'big' in v && v.big ? <span className="ctf-denv__value">{v.text}{v.note && <small>{v.note}</small>}</span> : <span className={`ctf-denv__state ${v.warn ? 'is-warn' : ''}`}>{v.text}</span>}
            </>
          )
          return target?.to
            ? <Link key={c.label} className="ctf-denv__card is-link" to={target.to}>{body}<ArrowUpRight size={14} className="ctf-denv__go" aria-hidden="true" /></Link>
            : target?.href ? <a key={c.label} className="ctf-denv__card is-link" href={target.href} target="_blank" rel="noopener noreferrer">{body}<ArrowUpRight size={14} className="ctf-denv__go" aria-hidden="true" /></a>
            : <Surface key={c.label} className="ctf-denv__card">{body}</Surface>
        })}
      </div>

      <Surface>
        <h3 className="ctf-denv__h3">Metrics</h3>
        <dl className="ctf-denv__metrics">
          {def.metrics.map((m) => { const v = show(m); return <div key={m.label}><dt>{m.label}</dt><dd>{v.text}{'note' in v && v.note ? <small> ({v.note})</small> : null}</dd></div> })}
        </dl>
      </Surface>
    </div>
  )
}

function Board({ def, row, boardId, viewer }: { def: DepartmentDef; row: DepartmentRow | null; boardId?: string; viewer: Viewer }) {
  // Not provisioned: show the workflow itself, with nothing in it.
  if (!row) return <StaticBoard def={def} boardId={boardId} />
  return <TaskBoard def={def} row={row} boardId={boardId} viewer={viewer} />
}

function StaticBoard({ def, boardId }: { def: DepartmentDef; boardId?: string }) {
  const board = boardOf(def, boardId)
  if (!board) return <EmptyState title="No board" description="This department has no board configured." />
  return (
    <div className="ctf-denv__stack">
      <div><h3 className="ctf-denv__h3">{board.name}</h3><p className="ctf-denv__muted">{board.description}</p></div>
      <div className="ctf-denv__board" role="list" aria-label={`${board.name} stages`}>
        {board.stages.map((stage, i) => (
          <section key={stage} role="listitem" className="ctf-denv__column"><header><span className="ctf-denv__step">{i + 1}</span><h4>{stage}</h4></header><p>No work in this stage.</p></section>
        ))}
      </div>
    </div>
  )
}

function Tools({ def, section, base, state }: { def: DepartmentDef; section: SectionDef; base: '/worker' | '/admin'; state: IntegrationState }) {
  const tools = def.tools.filter((t) => (section.toolGroup ? t.group === section.toolGroup : !t.group))
  return (
    <div className="ctf-denv__stack">
      {section.notice && <Surface variant="warning" className="ctf-denv__warn" role="note"><ShieldAlert size={16} aria-hidden="true" /><span>{section.notice}</span></Surface>}
      <div className="ctf-denv__tools">
        {tools.map((t) => <ToolCard key={t.id} def={def} tool={t} base={base} state={state} />)}
      </div>
    </div>
  )
}

function ToolCard({ def, tool, base, state }: { def: DepartmentDef; tool: ToolDef; base: '/worker' | '/admin'; state: IntegrationState }) {
  const status = toolStatus(tool, state)
  const target = toolTarget(base, def, tool, state)
  const body = (
    <>
      <div className="ctf-denv__tool-top">
        <h3>{tool.name}</h3>
        {status === 'available' ? <Badge tone="success">Available</Badge> : <Badge tone="warning">{tool.integration ? `${INTEGRATIONS[tool.integration].name} not connected` : 'Not connected'}</Badge>}
      </div>
      <p>{tool.description}</p>
    </>
  )
  if (target?.to) return <Link className="ctf-denv__tool is-link" to={target.to}>{body}<ArrowUpRight size={14} className="ctf-denv__go" aria-hidden="true" /></Link>
  if (target?.href) return <a className="ctf-denv__tool is-link" href={target.href} target="_blank" rel="noopener noreferrer">{body}<ArrowUpRight size={14} className="ctf-denv__go" aria-hidden="true" /></a>
  return <div className="ctf-denv__tool">{body}</div>
}

function Integrations({ def, base, state, isMainAdmin }: { def: DepartmentDef; base: '/worker' | '/admin'; state: IntegrationState; isMainAdmin: boolean }) {
  const ids = Array.from(new Set<IntegrationId>([
    ...def.tools.flatMap((t) => (t.integration ? [t.integration] : [])),
    ...def.cards.flatMap((c) => (c.integration ? [c.integration] : [])),
    ...def.metrics.flatMap((m) => (m.integration ? [m.integration] : [])),
  ]))
  if (ids.length === 0) return <EmptyState icon={Cable} title="No integrations" description={`${def.name} doesn't use external services.`} />
  return (
    <div className="ctf-denv__stack">
      <ul className="ctf-denv__integrations">
        {ids.map((id) => {
          const status = integrationStatus(id, state)
          return (
            <li key={id}>
              <Cable size={16} aria-hidden="true" />
              <div><strong>{INTEGRATIONS[id].name}</strong><span>{INTEGRATIONS[id].purpose}</span></div>
              <Badge tone={status === 'connected' ? 'success' : status === 'error' ? 'danger' : 'warning'}>{STATUS_COPY[status]}</Badge>
            </li>
          )
        })}
      </ul>
      {isMainAdmin ? <p className="ctf-denv__muted">Connect services in the <Link to={`${base}/integrations`}>Integrations hub</Link>.</p> : <p className="ctf-denv__muted">A Main Admin connects these services. Nothing here pretends to be live until they do.</p>}
    </div>
  )
}

function Channels({ def, row, base }: { def: DepartmentDef; row: DepartmentRow | null; base: '/worker' | '/admin' }) {
  const channels = useAsyncData(`dept-channels:${row?.id ?? 'none'}`, () => (row ? listDepartmentChannels(row.id) : Promise.resolve({ data: [], error: null })))
  if (channels.loading) return <SkeletonRows rows={3} />
  if (channels.error) return <ErrorState title="Channels couldn't load" description={channels.errorDetail?.message ?? 'Try again.'} onRetry={channels.reload} />
  const list = channels.data ?? []
  if (list.length === 0) return <EmptyState icon={MessagesSquare} title="No channels yet" description={`${def.name}'s channels are created by the latest database migration, and you join them automatically.`} />
  return (
    <div className="ctf-denv__stack">
      <ul className="ctf-denv__integrations">
        {list.map((c) => {
          const tag = c.name.split('·')[1]?.trim() ?? c.name
          return <li key={c.id}><MessagesSquare size={16} aria-hidden="true" /><div><strong>{tag}</strong><span>{def.channels.find((x) => x.name === tag)?.description ?? 'Department conversation.'}</span></div></li>
        })}
      </ul>
      <p className="ctf-denv__muted">You are added to your department&apos;s channels automatically. <Link to={`${base}/chat`}>Open Chat</Link> to talk.</p>
    </div>
  )
}

function Team({ def, row, canManage, viewer }: { def: DepartmentDef; row: DepartmentRow | null; canManage: boolean; viewer: Viewer }) {
  const members = useAsyncData(`dept-members:${row?.id ?? 'none'}`, () => (row ? listDepartmentMembers(row.id) : Promise.resolve({ data: [] as DepartmentMember[], error: null })))
  const all = useAsyncData(`dept-all:${row?.id ?? 'none'}`, listDepartmentSummaries)
  const { push } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [suspending, setSuspending] = useState<DepartmentMember | null>(null)

  if (members.loading) return <SkeletonRows rows={3} />
  if (members.error) return <ErrorState title="The team couldn't load" description={members.errorDetail?.message ?? 'Try again.'} onRetry={members.reload} />
  const list = members.data ?? []
  if (list.length === 0) return <EmptyState icon={Users} title={`No one in ${def.name} yet`} description="Assign workers to this department when you create them, or move them in from the Workers page." />

  const refresh = () => { members.reload(); all.reload() }
  const move = async (m: DepartmentMember, target: string) => {
    setBusy(m.user_id)
    const { error } = await setWorkerDepartment(m.user_id, target || null)
    setBusy(null)
    if (error) push(error.message, 'error'); else { push(`${m.display_name} moved.`); refresh() }
  }
  const toggleAdmin = async (m: DepartmentMember) => {
    setBusy(m.user_id)
    const makeAdmin = m.department_role !== 'admin'
    const { error } = await setDepartmentAdmin(m.user_id, makeAdmin)
    setBusy(null)
    if (error) push(error.message, 'error'); else { push(makeAdmin ? `${m.display_name} is now a Department Admin.` : `${m.display_name} is no longer a Department Admin.`); refresh() }
  }
  const maySuspend = (m: DepartmentMember) => (viewer.isDepartmentAdmin || viewer.isMainAdmin) && m.user_id !== viewer.id && (viewer.isMainAdmin || m.department_role !== 'admin') && (m.status === 'active' || m.status === 'invited')

  return (
    <>
      <ul className="ctf-denv__members">
        {list.map((m) => (
          <li key={m.user_id}>
            <div className="ctf-denv__who"><strong>{m.display_name}</strong><span>{m.position || 'No position set'}</span></div>
            {m.department_role === 'admin' && <Badge tone="accent">Department Admin</Badge>}
            {m.status !== 'active' && <Badge tone={m.status === 'invited' ? 'neutral' : m.status === 'suspension_pending' ? 'warning' : 'danger'}>{m.status.replace(/_/g, ' ')}</Badge>}
            {maySuspend(m) && <button type="button" className="ctf-denv__link" onClick={() => setSuspending(m)}>{viewer.isMainAdmin ? 'Start suspension review' : 'Request suspension'}</button>}
            {canManage && (
              <div className="ctf-denv__manage">
                <button type="button" className="ctf-denv__link" disabled={busy === m.user_id} onClick={() => void toggleAdmin(m)}>{m.department_role === 'admin' ? 'Remove admin' : 'Make Department Admin'}</button>
                <Select aria-label={`Department for ${m.display_name}`} value={row?.id ?? ''} disabled={busy === m.user_id} onChange={(e) => void move(m, e.target.value)}>
                  <option value="">No department</option>
                  {(all.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!suspending} onClose={() => setSuspending(null)} title={suspending ? `${viewer.isMainAdmin ? 'Start a suspension review for' : 'Request suspension of'} ${suspending.display_name}` : ''} description="A Main Admin reviews every case. Nothing is deleted, and the whole history is kept." size="md">
        {suspending && <SuspensionForm member={suspending} onCancel={() => setSuspending(null)} onSent={() => { setSuspending(null); refresh() }} />}
      </Modal>
    </>
  )
}

function SuspensionForm({ member, onCancel, onSent }: { member: DepartmentMember; onCancel: () => void; onSent: () => void }) {
  const { push } = useToast()
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await raiseSuspensionCase(member.user_id, reason, evidence)
    setSaving(false)
    if (err) { setError(err.message); return }
    push('Sent for review.'); onSent()
  }
  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Reason" htmlFor="sc-reason" required><Textarea id="sc-reason" autoFocus rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened, in a sentence" /></FieldWrap>
      <FieldWrap label="Evidence and notes" htmlFor="sc-evidence" hint="Dates, examples, anything the reviewer needs"><Textarea id="sc-evidence" rows={4} maxLength={3000} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></FieldWrap>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={reason.trim().length < 3}>Send for review</Button></div>
    </form>
  )
}
