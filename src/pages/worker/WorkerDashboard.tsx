import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Check, CircleSlash, FolderKanban, Inbox, ListChecks, MessageSquare, Newspaper, Users } from 'lucide-react'
import { Avatar, ButtonLink, ProgressBar, StatusBadge, useToast } from '../../components/ui'
import { BarList, Empty, Hero, Kpi, KpiRow, MiniBars, Panel } from '../../components/dashboard/Dash'
import { usePresence } from '../../components/PresenceProvider'
import { useChatActivity } from '../../components/ChatActivityProvider'
import { useAuth } from '../../lib/auth'
import { listMilestonesForProjects, listMyProjects, listProjectRequests, listRecentProjectUpdates, listTasks, listTeamMembers, updateTaskStatus } from '../../lib/services'
import { dailyCounts, greeting, milestoneProgress, OPEN_REQUEST, relativeDay, startOfDay, summariseTasks } from '../../lib/dashboardMetrics'
import { KIND_LABEL } from '../../lib/requestMeta'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useNow } from '../../hooks/useNow'
import { useUnreadCount } from '../../hooks/useUnreadCount'

const LIVE = new Set(['planning', 'in_development', 'active', 'maintenance'])

export function WorkerDashboard() {
  const { profile } = useAuth()
  const { push } = useToast()
  const now = useNow(60_000)
  const { onlineIds } = usePresence()
  const { totalUnread } = useChatActivity()
  const { count: unreadNotifications } = useUnreadCount(profile?.id)
  const tasks = useAsyncData('tasks', () => listTasks())
  const projects = useAsyncData('projects', listMyProjects)
  const updates = useAsyncData('updates', () => listRecentProjectUpdates(6))
  const requests = useAsyncData('requests', () => listProjectRequests())
  const team = useAsyncData('team', listTeamMembers)
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set())

  const liveProjects = useMemo(() => (projects.data ?? []).filter((p) => LIVE.has(p.status)), [projects.data])
  const projectIds = useMemo(() => liveProjects.slice(0, 5).map((p) => p.id), [liveProjects])
  const milestones = useAsyncData(projectIds.join(',') || 'none', () => listMilestonesForProjects(projectIds))
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data])

  const all = useMemo(() => (tasks.data ?? []).filter((t) => !finished.has(t.id)), [tasks.data, finished])
  const summary = useMemo(() => summariseTasks(all, profile?.id, now), [all, profile?.id, now])
  const completions = useMemo(() => dailyCounts((tasks.data ?? []).filter((t) => t.assignee_id === profile?.id && t.status === 'done').map((t) => t.completed_at), 14, now), [tasks.data, profile?.id, now])
  const openRequests = (requests.data ?? []).filter((r) => OPEN_REQUEST(r.status))
  const onlineTeam = (team.data ?? []).filter((m) => m.id !== profile?.id && onlineIds.has(m.id))
  const focus = summary.focus.slice(0, 6)
  const thisWeek = summary.dueSoon.length

  const complete = async (taskId: string) => {
    setFinished((prev) => new Set(prev).add(taskId)) // optimistic: it leaves the list immediately
    const { error } = await updateTaskStatus(taskId, 'done')
    if (error) {
      setFinished((prev) => { const next = new Set(prev); next.delete(taskId); return next }) // roll back: the database refused
      push(error.message, 'error')
    } else { push('Task completed'); tasks.reload() }
  }

  const subtitle = tasks.loading ? 'Loading your day…'
    : summary.overdue.length > 0 ? `${summary.overdue.length} overdue ${summary.overdue.length === 1 ? 'task needs' : 'tasks need'} you first.`
    : thisWeek > 0 ? `Nothing overdue. ${thisWeek} ${thisWeek === 1 ? 'task is' : 'tasks are'} due in the next 7 days.`
    : summary.mine.length > 0 ? `Nothing overdue and nothing due this week — ${summary.mine.length} open ${summary.mine.length === 1 ? 'task' : 'tasks'} with no deadline.` : "You're all caught up."

  return (
    <div className="ctf-dash">
      <Hero title={greeting(now, profile?.display_name ?? '')} subtitle={`${new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${subtitle}`}>
        <ButtonLink to="/worker/tasks" variant="primary" icon={<ListChecks size={15} />}>Open task board</ButtonLink>
        <ButtonLink to="/worker/projects" variant="secondary">All projects</ButtonLink>
      </Hero>

      <KpiRow>
        <Kpi label="My open tasks" value={summary.mine.length} icon={ListChecks} loading={tasks.loading} to="/worker/tasks" hint={`${summary.byStatus.in_progress} in progress`} />
        <Kpi label="Overdue" value={summary.overdue.length} icon={AlertTriangle} loading={tasks.loading} tone={summary.overdue.length ? 'bad' : 'good'} to="/worker/tasks" hint={summary.overdue.length ? 'Oldest first below' : 'Nothing is late'} />
        <Kpi label="Due in 7 days" value={thisWeek} icon={CalendarClock} loading={tasks.loading} to="/worker/tasks" />
        <Kpi label="Blocked" value={summary.blocked.length} icon={CircleSlash} loading={tasks.loading} tone={summary.blocked.length ? 'warn' : 'neutral'} hint={summary.blocked.length ? 'Waiting on something' : undefined} />
        <Kpi label="Unread" value={totalUnread + unreadNotifications} icon={totalUnread ? MessageSquare : Bell} to={totalUnread ? '/worker/chat' : '/worker/notifications'} hint={`${totalUnread} messages · ${unreadNotifications} notifications`} />
      </KpiRow>

      <div className="ctf-dash-grid">
        <Panel className="span-7" title="Focus: what needs you" icon={CheckCircle2} action={{ to: '/worker/tasks', label: 'All tasks' }}>
          {tasks.loading ? <Empty>Loading…</Empty> : tasks.error ? <Empty>{tasks.errorDetail?.message ?? "Tasks didn't load."}</Empty> : focus.length === 0 ? (
            <Empty>{summary.mine.length === 0 ? 'No tasks are assigned to you. 🎉' : 'Nothing is due this week. Pick something from your board when you have a moment.'}</Empty>
          ) : (
            <ul className="ctf-rows">
              {focus.map((t) => {
                const late = startOfDay(t.due_date!) < startOfDay(now)
                return (
                  <li key={t.id}>
                    <button className="ctf-check" aria-label={`Mark "${t.title}" done`} onClick={() => void complete(t.id)}><Check size={11} /></button>
                    <div className="ctf-rows__main"><Link to={`/worker/projects/${t.project_id}`}>{t.title}</Link><small>{projectName.get(t.project_id) ?? 'Project'}</small></div>
                    {(t.priority === 'urgent' || t.priority === 'high') && <span className={`ctf-prio is-${t.priority}`}>{t.priority}</span>}
                    <span className={`ctf-rows__when ${late ? 'is-late' : ''}`}>{relativeDay(t.due_date!, now)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel className="span-5" title="Your momentum" icon={ListChecks}>
          <div><small className="ctf-muted">Tasks you completed, last 14 days</small></div>
          <MiniBars values={completions} label="Tasks you completed in the last 14 days" />
          <BarList items={[
            { label: 'To do', value: summary.byStatus.todo }, { label: 'In progress', value: summary.byStatus.in_progress },
            { label: 'Blocked', value: summary.byStatus.blocked, tone: 'warn' }, { label: 'Done', value: summary.byStatus.done, tone: 'good' },
          ]} emptyText="Tasks assigned to you will be broken down here." />
        </Panel>

        <Panel className="span-7" title="Active projects" icon={FolderKanban} action={{ to: '/worker/projects', label: 'All projects' }}>
          {projects.loading ? <Empty>Loading…</Empty> : liveProjects.length === 0 ? <Empty>No active projects yet.</Empty> : (
            <div>
              {liveProjects.slice(0, 5).map((p) => {
                const progress = milestoneProgress((milestones.data ?? []).filter((m) => m.project_id === p.id))
                return (
                  <div className="ctf-progress-row" key={p.id}>
                    <div><Link to={`/worker/projects/${p.id}`}>{p.name}</Link><StatusBadge status={p.status} /></div>
                    {progress ? <ProgressBar value={progress.percent} /> : <small>{milestones.loading ? 'Loading progress…' : 'No milestones yet, so no progress to show'}</small>}
                    <small>{progress ? `${progress.done} of ${progress.total} milestones complete` : ''}{p.due_date ? `${progress ? ' · ' : ''}due ${relativeDay(p.due_date, now).toLowerCase()}` : ''}</small>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel className="span-5" title="Client requests to triage" icon={Inbox}>
          {requests.loading ? <Empty>Loading…</Empty> : openRequests.length === 0 ? <Empty>No open client requests.</Empty> : (
            <ul className="ctf-rows">
              {openRequests.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <div className="ctf-rows__main"><Link to={`/worker/projects/${r.project_id}`}>{r.title}</Link><small>{projectName.get(r.project_id) ?? 'Project'} · {KIND_LABEL[r.kind] ?? 'Request'}</small></div>
                  {(r.priority === 'urgent' || r.priority === 'high') && <span className={`ctf-prio is-${r.priority}`}>{r.priority}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="span-7" title="Latest project updates" icon={Newspaper}>
          {updates.loading ? <Empty>Loading…</Empty> : (updates.data ?? []).length === 0 ? <Empty>No updates have been published yet.</Empty> : (
            <ul className="ctf-rows">
              {(updates.data ?? []).map((u) => (
                <li key={u.id}>
                  <div className="ctf-rows__main"><Link to={`/worker/projects/${u.project_id}`}>{u.title}</Link><small>{u.project_name}{u.published_at ? '' : ' · draft'}</small></div>
                  <span className="ctf-rows__when">{relativeDay(u.created_at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="span-5" title={`Team online${onlineTeam.length ? ` (${onlineTeam.length})` : ''}`} icon={Users} action={{ to: '/worker/chat', label: 'Open chat' }}>
          {onlineTeam.length === 0 ? <Empty>Nobody else is online right now.</Empty> : (
            <div className="ctf-online">{onlineTeam.slice(0, 14).map((m) => <span key={m.id} title={m.display_name}><Avatar name={m.display_name} size={32} /><i /></span>)}</div>
          )}
          {onlineTeam.length > 0 && <small className="ctf-muted">{onlineTeam.slice(0, 3).map((m) => m.display_name.split(' ')[0]).join(', ')}{onlineTeam.length > 3 ? ` and ${onlineTeam.length - 3} more` : ''}</small>}
        </Panel>
      </div>
    </div>
  )
}
