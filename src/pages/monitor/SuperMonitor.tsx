import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Activity, ShieldAlert } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, Modal, PageHeader, SkeletonRows, Table, Tabs, useToast } from '../../components/ui'
import { listIncidents, listMonitorProjects, runMonitorChecks, type IncidentRow, type MonitorProject } from '../../lib/services'
import { HEALTH_LABEL, HEALTH_TONE, SEVERITY_LABEL, SEVERITY_TONE, STATUS_LABEL, STATUS_TONE, ackLabel, healthRank, heartbeatLabel, p95Label } from '../../lib/monitorRules'
import { IncidentPanel } from './IncidentPanel'
import { ProjectPanel } from './ProjectPanel'
import { ProjectsAdmin } from './ProjectsAdmin'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useAuth } from '../../lib/auth'
import { timeAgo } from '../../lib/format'
import './SuperMonitor.css'

type Scope = 'live' | 'resolved' | 'all'
const SCOPES: [Scope, string][] = [['live', 'Open'], ['resolved', 'Resolved'], ['all', 'All']]

function ProjectCard({ p, onOpen }: { p: MonitorProject; onOpen: () => void }) {
  const beat = heartbeatLabel(p.last_heartbeat_at, p.heartbeat_seconds)
  return (
    <article className={`ctf-mon-card ctf-mon-card--${p.health}`}>
      <div className="ctf-mon-card__top">
        <h2><button type="button" className="ctf-mon-card__open" onClick={onOpen}>{p.name}</button></h2>
        <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>
      </div>
      <p className="ctf-mon__sub">{p.owner_department ?? 'No owning department'} · {p.kind}</p>
      <dl className="ctf-mon-card__stats">
        <div><dt>Open incidents</dt><dd>{p.open_incidents > 0 && p.worst_severity ? <Badge tone={SEVERITY_TONE[p.worst_severity]}>{p.open_incidents} · worst {SEVERITY_LABEL[p.worst_severity].toLowerCase()}</Badge> : '0'}</dd></div>
        <div><dt>Errors, 24 h</dt><dd>{p.errors_24h.toLocaleString()}</dd></div>
        <div><dt>Slowest 5%</dt><dd>{p95Label(p.p95_ms_24h)}</dd></div>
        <div><dt>Heartbeat</dt><dd><Badge tone={beat.tone}>{beat.text}</Badge></dd></div>
      </dl>
    </article>
  )
}

function IncidentTable({ rows, loading, onOpen }: { rows: IncidentRow[]; loading: boolean; onOpen: (id: string) => void }) {
  return (
    <Table loading={loading} rows={rows} rowKey={(i) => i.id} onRowClick={(i) => onOpen(i.id)} caption="Incidents"
      emptyState={<EmptyState icon={ShieldAlert} title="No incidents here" description="Incidents open on their own when a project repeats the same error, reports a fatal one, or goes quiet. You can also open one by hand." />}
      columns={[
        { key: 'i', header: 'Incident', render: (i: IncidentRow) => <><strong>{i.title}</strong><div className="ctf-mon__sub">{i.ref} · {i.project_name}{i.reopen_count ? ` · reopened ${i.reopen_count}×` : ''}</div></> },
        { key: 'sev', header: 'Severity', render: (i: IncidentRow) => <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge> },
        { key: 'st', header: 'Status', render: (i: IncidentRow) => <><Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>{ackLabel(i) && <div className="ctf-mon__sub">{ackLabel(i)?.text}</div>}</> },
        { key: 'who', header: 'Assigned to', render: (i: IncidentRow) => i.assignee_name ?? <span className="ctf-mon__sub">Nobody yet</span> },
        { key: 'when', header: 'Opened', render: (i: IncidentRow) => timeAgo(i.opened_at) },
      ]} />
  )
}

