import { Linkify } from '../../components/Linkify'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Megaphone, Pin, Plus, Trash2, Users } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Surface, Textarea, useToast } from '../../components/ui'
import {
  ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, createAnnouncement, deleteAnnouncement, getMyDepartment, listAnnouncements,
  listOrganization, listUpcomingDeadlines, type Announcement, type OrgDepartment, type Organization,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { departmentBySlug } from '../../workspaces/definitions'
import './CompanyHQ.css'

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const ago = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * The company's front door: who we are, what is being said, what is due, and who sits where. Everything here is read
 * from real records; an empty company shows empty states, not sample content.
 */
export function CompanyHQ({ base }: { base: '/worker' | '/admin' }) {
  useDocumentTitle('Company')
  const org = useAsyncData('org', listOrganization)
  const feed = useAsyncData('announcements', () => listAnnouncements())
  const due = useAsyncData('deadlines', () => listUpcomingDeadlines())
  const { profile } = useAuth()
  const mine = useAsyncData(`hq-mine:${profile?.id}`, () => (profile && profile.role !== 'superadmin' ? getMyDepartment(profile.id) : Promise.resolve({ data: null, error: null })))
  const [composing, setComposing] = useState(false)

  const data = org.data
  const isMainAdmin = profile?.role === 'superadmin'
  const myDept = mine.data?.department ?? null
  const isDeptAdmin = mine.data?.role === 'admin' && !!myDept
  const canPost = isMainAdmin || isDeptAdmin
  const people = data ? data.departments.reduce((n, d) => n + d.admins.length + d.members.length, 0) + data.unassigned.length : 0
  const admins = data ? data.departments.reduce((n, d) => n + d.admins.length, 0) : 0

  return (
    <div className="ctf-hq">
      <section className="ctf-hq__banner" aria-label="Company">
        <div>
          <span className="ctf-hq__eyebrow">Codex Tech Foundation</span>
          <h2>One company, working online</h2>
          <p>Eight departments, shared projects and one place to find everyone and everything.</p>
        </div>
        {data && (
          <dl className="ctf-hq__stats">
            <div><dt>Departments</dt><dd>{data.departments.length}</dd></div>
            <div><dt>People</dt><dd>{people}</dd></div>
            <div><dt>Department Admins</dt><dd>{admins}</dd></div>
          </dl>
        )}
      </section>

      <div className="ctf-hq__cols">
        <section aria-labelledby="hq-news">
          <div className="ctf-hq__head">
            <h3 id="hq-news"><Megaphone size={16} aria-hidden="true" /> Announcements</h3>
            {canPost && <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setComposing(true)}>New announcement</Button>}
          </div>
          <Feed state={feed} viewerId={profile?.id} isMainAdmin={isMainAdmin} org={data} />
        </section>

        <section aria-labelledby="hq-due">
          <div className="ctf-hq__head"><h3 id="hq-due"><CalendarClock size={16} aria-hidden="true" /> Coming up</h3></div>
          {due.loading ? <SkeletonRows rows={3} height="44px" /> : due.error ? <ErrorState title="Deadlines couldn't load" description={due.errorDetail?.message ?? 'Try again.'} onRetry={due.reload} /> : (due.data ?? []).length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing due" description="Project and task deadlines you can see will appear here." />
          ) : (
            <ul className="ctf-hq__due">
              {(due.data ?? []).map((d) => (
                <li key={`${d.kind}:${d.id}`}>
                  <time dateTime={d.date}>{day(d.date)}</time>
                  <div><strong>{d.label}</strong>{d.context && <span>{d.context}</span>}</div>
                  <Badge tone="neutral">{d.kind === 'project' ? 'Project' : 'Task'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="hq-org">
        <div className="ctf-hq__head"><h3 id="hq-org"><Users size={16} aria-hidden="true" /> Organization</h3></div>
        {org.loading ? <SkeletonRows rows={3} height="96px" /> : org.error ? <ErrorState title="The organization couldn't load" description={org.errorDetail?.message ?? 'Try again.'} onRetry={org.reload} /> : data && <OrgChart org={data} base={base} />}
      </section>

      <Modal open={composing} onClose={() => setComposing(false)} title="New announcement" description={isMainAdmin ? 'Tell the whole company or one department.' : `Tell ${myDept?.name ?? 'your department'}.`}>
        {composing && data && <Composer org={data} isMainAdmin={isMainAdmin} ownDepartmentId={myDept?.id ?? null} onCancel={() => setComposing(false)} onPosted={() => { setComposing(false); feed.reload() }} />}
      </Modal>
    </div>
  )
}

interface AsyncState<T> { data: T | null; loading: boolean; error: boolean; errorDetail: Error | null; reload: () => void }

function Feed({ state, viewerId, isMainAdmin, org }: { state: AsyncState<Announcement[]>; viewerId?: string; isMainAdmin: boolean; org?: Organization | null }) {
  const { push } = useToast()
  if (state.loading) return <SkeletonRows rows={3} height="72px" />
  if (state.error) return <ErrorState title="Announcements couldn't load" description={state.errorDetail?.message ?? 'Try again.'} onRetry={state.reload} />
  const items = state.data ?? []
  if (items.length === 0) return <EmptyState icon={Megaphone} title="No announcements yet" description="Company and department news will appear here." />
  const deptName = (id: string | null) => (id ? org?.departments.find((d) => d.row.id === id)?.row.name ?? 'Department' : 'Company')
  const remove = async (a: Announcement) => {
    const { error } = await deleteAnnouncement(a.id)
    if (error) push(error.message, 'error'); else { push('Announcement removed.'); state.reload() }
  }
  return (
    <ul className="ctf-hq__feed">
      {items.map((a) => (
        <li key={a.id}>
          <Surface>
            <div className="ctf-hq__post-top">
              <div className="ctf-hq__post-tags">
                {a.pinned && <span className="ctf-hq__pin"><Pin size={12} aria-hidden="true" /> Pinned</span>}
                <Badge tone={a.department_id ? 'accent' : 'neutral'}>{deptName(a.department_id)}</Badge>
              </div>
              {(isMainAdmin || a.author_id === viewerId) && <button type="button" className="ctf-hq__icon-btn" aria-label={`Remove ${a.title}`} onClick={() => void remove(a)}><Trash2 size={14} /></button>}
            </div>
            <h4>{a.title}</h4>
            {a.body && <p><Linkify text={a.body} /></p>}
            <span className="ctf-hq__byline">{a.author_name} · {ago(a.created_at)}</span>
          </Surface>
        </li>
      ))}
    </ul>
  )
}

function Composer({ org, isMainAdmin, ownDepartmentId, onCancel, onPosted }: { org: Organization; isMainAdmin: boolean; ownDepartmentId: string | null; onCancel: () => void; onPosted: () => void }) {
  const { push } = useToast()
  const [audience, setAudience] = useState(isMainAdmin ? '' : ownDepartmentId ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await createAnnouncement({ title, body, departmentId: audience || null, pinned: isMainAdmin && pinned })
    setSaving(false)
    if (err) { setError(err.message); return }
    push('Announcement posted.')
    onPosted()
  }
  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Audience" htmlFor="an-audience">
        <Select id="an-audience" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={!isMainAdmin}>
          {isMainAdmin && <option value="">Whole company</option>}
          {org.departments.filter((d) => isMainAdmin || d.row.id === ownDepartmentId).map((d) => <option key={d.row.id} value={d.row.id}>{d.row.name}</option>)}
        </Select>
      </FieldWrap>
      <FieldWrap label="Title" htmlFor="an-title" required><Input id="an-title" required autoFocus maxLength={ANNOUNCEMENT_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" /></FieldWrap>
      <FieldWrap label="Message" htmlFor="an-body"><Textarea id="an-body" rows={4} maxLength={ANNOUNCEMENT_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} /></FieldWrap>
      {isMainAdmin && <label className="ctf-form-check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /><span>Pin to the top</span></label>}
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>Post</Button>
      </div>
    </form>
  )
}

function OrgChart({ org, base }: { org: Organization; base: '/worker' | '/admin' }) {
  return (
    <div className="ctf-org">
      <div className="ctf-org__top">
        <span className="ctf-org__role">Main Admin</span>
        <strong>{org.leaders.length ? org.leaders.map((l) => l.name).join(', ') : 'Not assigned'}</strong>
      </div>
      <div className="ctf-org__stem" aria-hidden="true" />
      <ul className="ctf-org__depts" aria-label="Departments">
        {org.departments.filter((d) => d.row.slug).map((d) => <DeptNode key={d.row.id} dept={d} base={base} />)}
      </ul>
      {org.unassigned.length > 0 && (
        <Surface variant="warning" className="ctf-org__unassigned">
          {org.unassigned.length} {org.unassigned.length === 1 ? 'person has' : 'people have'} no department yet: {org.unassigned.map((p) => p.name).join(', ')}.
        </Surface>
      )}
    </div>
  )
}

function DeptNode({ dept, base }: { dept: OrgDepartment; base: '/worker' | '/admin' }) {
  const def = departmentBySlug(dept.row.slug)
  const Icon = def?.icon
  const total = dept.admins.length + dept.members.length
  return (
    <li className="ctf-org__node" style={{ ['--dept-accent' as string]: def?.accent ?? '#4a63ff' }}>
      <div className="ctf-org__node-head">
        {Icon && <span className="ctf-org__icon" aria-hidden="true"><Icon size={16} /></span>}
        {base === '/admin' && def ? <Link to={`/admin/departments/${def.slug}`}>{dept.row.name}</Link> : <strong>{dept.row.name}</strong>}
      </div>
      <p className="ctf-org__admin">
        {dept.admins.length > 0 ? <><span>Department Admin</span>{dept.admins.map((a) => a.name).join(', ')}</> : <span className="ctf-org__none">No Department Admin yet</span>}
      </p>
      <details>
        <summary>{total} {total === 1 ? 'person' : 'people'}</summary>
        {total === 0 ? <p className="ctf-org__none">No one here yet.</p> : (
          <ul>
            {[...dept.admins, ...dept.members].map((m) => <li key={m.id}><span>{m.name}</span><small>{m.position || 'No position set'}{m.status !== 'active' ? ` · ${m.status}` : ''}</small></li>)}
          </ul>
        )}
      </details>
    </li>
  )
}
