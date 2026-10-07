import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Activity, AlertTriangle, Briefcase, CheckCircle2, FolderKanban, Inbox, ListChecks, ShieldCheck, TrendingUp, UserCog, Users } from 'lucide-react'
import { Avatar, ButtonLink } from '../../components/ui'
import { BarList, Empty, Hero, Kpi, KpiRow, Panel, StackedBar } from '../../components/dashboard/Dash'
import { usePresence } from '../../components/PresenceProvider'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { countPublishedPosts, countRows, getSecurityPosture, getStatusCounts, listAuditLogs, listMyProjects, listProjectRequests, listTasks, listTeamMembers } from '../../lib/services'
import { evaluatePosture, scoreFindings, attentionList } from '../../lib/securityChecks'
import { greeting, OPEN_REQUEST, overdueProjects, relativeDay, startOfDay } from '../../lib/dashboardMetrics'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useNow } from '../../hooks/useNow'

type Health = { state: 'checking' | 'healthy' | 'degraded' | 'unavailable'; ms?: number }

/** Real round-trips, timed: a read against Postgres and an actual invocation of the no-op `health` function. */
function useHealth() {
  const [db, setDb] = useState<Health>({ state: 'checking' })
  const [fn, setFn] = useState<Health>({ state: 'checking' })
  useEffect(() => {
    let cancelled = false
    const t0 = performance.now()
    void supabase.from('profiles').select('id', { count: 'exact', head: true }).then(({ error }) => {
      const ms = Math.round(performance.now() - t0)
      if (!cancelled) setDb({ state: error ? 'unavailable' : ms > 2000 ? 'degraded' : 'healthy', ms })
    })
    const t1 = performance.now()
    void supabase.functions.invoke('health').then(({ error }) => {
      const ms = Math.round(performance.now() - t1)
      if (!cancelled) setFn({ state: error ? 'unavailable' : ms > 3000 ? 'degraded' : 'healthy', ms })
    })
    return () => { cancelled = true }
  }, [])
  return { db, fn }
}

/** countRows() returns { count }; useAsyncData expects { data }. */
const counter = (table: string, filters: Record<string, string | boolean | null>, idColumn?: string) => async () => {
  const r = await countRows(table, filters, idColumn)
  return { data: r.count, error: r.error }
}

const HEALTH_TEXT = { checking: 'Checking…', healthy: 'Healthy', degraded: 'Slow', unavailable: 'Unavailable' } as const
const PROJECT_COLORS: Record<string, string> = { planning: '#6f7a8c', in_development: '#5b6cff', active: '#34d3a0', maintenance: '#8b5cf6', paused: '#e0a82e', completed: '#2c9a78', archived: '#3a4556' }
const LEAD_ORDER = ['new', 'qualified', 'contacted', 'converted', 'closed']
const APPLICATION_ORDER = ['received', 'reviewing', 'interview', 'hired', 'declined']