export function SuperMonitor() {
  useDocumentTitle('Super Monitor')
  const { profile } = useAuth()
  const { push } = useToast()
  const isMainAdmin = profile?.role === 'superadmin'
  const [params, setParams] = useSearchParams()
  const [scope, setScope] = useState<Scope>('live')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [incidentId, setIncidentId] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const projects = useAsyncData('monitor-projects', listMonitorProjects)
  const live = useAsyncData('monitor-incidents:live', () => listIncidents('live'))
  const listed = useAsyncData(`monitor-incidents:${scope}`, () => listIncidents(scope))
  const sorted = useMemo(() => [...(projects.data ?? [])].sort((a, b) => healthRank(a.health) - healthRank(b.health) || a.name.localeCompare(b.name)), [projects.data])
  const liveRows = live.data ?? []
  const waiting = liveRows.filter((i) => i.status === 'open' || i.status === 'reopened').length
  const project = sorted.find((p) => p.id === projectId) ?? null
  const tabs = [{ id: 'overview', label: 'Projects', count: sorted.length }, { id: 'incidents', label: 'Incidents', count: liveRows.length }, ...(isMainAdmin ? [{ id: 'setup', label: 'Setup' }] : [])]
  const tab = tabs.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : 'overview'
  const reloadAll = () => { projects.reload(); live.reload(); listed.reload() }

  const runChecks = async () => {
    setChecking(true)
    const r = await runMonitorChecks()
    setChecking(false)
    if (r.error || !r.data) { push(r.error?.message ?? 'The checks could not run.', 'error'); return }
    push(`Checks done: ${r.data.silent_projects_opened} silent project${r.data.silent_projects_opened === 1 ? '' : 's'} flagged, ${r.data.escalated} incident${r.data.escalated === 1 ? '' : 's'} escalated.`, 'success')
    reloadAll()
  }

  const nothing = !projects.loading && !projects.error && sorted.length === 0 && !isMainAdmin
  return (
    <div className="ctf-mon">
      <PageHeader title="Super Monitor" description="How the company's own projects are doing: errors, speed, heartbeats and incidents, in one place."
        actions={isMainAdmin ? <Button variant="secondary" disabled={checking} onClick={() => void runChecks()}>{checking ? 'Checking…' : 'Run checks now'}</Button> : undefined} />
      {nothing ? <EmptyState icon={Activity} title="Nothing to monitor for you yet" description="You see a project here when your department owns it. DevOps and Cybersecurity see every project." /> : (
        <>
          {waiting > 0 && <p className="ctf-mon__alert" role="status"><strong>{waiting} incident{waiting === 1 ? '' : 's'}</strong> {waiting === 1 ? 'is' : 'are'} waiting for someone to acknowledge {waiting === 1 ? 'it' : 'them'}.</p>}
          <Tabs tabs={tabs} active={tab} onChange={(id) => setParams({ tab: id })} label="Super Monitor views" />
          {tab === 'setup' && isMainAdmin ? <ProjectsAdmin /> : tab === 'incidents' ? (
            <>
              <div className="ctf-mon__filters" role="group" aria-label="Filter incidents">
                {SCOPES.map(([id, label]) => <button key={id} type="button" className={scope === id ? 'is-on' : ''} aria-pressed={scope === id} onClick={() => setScope(id)}>{label}</button>)}
              </div>
              {listed.error ? <ErrorState title="Incidents couldn't load" description={listed.errorDetail?.message ?? 'Try again.'} onRetry={listed.reload} /> : <IncidentTable rows={listed.data ?? []} loading={listed.loading} onOpen={setIncidentId} />}
            </>
          ) : projects.loading ? <SkeletonRows rows={3} /> : projects.error ? <ErrorState title="Projects couldn't load" description={projects.errorDetail?.message ?? 'Try again.'} onRetry={projects.reload} /> : sorted.length === 0 ? (
            <EmptyState icon={Activity} title="No projects registered" description="Open the Setup tab to register a project and make its key." />
          ) : <div className="ctf-mon__grid">{sorted.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => setProjectId(p.id)} />)}</div>}
        </>
      )}
      <Modal open={!!project} onClose={() => setProjectId(null)} title={project?.name ?? ''} size="lg">
        {project && <ProjectPanel key={project.id} project={project} incidents={liveRows} onOpenIncident={setIncidentId} onChanged={reloadAll} />}
      </Modal>
      <Modal open={!!incidentId} onClose={() => setIncidentId(null)} title="Incident" size="lg">
        {incidentId && <IncidentPanel key={incidentId} id={incidentId} siblings={liveRows} onChanged={reloadAll} />}
      </Modal>
    </div>
  )
}
