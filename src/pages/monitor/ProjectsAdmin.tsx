import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge, Button, CopyButton, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Table, useToast } from '../../components/ui'
import { createMonitorKey, listDepartmentSummaries, listMonitorKeys, listMonitorProjects, registerMonitorProject, revokeMonitorKey, setMonitorProjectActive, type MonitorKeyRow } from '../../lib/services'
import { KEY_SCOPE_LABEL, ingestSnippet, slugFromName } from '../../lib/monitorRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { timeAgo } from '../../lib/format'

const ENDPOINT = `${import.meta.env?.VITE_SUPABASE_URL ?? 'https://YOUR-PROJECT.supabase.co'}/functions/v1/monitor-ingest`
const EXPIRY: [string, string][] = [['', 'Never'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']]
const keyState = (k: MonitorKeyRow, now = Date.now()) => (k.revoked_at || !k.active ? 'Revoked' : k.expires_at && new Date(k.expires_at).getTime() < now ? 'Expired' : 'Active')

function RegisterForm({ onDone }: { onDone: () => void }) {
  const depts = useAsyncData('monitor-depts', listDepartmentSummaries)
  const deptList = (depts.data && 'departments' in depts.data ? depts.data.departments : []).flatMap((d) => (d.slug ? [{ slug: d.slug, name: d.name }] : []))
  const { push } = useToast()
  const [f, setF] = useState({ name: '', slug: '', kind: 'web', department: '', heartbeat: '300', burst: '10' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const r = await registerMonitorProject({ name: f.name.trim(), slug: f.slug || slugFromName(f.name), kind: f.kind, department: f.department, heartbeatSeconds: Number(f.heartbeat), burst: Number(f.burst), quota: 600 })
    setBusy(false)
    if (r.error) { push(r.error.message.includes('duplicate') ? 'A project with that name or slug already exists.' : r.error.message, 'error'); return }
    push('Project registered. Now create a key for it.', 'success'); setF({ name: '', slug: '', kind: 'web', department: '', heartbeat: '300', burst: '10' }); setSlugTouched(false); onDone()
  }
  return (
    <form className="ctf-mon-admin__form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Project name" htmlFor="mp-name" required><Input id="mp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugFromName(e.target.value) })} maxLength={80} placeholder="e.g. Portfolio site" /></FieldWrap>
      <FieldWrap label="Short name" htmlFor="mp-slug" hint="Lowercase letters, digits and dashes."><Input id="mp-slug" value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: slugFromName(e.target.value) }) }} maxLength={40} /></FieldWrap>
      <FieldWrap label="Type" htmlFor="mp-kind"><Select id="mp-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['web', 'api', 'worker', 'mobile', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</Select></FieldWrap>
      <FieldWrap label="Owning department" htmlFor="mp-dept" hint="Its members can see this project. DevOps and Cybersecurity always can."><Select id="mp-dept" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">None</option>{deptList.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</Select></FieldWrap>
      <FieldWrap label="Expected heartbeat (seconds)" htmlFor="mp-hb" hint="Three missed beats open an incident."><Input id="mp-hb" type="number" min={30} max={86400} value={f.heartbeat} onChange={(e) => setF({ ...f, heartbeat: e.target.value })} /></FieldWrap>
      <FieldWrap label="Same error this many times in 10 minutes opens an incident" htmlFor="mp-burst"><Input id="mp-burst" type="number" min={1} max={1000} value={f.burst} onChange={(e) => setF({ ...f, burst: e.target.value })} /></FieldWrap>
      <div className="ctf-mon-admin__submit"><Button type="submit" variant="primary" disabled={busy || f.name.trim().length < 2}>Register project</Button></div>
    </form>
  )
}

