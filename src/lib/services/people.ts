import { supabase } from '../supabase'
import { toError } from './shared'

/* ---- Suspension cases: a Department Admin raises one, only a Main Admin decides it ------------------------------------------- */

export type CaseStatus = 'pending' | 'suspended' | 'under_review' | 'restored' | 'offboarded'
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = { pending: 'Awaiting decision', suspended: 'Suspended', under_review: 'Under review', restored: 'Restored', offboarded: 'Offboarded' }
export const isOpenCase = (s: CaseStatus) => s === 'pending' || s === 'suspended' || s === 'under_review'

export interface SuspensionCase {
  id: string; worker_user_id: string; worker_name: string; department_id: string | null; department_name: string
  requested_by: string; requester_name: string; reason: string; evidence: string; status: CaseStatus
  decision_note: string; decided_at: string | null; created_at: string
  events: { id: string; actor_name: string; action: string; note: string; created_at: string }[]
}

export async function listSuspensionCases() {
  const { data, error } = await supabase.from('suspension_cases').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) return { data: [] as SuspensionCase[], error: toError(error) }
  const caseIds = (data ?? []).map((c) => c.id)
  const { data: events } = caseIds.length ? await supabase.from('suspension_case_events').select('*').in('case_id', caseIds).order('created_at') : { data: [] }
  const personIds = Array.from(new Set([...(data ?? []).flatMap((c) => [c.worker_user_id, c.requested_by]), ...(events ?? []).map((e) => e.actor_id).filter(Boolean)])) as string[]
  const deptIds = Array.from(new Set((data ?? []).map((c) => c.department_id).filter(Boolean))) as string[]
  const [people, depts] = await Promise.all([
    personIds.length ? supabase.from('profiles').select('id, display_name').in('id', personIds) : Promise.resolve({ data: [] }),
    deptIds.length ? supabase.from('departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] }),
  ])
  const pn = new Map((people.data ?? []).map((p) => [p.id, p.display_name || 'Unnamed']))
  const dn = new Map((depts.data ?? []).map((d) => [d.id, d.name]))
  return {
    data: (data ?? []).map((c) => ({
      ...c, worker_name: pn.get(c.worker_user_id) ?? 'Unnamed worker', requester_name: pn.get(c.requested_by) ?? 'Unnamed', department_name: c.department_id ? dn.get(c.department_id) ?? '' : '',
      events: (events ?? []).filter((e) => e.case_id === c.id).map((e) => ({ id: e.id, actor_name: e.actor_id ? pn.get(e.actor_id) ?? 'Unnamed' : 'System', action: e.action, note: e.note, created_at: e.created_at })),
    })) as SuspensionCase[],
    error: null,
  }
}

export async function raiseSuspensionCase(workerUserId: string, reason: string, evidence: string) {
  if (reason.trim().length < 3) return { error: new Error('Say why you are asking for a suspension.') }
  const { error, status } = await supabase.from('suspension_cases').insert({ worker_user_id: workerUserId, reason: reason.trim(), evidence: evidence.trim() })
  return { error: error ? toError(error, status) : null }
}