export function AdminDashboard() {
  const { profile } = useAuth()
  const isSuper = profile?.role === 'superadmin'
  const now = useNow(60_000)
  const { onlineIds } = usePresence()
  const { db, fn } = useHealth()

  const activeClients = useAsyncData('clients', counter('clients', { status: 'active' }))
  const activeWorkers = useAsyncData('workers', counter('worker_profiles', { status: 'active' }, 'user_id'))
  const publishedPosts = useAsyncData('posts', countPublishedPosts)
  const projects = useAsyncData('projects', listMyProjects)
  const projectStatuses = useAsyncData('pstatus', () => getStatusCounts('projects', 'status'))
  const leads = useAsyncData('leads', () => getStatusCounts('leads', 'status'))
  const applications = useAsyncData('apps', () => getStatusCounts('applications', 'status'))
  const tasks = useAsyncData('tasks', () => listTasks())
  const requests = useAsyncData('requests', () => listProjectRequests())
  const team = useAsyncData('team', listTeamMembers)
  const audit = useAsyncData('audit', () => listAuditLogs(8))
  // The security report is superadmin-only (enforced in SQL), so don't even ask anyone else.
  const posture = useAsyncData(isSuper ? 'posture' : 'skip', async () => (isSuper ? getSecurityPosture() : { data: null, error: null }))

  const today = startOfDay(now)
  const overdueTasks = (tasks.data ?? []).filter((t) => t.status !== 'done' && t.due_date && startOfDay(t.due_date) < today)
  const lateProjects = useMemo(() => overdueProjects(projects.data ?? [], now), [projects.data, now])
  const openRequests = (requests.data ?? []).filter((r) => OPEN_REQUEST(r.status))
  const newLeads = leads.data?.new ?? 0
  const newApplications = applications.data?.received ?? 0
  const live = (projectStatuses.data?.active ?? 0) + (projectStatuses.data?.in_development ?? 0) + (projectStatuses.data?.maintenance ?? 0) + (projectStatuses.data?.planning ?? 0)
  const onlineCount = (team.data ?? []).filter((m) => onlineIds.has(m.id)).length

  const security = useMemo(() => {
    if (!posture.data) return null
    const findings = evaluatePosture(posture.data)
    return { ...scoreFindings(findings), attention: attentionList(findings) }
  }, [posture.data])

  // "Needs attention" is built only from things that are actually waiting for a person, each linking to where it is handled.
  const attention = [
    { show: newLeads > 0, label: `${newLeads} new ${newLeads === 1 ? 'lead' : 'leads'} waiting for a first reply`, icon: Inbox, to: '/admin/leads' },
    { show: newApplications > 0, label: `${newApplications} job ${newApplications === 1 ? 'application' : 'applications'} not yet reviewed`, icon: UserCog, to: '/admin/applications' },
    { show: openRequests.length > 0, label: `${openRequests.length} open client ${openRequests.length === 1 ? 'request' : 'requests'}`, icon: Briefcase, to: '/admin/projects' },
    { show: overdueTasks.length > 0, label: `${overdueTasks.length} overdue ${overdueTasks.length === 1 ? 'task' : 'tasks'} across all projects`, icon: ListChecks, to: '/admin/tasks' },
    { show: lateProjects.length > 0, label: `${lateProjects.length} ${lateProjects.length === 1 ? 'project is' : 'projects are'} past ${lateProjects.length === 1 ? 'its' : 'their'} due date`, icon: FolderKanban, to: '/admin/projects' },
    { show: !!security && security.counts.fail > 0, label: `${security?.counts.fail} security ${security?.counts.fail === 1 ? 'issue needs' : 'issues need'} action`, icon: ShieldCheck, to: '/admin/security' },
  ].filter((a) => a.show)
  const attentionReady = !leads.loading && !applications.loading && !tasks.loading && !requests.loading && !projects.loading

  return (
    <div className="ctf-dash">
      <Hero title={greeting(now, profile?.display_name ?? '')} subtitle={`${new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${attentionReady ? (attention.length ? `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} your attention.` : 'Nothing is waiting on you.') : 'Checking what needs you…'}`}>
        <ButtonLink to="/admin/projects" variant="primary" icon={<FolderKanban size={15} />}>Projects</ButtonLink>
        <ButtonLink to="/admin/workers" variant="secondary" icon={<Users size={15} />}>Team</ButtonLink>
      </Hero>

      <KpiRow>
        <Kpi label="Live projects" value={live} icon={FolderKanban} loading={projectStatuses.loading} to="/admin/projects" hint={`${projectStatuses.data?.completed ?? 0} completed`} />
        <Kpi label="Active clients" value={activeClients.data ?? 0} icon={Briefcase} loading={activeClients.loading} to="/admin/clients" />
        <Kpi label="Active team" value={activeWorkers.data ?? 0} icon={Users} loading={activeWorkers.loading} to="/admin/workers" hint={`${onlineCount} online now`} tone="good" />
        <Kpi label="New leads" value={newLeads} icon={Inbox} loading={leads.loading} to="/admin/leads" tone={newLeads ? 'warn' : 'neutral'} hint={newLeads ? 'Need a first reply' : 'All answered'} />
        <Kpi label="Overdue tasks" value={overdueTasks.length} icon={AlertTriangle} loading={tasks.loading} to="/admin/tasks" tone={overdueTasks.length ? 'bad' : 'good'} />
        <Kpi label="Published posts" value={publishedPosts.data ?? 0} icon={TrendingUp} loading={publishedPosts.loading} to="/admin/content" />
      </KpiRow>

      <div className="ctf-dash-grid">
        <Panel className="span-7" title="Needs attention" icon={AlertTriangle}>
          {!attentionReady ? <Empty>Checking…</Empty> : attention.length === 0 ? (
            <Empty><CheckCircle2 size={14} style={{ verticalAlign: '-2px', color: 'var(--signal-9)' }} /> All clear. No leads, applications, requests or overdue work are waiting.</Empty>
          ) : (
            <ul className="ctf-rows">
              {attention.map((a) => { const Icon = a.icon; return (
                <li key={a.label}><span className="ctf-kpi__icon"><Icon size={15} /></span><div className="ctf-rows__main"><Link to={a.to}>{a.label}</Link></div></li>
              ) })}
            </ul>
          )}
        </Panel>

        {isSuper ? (
          <Panel className="span-5" title="Security" icon={ShieldCheck} action={{ to: '/admin/security', label: 'Open monitor' }}>
            {posture.loading ? <Empty>Checking…</Empty> : !security ? <Empty>{posture.errorDetail?.message ?? 'The security report is unavailable.'}</Empty> : (
              <>
                <div className="ctf-dash-score"><strong>{security.score}</strong><span>Grade {security.grade}</span><small>{security.counts.fail} to fix · {security.counts.warn} to review</small></div>
                {security.attention.slice(0, 3).map((f) => <small key={f.id} className="ctf-muted">• {f.title}</small>)}
              </>
            )}
          </Panel>
        ) : (
          <Panel className="span-5" title="Team online" icon={Users} action={{ to: '/admin/chat', label: 'Open chat' }}>
            <TeamOnline members={(team.data ?? []).filter((m) => onlineIds.has(m.id))} />
          </Panel>
        )}

        <Panel className="span-7" title="Projects by status" icon={FolderKanban} action={{ to: '/admin/projects', label: 'All projects' }}>
          <StackedBar items={Object.entries(projectStatuses.data ?? {}).map(([label, value]) => ({ label: label.replace('_', ' '), value, color: PROJECT_COLORS[label] ?? '#6f7a8c' }))} />
          {lateProjects.length > 0 && (
            <ul className="ctf-rows">
              {lateProjects.slice(0, 4).map((p) => (
                <li key={p.id}><div className="ctf-rows__main"><Link to={`/admin/projects/${p.id}`}>{p.name}</Link><small>Due {relativeDay(p.due_date!, now).toLowerCase()}</small></div><span className="ctf-rows__when is-late">Overdue</span></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="span-5" title="Sales & hiring pipeline" icon={TrendingUp}>
          <small className="ctf-muted">Leads</small>
          <BarList items={LEAD_ORDER.map((s) => ({ label: s, value: leads.data?.[s] ?? 0, tone: s === 'converted' ? 'good' as const : s === 'new' ? 'warn' as const : 'neutral' as const }))} emptyText="No leads yet." />
          <small className="ctf-muted" style={{ marginTop: 6 }}>Applications</small>
          <BarList items={APPLICATION_ORDER.map((s) => ({ label: s, value: applications.data?.[s] ?? 0, tone: s === 'hired' ? 'good' as const : s === 'declined' ? 'bad' as const : 'neutral' as const }))} emptyText="No applications yet." />
        </Panel>

        <Panel className="span-7" title="System health" icon={Activity} action={{ to: '/admin/status', label: 'Full status' }}>
          <ul className="ctf-health">
            {([['Database', db], ['Edge functions', fn]] as const).map(([label, h]) => (
              <li key={label}><i className={`dot-${h.state}`} aria-hidden="true" /><span>{label}</span><b>{HEALTH_TEXT[h.state]}</b>{h.ms !== undefined && <em className="mono">{h.ms} ms</em>}</li>
            ))}
          </ul>
        </Panel>

        {isSuper && (
          <Panel className="span-5" title="Team online" icon={Users} action={{ to: '/admin/chat', label: 'Open chat' }}>
            <TeamOnline members={(team.data ?? []).filter((m) => onlineIds.has(m.id))} />
          </Panel>
        )}

        <Panel className="span-12" title="Recent activity" icon={Activity} action={isSuper ? { to: '/admin/audit', label: 'Audit log' } : undefined}>
          {audit.loading ? <Empty>Loading…</Empty> : audit.error ? <Empty>Activity is only visible to administrators.</Empty> : (audit.data ?? []).length === 0 ? <Empty>No activity recorded yet.</Empty> : (
            <ul className="ctf-rows">
              {(audit.data ?? []).map((e) => (
                <li key={e.id}>
                  <div className="ctf-rows__main"><strong>{e.action}</strong><small>{e.resource_type}{e.success ? '' : ' · failed'}</small></div>
                  <span className={`ctf-rows__when ${e.severity === 'error' || !e.success ? 'is-late' : ''}`}>{new Date(e.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function TeamOnline({ members }: { members: { id: string; display_name: string }[] }) {
  if (members.length === 0) return <Empty>Nobody is online right now.</Empty>
  return (
    <>
      <div className="ctf-online">{members.slice(0, 14).map((m) => <span key={m.id} title={m.display_name}><Avatar name={m.display_name} size={32} /><i /></span>)}</div>
      <small className="ctf-muted">{members.length} online</small>
    </>
  )
}
