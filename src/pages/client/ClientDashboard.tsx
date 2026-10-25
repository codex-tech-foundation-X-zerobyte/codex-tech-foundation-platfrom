import { useMemo } from 'react'
import { Link } from 'react-router'
import { CalendarClock, CheckCircle2, Circle, FileText, FolderKanban, Inbox, LifeBuoy, Milestone, Newspaper, Plus } from 'lucide-react'
import { ButtonLink, EmptyState, ErrorState, ProgressBar, SkeletonRows, StatusBadge } from '../../components/ui'
import { Empty, Hero, Kpi, KpiRow, Panel } from '../../components/dashboard/Dash'
import { useAuth } from '../../lib/auth'
import { listMyClientProjects, listProjectFiles, listProjectMilestones, listProjectRequests, listProjectUpdates } from '../../lib/services'
import { greeting, milestoneProgress, OPEN_REQUEST, relativeDay } from '../../lib/dashboardMetrics'
import { KIND_LABEL } from '../../lib/requestMeta'
import { formatBytes } from '../../lib/storagePath'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useNow } from '../../hooks/useNow'
import './ClientDashboard.css'

const snippet = (text: string, max = 150) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max)}…` : t }

export function ClientDashboard() {
  const { profile } = useAuth()
  const now = useNow(60_000)
  // The client's OWN projects — listMyProjects() would also return public showcase projects.
  const projects = useAsyncData('projects', listMyClientProjects)
  const current = projects.data?.[0]
  const pid = current?.id ?? 'none'
  // Milestones are shown regardless of is_public: no staff screen can set that flag, so filtering on it hid every milestone.
  const milestones = useAsyncData(`m-${pid}`, () => (current ? listProjectMilestones(current.id) : Promise.resolve({ data: [], error: null })))
  const updates = useAsyncData(`u-${pid}`, () => (current ? listProjectUpdates(current.id) : Promise.resolve({ data: [], error: null })))
  const files = useAsyncData(`f-${pid}`, () => (current ? listProjectFiles(current.id) : Promise.resolve({ data: [], error: null })))
  const requests = useAsyncData('requests', () => listProjectRequests())

  const progress = useMemo(() => milestoneProgress(milestones.data ?? []), [milestones.data])
  const next = (milestones.data ?? []).find((m) => m.status !== 'complete')
  const open = (requests.data ?? []).filter((r) => OPEN_REQUEST(r.status))
  const openIssues = open.filter((r) => r.kind === 'bug' || r.kind === 'maintenance').length
  const openChanges = open.length - openIssues

  if (projects.error) return <ErrorState title="Your overview didn't load" description={projects.errorDetail?.message ?? 'Check your connection and try again.'} onRetry={projects.reload} />
  if (projects.loading) return <SkeletonRows rows={4} height="90px" />
  if (!current) {
    return (
      <div className="ctf-dash">
        <Hero title={greeting(now, profile?.display_name ?? '')} subtitle="Welcome to your client portal." />
        <EmptyState icon={FolderKanban} title="No active project yet" description="Once a project is set up for your account, its progress, updates and files will appear here. If you were expecting one, contact your Codex project lead." />
      </div>
    )
  }

  return (
    <div className="ctf-dash">
      <Hero title={greeting(now, profile?.display_name ?? '')} subtitle={<><strong style={{ color: 'var(--text-primary)' }}>{current.name}</strong> is <StatusBadge status={current.status} />{current.due_date ? ` · target ${new Date(current.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</>}>
        <ButtonLink to="/client/requests" variant="primary" icon={<Plus size={15} />}>New request</ButtonLink>
        <ButtonLink to="/client/maintenance" variant="secondary" icon={<LifeBuoy size={15} />}>Report an issue</ButtonLink>
      </Hero>

      <KpiRow>
        <Kpi label="Overall progress" value={progress ? `${progress.percent}%` : '—'} icon={Milestone} loading={milestones.loading} to={`/client/projects/${current.id}`} hint={progress ? `${progress.done} of ${progress.total} milestones complete` : 'Milestones will be added soon'} tone={progress?.percent === 100 ? 'good' : 'neutral'} />
        <Kpi label="Next milestone" value={next ? <span style={{ fontSize: 17, lineHeight: 1.3, display: 'block' }}>{next.title}</span> : progress ? 'All done' : '—'} icon={CalendarClock} loading={milestones.loading} hint={next?.target_date ? `Target ${relativeDay(next.target_date, now).toLowerCase()}` : next ? 'No date set yet' : undefined} />
        <Kpi label="Open requests" value={openChanges} icon={Inbox} loading={requests.loading} to="/client/requests" hint={openChanges ? 'Being looked at by the team' : 'Nothing waiting'} />
        <Kpi label="Open issues" value={openIssues} icon={LifeBuoy} loading={requests.loading} to="/client/maintenance" tone={openIssues ? 'warn' : 'neutral'} hint={openIssues ? 'We are on it' : 'Nothing reported'} />
      </KpiRow>

      <div className="ctf-dash-grid">
        <Panel className="span-7" title="Milestones" icon={Milestone} action={{ to: `/client/projects/${current.id}`, label: 'Project details' }}>
          {milestones.loading ? <Empty>Loading…</Empty> : (milestones.data ?? []).length === 0 ? <Empty>The team hasn't added milestones yet. They'll appear here as the plan takes shape.</Empty> : (
            <ul className="ctf-rows">
              {(milestones.data ?? []).map((m) => {
                const done = m.status === 'complete'
                return (
                  <li key={m.id}>
                    {done ? <CheckCircle2 size={17} style={{ color: 'var(--signal-9)', flexShrink: 0 }} aria-label="Complete" /> : <Circle size={17} style={{ color: 'var(--text-faint)', flexShrink: 0 }} aria-label="Not complete" />}
                    <div className="ctf-rows__main"><strong>{m.title}</strong>{!done && m.percentage > 0 && <ProgressBar value={m.percentage} />}</div>
                    <span className="ctf-rows__when">{done ? (m.completed_date ? `Done ${relativeDay(m.completed_date, now).toLowerCase()}` : 'Done') : m.target_date ? `Target ${relativeDay(m.target_date, now).toLowerCase()}` : 'No date yet'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel className="span-5" title="Latest updates" icon={Newspaper} action={{ to: '/client/updates', label: 'All updates' }}>
          {updates.loading ? <Empty>Loading…</Empty> : (updates.data ?? []).length === 0 ? <Empty>No updates yet. The team will post progress notes here.</Empty> : (
            <ul className="ctf-rows">
              {(updates.data ?? []).slice(0, 3).map((u) => (
                <li key={u.id}>
                  <div className="ctf-rows__main"><strong>{u.title}</strong><small style={{ whiteSpace: 'normal' }}>{snippet(u.body)}</small></div>
                  <span className="ctf-rows__when">{relativeDay(u.published_at ?? u.created_at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="span-7" title="Your requests" icon={Inbox} action={{ to: '/client/requests', label: 'View all' }}>
          {requests.loading ? <Empty>Loading…</Empty> : (requests.data ?? []).length === 0 ? <Empty>You haven't sent any requests. Need a change or something new? <Link to="/client/requests" style={{ color: 'var(--accent-7)' }}>Send one</Link> and it lands with the team straight away.</Empty> : (
            <ul className="ctf-rows">
              {(requests.data ?? []).slice(0, 5).map((r) => (
                <li key={r.id}>
                  <div className="ctf-rows__main"><strong>{r.title}</strong><small>{KIND_LABEL[r.kind] ?? 'Request'} · {relativeDay(r.created_at, now).toLowerCase()}</small></div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="span-5" title="Shared files" icon={FileText} action={{ to: '/client/files', label: 'All files' }}>
          {files.loading ? <Empty>Loading…</Empty> : (files.data ?? []).length === 0 ? <Empty>Files shared with you will appear here.</Empty> : (
            <ul className="ctf-rows">
              {(files.data ?? []).slice(0, 4).map((f) => (
                <li key={f.id}>
                  <div className="ctf-rows__main"><Link to="/client/files">{f.name}</Link><small>{relativeDay(f.created_at, now)}{f.size_bytes ? ` · ${formatBytes(f.size_bytes)}` : ''}</small></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {(projects.data ?? []).length > 1 && (
          <Panel className="span-12" title="Your other projects" icon={FolderKanban}>
            <div className="ctf-client-others">
              {(projects.data ?? []).slice(1).map((p) => (
                <Link key={p.id} to={`/client/projects/${p.id}`} className="ctf-client-other"><strong>{p.name}</strong><StatusBadge status={p.status} /></Link>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