/** Main Admin only (enforced by the database): continue the suspension, move to review, restore, or offboard. */
export async function decideSuspensionCase(id: string, status: Exclude<CaseStatus, 'pending'>, note: string) {
  const { data, error, status: http } = await supabase.from('suspension_cases').update({ status, decision_note: note.trim() }).eq('id', id).select('id')
  if (error) return { error: toError(error, http) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only a Main Admin can decide a suspension case.') }
  return { error: null }
}

/* ---- Task depth ------------------------------------------------------------------------------------------------------------------- */

export interface ChecklistItem { id: string; body: string; done: boolean; position: number }
export interface TaskComment { id: string; author_id: string; author_name: string; body: string; created_at: string }
export interface TaskDependency { depends_on_task_id: string; title: string; done: boolean }
export interface TaskLink { id: string; kind: string; url: string; label: string }
export interface TaskFile { id: string; name: string; storage_path: string; created_at: string }
export interface TaskDetail { checklist: ChecklistItem[]; comments: TaskComment[]; dependencies: TaskDependency[]; links: TaskLink[]; files: TaskFile[]; watching: boolean }

export async function loadTaskDetail(taskId: string, userId: string | undefined) {
  const [list, comments, deps, links, files, watchers] = await Promise.all([
    supabase.from('task_checklist_items').select('id, body, done, position').eq('task_id', taskId).order('position'),
    supabase.from('task_comments').select('id, author_id, body, created_at').eq('task_id', taskId).order('created_at'),
    supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', taskId),
    supabase.from('task_links').select('id, kind, url, label').eq('task_id', taskId),
    supabase.from('project_files').select('id, name, storage_path, created_at').eq('task_id', taskId),
    supabase.from('task_watchers').select('user_id').eq('task_id', taskId),
  ])
  const error = list.error ?? comments.error ?? deps.error ?? links.error ?? files.error ?? watchers.error
  if (error) return { data: null as TaskDetail | null, error: toError(error) }
  const authorIds = Array.from(new Set((comments.data ?? []).map((c) => c.author_id)))
  const depIds = (deps.data ?? []).map((d) => d.depends_on_task_id)
  const [people, depTasks] = await Promise.all([
    authorIds.length ? supabase.from('profiles').select('id, display_name').in('id', authorIds) : Promise.resolve({ data: [] }),
    depIds.length ? supabase.from('tasks').select('id, title, status').in('id', depIds) : Promise.resolve({ data: [] }),
  ])
  const pn = new Map((people.data ?? []).map((p) => [p.id, p.display_name || 'Unnamed']))
  const dt = new Map((depTasks.data ?? []).map((t) => [t.id, t]))
  return {
    data: {
      checklist: (list.data ?? []) as ChecklistItem[],
      comments: (comments.data ?? []).map((c) => ({ ...c, author_name: pn.get(c.author_id) ?? 'Unnamed' })) as TaskComment[],
      dependencies: depIds.map((id) => ({ depends_on_task_id: id, title: dt.get(id)?.title ?? 'A task you cannot see', done: dt.get(id)?.status === 'done' })),
      links: (links.data ?? []) as TaskLink[],
      files: (files.data ?? []) as TaskFile[],
      watching: !!userId && (watchers.data ?? []).some((w) => w.user_id === userId),
    },
    error: null,
  }
}

const done = (error: { message: string } | null, status?: number) => ({ error: error ? toError(error, status) : null })
export async function addChecklistItem(taskId: string, body: string, position: number) { const r = await supabase.from('task_checklist_items').insert({ task_id: taskId, body: body.trim(), position }); return done(r.error, r.status) }
export async function setChecklistDone(id: string, isDone: boolean) { const r = await supabase.from('task_checklist_items').update({ done: isDone }).eq('id', id).select('id'); return r.error ? done(r.error, r.status) : (r.data?.length ?? 0) === 0 ? { error: new Error("Only the assignee or a Department Admin can tick this.") } : { error: null } }
export async function removeChecklistItem(id: string) { const r = await supabase.from('task_checklist_items').delete().eq('id', id); return done(r.error, r.status) }
export async function addTaskComment(taskId: string, body: string) { if (!body.trim()) return { error: new Error('Write a comment first.') }; const r = await supabase.from('task_comments').insert({ task_id: taskId, body: body.trim() }); return done(r.error, r.status) }
export async function addTaskDependency(taskId: string, dependsOn: string) { const r = await supabase.from('task_dependencies').insert({ task_id: taskId, depends_on_task_id: dependsOn }); return done(r.error, r.status) }
export async function removeTaskDependency(taskId: string, dependsOn: string) { const r = await supabase.from('task_dependencies').delete().eq('task_id', taskId).eq('depends_on_task_id', dependsOn); return done(r.error, r.status) }
export async function setWatching(taskId: string, userId: string, watch: boolean) { const r = watch ? await supabase.from('task_watchers').insert({ task_id: taskId, user_id: userId }) : await supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', userId); return done(r.error, r.status) }
export async function setReviewState(taskId: string, state: 'none' | 'requested' | 'approved' | 'changes_requested') { const r = await supabase.from('tasks').update({ review_state: state }).eq('id', taskId).select('id'); return r.error ? done(r.error, r.status) : (r.data?.length ?? 0) === 0 ? { error: new Error("You can't change this task's review state.") } : { error: null } }

/** Only real GitHub links, so a link can't smuggle in another site as if it were a pull request. */
export function classifyGithubUrl(raw: string): { kind: 'pull_request' | 'issue' | 'branch' | 'commit' | 'other'; label: string } | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null
  const [owner, repo, type, ...rest] = u.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return null
  const base = `${owner}/${repo}`
  if (type === 'pull' && /^\d+$/.test(rest[0] ?? '')) return { kind: 'pull_request', label: `${base}#${rest[0]}` }
  if (type === 'issues' && /^\d+$/.test(rest[0] ?? '')) return { kind: 'issue', label: `${base}#${rest[0]}` }
  if (type === 'tree' && rest.length) return { kind: 'branch', label: `${base}:${rest.join('/')}` }
  if (type === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] ?? '')) return { kind: 'commit', label: `${base}@${rest[0].slice(0, 7)}` }
  return { kind: 'other', label: base }
}
export async function addTaskLink(taskId: string, url: string) {
  const c = classifyGithubUrl(url)
  if (!c) return { error: new Error('Paste a link to a GitHub pull request, issue, branch or commit.') }
  const r = await supabase.from('task_links').insert({ task_id: taskId, kind: c.kind, url: url.trim(), label: c.label }); return done(r.error, r.status)
}
export async function removeTaskLink(id: string) { const r = await supabase.from('task_links').delete().eq('id', id); return done(r.error, r.status) }