function KeyForm({ projects, onDone, onCreated }: { projects: { id: string; name: string }[]; onDone: () => void; onCreated: (key: string) => void }) {
  const { push } = useToast()
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [scopes, setScopes] = useState<string[]>(['events', 'heartbeat'])
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const expires = days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null
    const r = await createMonitorKey(project, label.trim(), scopes, expires)
    setBusy(false)
    if (r.error || !r.key) { push(r.error?.message ?? 'Could not create the key.', 'error'); return }
    setLabel(''); onCreated(r.key); onDone()
  }
  const toggle = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  return (
    <form className="ctf-mon-admin__form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Project" htmlFor="mk-project"><Select id="mk-project" value={project} onChange={(e) => setProject(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FieldWrap>
      <FieldWrap label="Label" htmlFor="mk-label" hint="Where this key will live, e.g. production API."><Input id="mk-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></FieldWrap>
      <fieldset className="ctf-mon-admin__scopes"><legend>What it may send</legend>{Object.entries(KEY_SCOPE_LABEL).map(([s, l]) => <label key={s}><input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {l}</label>)}</fieldset>
      <FieldWrap label="Expires" htmlFor="mk-exp"><Select id="mk-exp" value={days} onChange={(e) => setDays(e.target.value)}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FieldWrap>
      <div className="ctf-mon-admin__submit"><Button type="submit" variant="primary" disabled={busy || !project || !label.trim() || scopes.length === 0}>Create key</Button></div>
    </form>
  )
}

/** Main Admin only: register projects, make and revoke their keys. The database refuses everyone else, whatever this screen shows. */
export function ProjectsAdmin() {
  const projects = useAsyncData('monitor-admin-projects', listMonitorProjects)
  const keys = useAsyncData('monitor-admin-keys', listMonitorKeys)
  const { push } = useToast()
  const [shown, setShown] = useState<string | null>(null)
  const names = new Map((projects.data ?? []).map((p) => [p.id, p.name]))
  const reload = () => { projects.reload(); keys.reload() }
  return (
    <div className="ctf-mon-admin">
      <p className="ctf-mon__note">A key lets one project <strong>send</strong> errors, latency and heartbeats to Super Monitor. It cannot read anything. Only a fingerprint of each key is stored, so a lost key is replaced, never recovered.</p>
      <div className="ctf-mon__endpoint"><code>{ENDPOINT}</code><CopyButton value={ENDPOINT} label="Copy endpoint" /></div>
      <h2 className="ctf-mon__h">Register a project</h2>
      <RegisterForm onDone={reload} />
      <h2 className="ctf-mon__h">Projects</h2>
      {projects.loading ? <SkeletonRows rows={2} /> : projects.error ? <ErrorState title="Projects couldn't load" description={projects.errorDetail?.message ?? 'Try again.'} onRetry={projects.reload} /> : (
        <Table caption="Registered projects" rows={projects.data ?? []} rowKey={(p) => p.id} emptyState={<EmptyState icon={KeyRound} title="No projects yet" description="Register the first project above." />}
          columns={[
            { key: 'n', header: 'Project', render: (p) => <><strong>{p.name}</strong><div className="ctf-mon__sub">{p.slug} · {p.kind}</div></> },
            { key: 's', header: 'Status', render: (p) => <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Monitoring' : 'Paused'}</Badge> },
            { key: 'd', header: 'Owner', render: (p) => p.owner_department ?? <span className="ctf-mon__sub">None</span> },
            { key: 'a', header: '', render: (p) => <Button size="sm" variant="ghost" onClick={() => void setMonitorProjectActive(p.id, !p.active).then((r) => { if (r.error) push(r.error.message, 'error'); else reload() })}>{p.active ? 'Pause' : 'Resume'}</Button> },
          ]} />
      )}
      <h2 className="ctf-mon__h">Keys</h2>
      {(projects.data ?? []).length > 0 && <KeyForm projects={(projects.data ?? []).map((p) => ({ id: p.id, name: p.name }))} onDone={keys.reload} onCreated={setShown} />}
      {keys.loading ? <SkeletonRows rows={2} /> : keys.error ? <ErrorState title="Keys couldn't load" description={keys.errorDetail?.message ?? 'Try again.'} onRetry={keys.reload} /> : (
        <Table caption="Keys" rows={keys.data ?? []} rowKey={(k) => k.id} emptyState={<EmptyState icon={KeyRound} title="No keys yet" description="Create a key for a project to let it report in." />}
          columns={[
            { key: 'l', header: 'Key', render: (k) => <><strong>{k.label}</strong><div className="ctf-mon__sub">{names.get(k.project_id) ?? 'Unknown project'} · {k.key_prefix}…</div></> },
            { key: 'sc', header: 'May send', render: (k) => k.scopes.map((s) => KEY_SCOPE_LABEL[s] ?? s).join(', ') },
            { key: 'st', header: 'Status', render: (k) => { const s = keyState(k); return <Badge tone={s === 'Active' ? 'success' : s === 'Expired' ? 'warning' : 'neutral'}>{s}</Badge> } },
            { key: 'u', header: 'Last used', render: (k) => (k.last_used_at ? timeAgo(k.last_used_at) : 'Never') },
            { key: 'a', header: '', render: (k) => keyState(k) === 'Active' ? <Button size="sm" variant="ghost" onClick={() => void revokeMonitorKey(k.id).then((r) => { if (r.error) push(r.error.message, 'error'); else { push('Key revoked. It stops working immediately.', 'success'); keys.reload() } })}>Revoke</Button> : null },
          ]} />
      )}
      <Modal open={!!shown} onClose={() => setShown(null)} title="Copy this key now" description="This is the only time it is shown." size="lg">
        <div className="ctf-mon__endpoint"><code>{shown}</code><CopyButton value={shown ?? ''} label="Copy key" /></div>
        <p className="ctf-mon__note">Keep it in the project&apos;s environment variables (for example <code>MONITOR_KEY</code>). If it is ever exposed, revoke it here and make a new one.</p>
        <pre className="ctf-mon__code" tabIndex={0} aria-label="Example setup">{ingestSnippet(ENDPOINT)}</pre>
        <div className="ctf-inc__row"><CopyButton value={ingestSnippet(ENDPOINT)} label="Copy example" /><Button variant="primary" onClick={() => setShown(null)}>I have saved it</Button></div>
      </Modal>
    </div>
  )
}
