import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bell, CheckCircle2, FolderKanban, Inbox } from 'lucide-react'
import { EmptyState, ProgressBar, SectionHeading, Stat, StatusBadge } from '../../components/ui'
import { listMyProjects, listTasks, listNotifications } from '../../lib/services'
import type { Notification, Project, ProjectStatus, Task } from '../../lib/types'
import './WorkerDashboard.css'

// Rough visual estimate only — real progress comes from milestones, not
// inferred from status. Matches the current project_status vocabulary
// (see docs/DATABASE-SCHEMA.md).
const PROJECT_PROGRESS_ESTIMATE: Record<ProjectStatus, number> = {
  planning: 10,
  in_development: 40,
  active: 60,
  maintenance: 85,
  paused: 40,
  completed: 100,
  archived: 100,
}

export function WorkerDashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [notifications, setNotifications] = useState<Notification[] | null>(null)
  // Computed once per mount rather than called during render — Date.now() is
  // impure and calling it directly in the render body breaks memoization.
  const [weekFromNowMs] = useState(() => Date.now() + 7 * 86400000)

  useEffect(() => {
    void listMyProjects().then((r) => setProjects(r.data))
    void listTasks().then((r) => setTasks(r.data))
    void listNotifications().then((r) => setNotifications(r.data))
  }, [])

  const tasksDue = tasks?.filter((t) => t.status !== 'done' && t.due_date && new Date(t.due_date).getTime() <= weekFromNowMs) ?? []
  const unread = notifications?.filter((n) => !n.read_at) ?? []
  const activeProjects = projects?.filter((p) => p.status === 'active' || p.status === 'planning') ?? []

  return (
    <div className="ctf-worker-dashboard">
      <SectionHeading eyebrow="Overview" title="Your workspace." />

      <div className="ctf-stat-row">
        <Stat label="Active projects" value={projects ? activeProjects.length : '—'} icon={FolderKanban} />
        <Stat label="Tasks due (7d)" value={tasks ? tasksDue.length : '—'} icon={CheckCircle2} />
        <Stat label="Unread notifications" value={notifications ? unread.length : '—'} icon={Bell} />
      </div>

      <div className="ctf-worker-dashboard__grid">
        <section>
          <h2>My active projects</h2>
          {projects === null && <p className="ctf-muted">Loading…</p>}
          {projects !== null && activeProjects.length === 0 && (
            <EmptyState icon={FolderKanban} title="No active projects" description="Projects assigned to you will appear here once you're added as a member." />
          )}
          <div className="ctf-mini-project-list">
            {activeProjects.slice(0, 5).map((p) => (
              <Link to={`/worker/projects/${p.id}`} key={p.id} className="ctf-mini-project">
                <div>
                  <strong>{p.name}</strong>
                  <StatusBadge status={p.status} />
                </div>
                <ProgressBar value={PROJECT_PROGRESS_ESTIMATE[p.status] ?? 10} />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2>Tasks due soon</h2>
          {tasks === null && <p className="ctf-muted">Loading…</p>}
          {tasks !== null && tasksDue.length === 0 && (
            <EmptyState icon={Inbox} title="Nothing due this week" description="Tasks with an upcoming due date will show up here." />
          )}
          <ul className="ctf-mini-task-list">
            {tasksDue.slice(0, 6).map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                <span className="ctf-mini-task-list__date">{t.due_date}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