/* ---- Approvals inbox ------------------------------------------------------------------------------------------------------------- */

export interface ApprovalItems {
  assignmentsToAccept: { id: string; project_name: string; department_name: string; objective: string; deadline: string | null }[]
  assignmentsInReview: { id: string; project_name: string; department_name: string; objective: string }[]
  tasksToReview: { id: string; title: string; project_name: string; assignee_name: string | null; department_id: string | null }[]
  myChanges: { id: string; title: string; project_name: string }[]
}

/** Everything waiting on a decision, limited by row-level security to what the viewer may see. The page decides who acts on what. */
export async function loadApprovals(userId: string | undefined) {
  const [asg, tasks] = await Promise.all([
    supabase.from('project_departments').select('id, project_id, department_id, objective, deadline, status').in('status', ['assigned', 'in_review']).order('created_at'),
    supabase.from('tasks').select('id, title, project_id, assignee_id, department_id, review_state').in('review_state', ['requested', 'changes_requested']).neq('status', 'done').limit(200),
  ])
  const error = asg.error ?? tasks.error
  if (error) return { data: null as ApprovalItems | null, error: toError(error) }
  const projectIds = Array.from(new Set([...(asg.data ?? []).map((a) => a.project_id), ...(tasks.data ?? []).map((t) => t.project_id)]))
  const deptIds = Array.from(new Set((asg.data ?? []).map((a) => a.department_id)))
  const peopleIds = Array.from(new Set((tasks.data ?? []).map((t) => t.assignee_id).filter(Boolean) as string[]))
  const [projects, depts, people] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id, name').in('id', projectIds) : Promise.resolve({ data: [] }),
    deptIds.length ? supabase.from('departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] }),
    peopleIds.length ? supabase.from('profiles').select('id, display_name').in('id', peopleIds) : Promise.resolve({ data: [] }),
  ])
  const pn = new Map((projects.data ?? []).map((p) => [p.id, p.name as string]))
  const dn = new Map((depts.data ?? []).map((d) => [d.id, d.name as string]))
  const an = new Map((people.data ?? []).map((p) => [p.id, (p.display_name as string) || 'Unnamed']))
  return {
    data: {
      assignmentsToAccept: (asg.data ?? []).filter((a) => a.status === 'assigned').map((a) => ({ id: a.id, project_name: pn.get(a.project_id) ?? 'Project', department_name: dn.get(a.department_id) ?? '', objective: a.objective, deadline: a.deadline })),
      assignmentsInReview: (asg.data ?? []).filter((a) => a.status === 'in_review').map((a) => ({ id: a.id, project_name: pn.get(a.project_id) ?? 'Project', department_name: dn.get(a.department_id) ?? '', objective: a.objective })),
      tasksToReview: (tasks.data ?? []).filter((t) => t.review_state === 'requested').map((t) => ({ id: t.id, title: t.title, project_name: pn.get(t.project_id) ?? '', assignee_name: t.assignee_id ? an.get(t.assignee_id) ?? null : null, department_id: t.department_id })),
      myChanges: (tasks.data ?? []).filter((t) => t.review_state === 'changes_requested' && !!userId && t.assignee_id === userId).map((t) => ({ id: t.id, title: t.title, project_name: pn.get(t.project_id) ?? '' })),
    } as ApprovalItems,
    error: null,
  }
}
