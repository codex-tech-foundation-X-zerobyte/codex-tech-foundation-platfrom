import { supabase } from '../supabase'
import { toError } from './shared'
import { dateOf, eventsFromRecords, type CalendarEvent } from '../calendar'
import { DEPARTMENTS, isClosed } from '../../workspaces/definitions'

/* ---- Knowledge base ------------------------------------------------------------------------------------------------------ */

export const KB_CATEGORIES = ['Company', 'Development', 'Security', 'Design', 'Content', 'Marketing', 'Operations', 'Onboarding', 'Technical Documentation', 'Policies'] as const
export type KbCategory = (typeof KB_CATEGORIES)[number]

export interface KnowledgeDoc { id: string; title: string; category: KbCategory; department_id: string | null; body: string; author_id: string; author_name: string; updated_at: string; created_at: string }

/** Characters that would change the meaning of a PostgREST filter are removed from a search term. */
export const sanitizeSearch = (q: string) => q.replace(/[,()*%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export async function listKnowledge(opts: { departmentId?: string | null; category?: string; q?: string } = {}) {
  let query = supabase.from('knowledge_documents').select('id, title, category, department_id, body, author_id, updated_at, created_at').order('updated_at', { ascending: false }).limit(200)
  if (opts.departmentId === null) query = query.is('department_id', null)
  else if (opts.departmentId) query = query.eq('department_id', opts.departmentId)
  if (opts.category) query = query.eq('category', opts.category)
  const q = sanitizeSearch(opts.q ?? '')
  if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`)
  const { data, error } = await query
  if (error) return { data: [] as KnowledgeDoc[], error: toError(error) }
  const ids = Array.from(new Set((data ?? []).map((d) => d.author_id)))
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id, p.display_name]))
  return { data: (data ?? []).map((d) => ({ ...d, author_name: names.get(d.author_id) || 'Codex' })) as KnowledgeDoc[], error: null }
}

export async function saveKnowledge(input: { id?: string; title: string; category: KbCategory; department_id: string | null; body: string }) {
  const title = input.title.trim()
  if (!title) return { error: new Error('Give the document a title.') }
  if (input.body.length > 60000) return { error: new Error('That document is too long. Split it into two.') }
  const row = { title, category: input.category, department_id: input.department_id, body: input.body }
  const { data, error, status } = input.id
    ? await supabase.from('knowledge_documents').update(row).eq('id', input.id).select('id')
    : await supabase.from('knowledge_documents').insert(row).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to change this document.") }
  return { error: null }
}

export async function deleteKnowledge(id: string) {
  const { data, error, status } = await supabase.from('knowledge_documents').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to delete this document.") }
  return { error: null }
}

/* ---- Meetings --------------------------------------------------------------------------------------------------------------- */

export interface Meeting {
  id: string; title: string; project_id: string | null; department_id: string | null; starts_at: string; ends_at: string
  location: string; agenda: string; notes: string; recording_url: string; created_by: string
}
export interface MeetingDetail extends Meeting {
  participants: { user_id: string; name: string }[]
  actions: { id: string; body: string; assignee_id: string | null; assignee_name: string | null; due_date: string | null; done: boolean }[]
}

export async function listMeetings(fromISO: string, toISO: string) {
  const { data, error } = await supabase.from('meetings').select('*').gte('starts_at', `${fromISO}T00:00:00`).lte('starts_at', `${toISO}T23:59:59.999`).order('starts_at')
  return { data: (data ?? []) as Meeting[], error: error ? toError(error) : null }
}

export async function getMeeting(id: string) {
  const [m, parts, acts] = await Promise.all([
    supabase.from('meetings').select('*').eq('id', id).maybeSingle(),
    supabase.from('meeting_participants').select('user_id').eq('meeting_id', id),
    supabase.from('meeting_action_items').select('*').eq('meeting_id', id).order('created_at'),
  ])
  const error = m.error ?? parts.error ?? acts.error
  if (error || !m.data) return { data: null as MeetingDetail | null, error: error ? toError(error) : new Error('Meeting not found.') }
  const ids = Array.from(new Set([...(parts.data ?? []).map((p) => p.user_id), ...(acts.data ?? []).map((a) => a.assignee_id).filter(Boolean) as string[]]))
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id, p.display_name || 'Unnamed']))
  return {
    data: {
      ...(m.data as Meeting),
      participants: (parts.data ?? []).map((p) => ({ user_id: p.user_id, name: names.get(p.user_id) ?? 'Unnamed' })),
      actions: (acts.data ?? []).map((a) => ({ id: a.id, body: a.body, assignee_id: a.assignee_id, assignee_name: a.assignee_id ? names.get(a.assignee_id) ?? 'Unnamed' : null, due_date: a.due_date, done: a.done })),
    } as MeetingDetail,
    error: null,
  }
}

export interface NewMeeting { title: string; starts_at: string; ends_at: string; location: string; agenda: string; department_id: string | null; project_id: string | null; participants: string[] }

export async function createMeeting(input: NewMeeting) {
  if (!input.title.trim()) return { error: new Error('Give the meeting a title.') }
  if (new Date(input.ends_at) <= new Date(input.starts_at)) return { error: new Error('A meeting must end after it starts.') }
  const { participants, ...row } = input
  const { data, error, status } = await supabase.from('meetings').insert({ ...row, title: row.title.trim() }).select('id').single()
  if (error || !data) return { error: toError(error ?? new Error('Could not create the meeting.'), status) }
  if (participants.length) {
    const { error: pErr } = await supabase.from('meeting_participants').insert(participants.map((user_id) => ({ meeting_id: data.id, user_id })))
    if (pErr) return { error: new Error(`The meeting was created, but inviting people failed: ${pErr.message}`) }
  }
  return { error: null }
}

export async function updateMeeting(id: string, patch: Partial<Pick<Meeting, 'notes' | 'agenda' | 'recording_url' | 'location' | 'title'>>) {
  const { data, error, status } = await supabase.from('meetings').update(patch).eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only the organiser or a Department Admin can change this meeting.') }
  return { error: null }
}
export async function deleteMeeting(id: string) {
  const { data, error, status } = await supabase.from('meetings').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only the organiser or a Department Admin can delete this meeting.') }
  return { error: null }
}
export async function addActionItem(meetingId: string, body: string, assigneeId: string | null, due: string | null) {
  if (!body.trim()) return { error: new Error('Describe the action.') }
  const { error, status } = await supabase.from('meeting_action_items').insert({ meeting_id: meetingId, body: body.trim(), assignee_id: assigneeId, due_date: due })
  return { error: error ? toError(error, status) : null }
}
export async function setActionItemDone(id: string, done: boolean) {
  const { data, error, status } = await supabase.from('meeting_action_items').update({ done }).eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You can only tick off actions assigned to you, or in a meeting you organise.") }
  return { error: null }
}

/** People who can be invited: every internal account that is not offboarded. */
export async function listInvitablePeople() {
  const { data, error } = await supabase.from('profiles').select('id, display_name, role').in('role', ['worker', 'manager', 'superadmin']).order('display_name')
  return { data: (data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) || 'Unnamed' })), error: error ? toError(error) : null }
}

/* ---- Company calendar --------------------------------------------------------------------------------------------------------- */

/**
 * Everything dated that the viewer is allowed to see, from real tables: meetings, department deadlines, task due dates, and
 * the dates on department records (publishing, campaigns, domain expiry...). Row-level security decides what comes back.
 */
export async function listCalendarEvents(from: string, to: string) {
  const [meetings, assignments, tasks, records] = await Promise.all([
    supabase.from('meetings').select('id, title, starts_at, location').gte('starts_at', `${from}T00:00:00`).lte('starts_at', `${to}T23:59:59.999`),
    supabase.from('project_departments').select('id, project_id, objective, deadline').neq('status', 'completed').gte('deadline', from).lte('deadline', to),
    supabase.from('tasks').select('id, title, due_date').neq('status', 'done').gte('due_date', from).lte('due_date', to),
    supabase.from('department_records').select('id, kind, title, stage, fields, due_date').limit(3000),
  ])
  const error = meetings.error ?? assignments.error ?? tasks.error ?? records.error
  if (error) return { data: [] as CalendarEvent[], error: toError(error) }
  const projectIds = Array.from(new Set((assignments.data ?? []).map((a) => a.project_id)))
  const { data: projects } = projectIds.length ? await supabase.from('projects').select('id, name').in('id', projectIds) : { data: [] }
  const pn = new Map((projects ?? []).map((p) => [p.id, p.name]))
  const kinds = new Map(DEPARTMENTS.flatMap((d) => d.recordKinds).map((k) => [k.kind, k]))
  const events: CalendarEvent[] = [
    ...(meetings.data ?? []).map((m) => ({ id: `m:${m.id}`, date: dateOf(m.starts_at), time: new Date(m.starts_at).toTimeString().slice(0, 5), title: m.title, detail: m.location || 'Meeting', group: 'meeting' as const })),
    ...(assignments.data ?? []).map((a) => ({ id: `a:${a.id}`, date: a.deadline as string, title: pn.get(a.project_id) ?? 'Project', detail: `Deadline · ${a.objective}`, group: 'deadline' as const })),
    ...(tasks.data ?? []).map((t) => ({ id: `t:${t.id}`, date: t.due_date as string, title: t.title, detail: 'Task due', group: 'task' as const })),
    ...eventsFromRecords((records.data ?? []) as never, from, to, (k) => kinds.get(k), isClosed),
  ]
  return { data: events, error: null }
}

/* ---- Onboarding --------------------------------------------------------------------------------------------------------------- */

export async function listOnboardingProgress(userId: string) {
  const { data, error } = await supabase.from('onboarding_progress').select('item_key').eq('user_id', userId)
  return { data: new Set((data ?? []).map((r) => r.item_key as string)), error: error ? toError(error) : null }
}
export async function setOnboardingItem(userId: string, key: string, done: boolean) {
  const { error, status } = done
    ? await supabase.from('onboarding_progress').upsert({ user_id: userId, item_key: key }, { onConflict: 'user_id,item_key', ignoreDuplicates: true })
    : await supabase.from('onboarding_progress').delete().eq('user_id', userId).eq('item_key', key)
  return { error: error ? toError(error, status) : null }
}

/** Dated records of one department (content publishing, campaign dates, domain expiry...) for its own calendar tool. */
export async function listDepartmentCalendar(departmentId: string, from: string, to: string) {
  const { data, error } = await supabase.from('department_records').select('id, kind, title, stage, fields, due_date').eq('department_id', departmentId).limit(3000)
  if (error) return { data: [] as CalendarEvent[], error: toError(error) }
  const kinds = new Map(DEPARTMENTS.flatMap((d) => d.recordKinds).map((k) => [k.kind, k]))
  return { data: eventsFromRecords((data ?? []) as never, from, to, (k) => kinds.get(k), isClosed), error: null }
}

/* ---- Department files (brand assets, media, final assets, design versions) ----------------------------------------------------- */

export interface DepartmentFile { id: string; title: string; description: string | null; category: string; storage_path: string | null; url: string | null; mime_type: string | null; size_bytes: number | null; created_at: string; owner_id: string | null }
export async function listDepartmentFiles(departmentId: string, category: string) {
  const { data, error } = await supabase.from('resources').select('id, title, description, category, storage_path, url, mime_type, size_bytes, created_at, owner_id').eq('department_id', departmentId).eq('category', category).is('archived_at', null).order('created_at', { ascending: false })
  return { data: (data ?? []) as DepartmentFile[], error: error ? toError(error) : null }
}
