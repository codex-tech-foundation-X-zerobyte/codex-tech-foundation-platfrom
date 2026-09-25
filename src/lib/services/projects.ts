import { supabase } from '../supabase'
import type { Project, ProjectMilestone, ProjectUpdate } from '../types'
import { toError } from './shared'
import { ensureProjectChannel } from './chat'

export async function listPublishedProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('publication_status', 'published')
    .eq('public_visibility', true)
    .is('archived_at', null)
    .order('published_at', { ascending: false })
  return { data: (data ?? []) as Project[], error: toError(error) }
}

export async function getPublishedProjectBySlug(slug: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .eq('publication_status', 'published')
    .maybeSingle()
  return { data: data as Project | null, error: toError(error) }
}

/** Projects visible to the current authenticated user per RLS (owner, client, member, or admin). */
export async function listMyProjects() {
  const { data, error } = await supabase.from('projects').select('*').is('archived_at', null).order('updated_at', { ascending: false })
  return { data: (data ?? []) as Project[], error: toError(error) }
}

export async function getProject(id: string) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
  return { data: data as Project | null, error: toError(error) }
}

export async function listProjectMilestones(projectId: string) {
  const { data, error } = await supabase
    .from('project_milestones')
    .select('*')
    .eq('project_id', projectId)
    .order('display_order', { ascending: true })
  return { data: (data ?? []) as ProjectMilestone[], error: toError(error) }
}

export async function listProjectUpdates(projectId: string) {
  const { data, error } = await supabase
    .from('project_updates')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  return { data: (data ?? []) as ProjectUpdate[], error: toError(error) }
}

export async function archiveProject(id: string) {
  const { error } = await supabase.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

export interface CreateProjectInput {
  name: string
  description?: string
  due_date?: string | null
  client_account_id?: string | null
  member_user_ids?: string[]
}

// Creates the project row, adds the creator + any chosen teammates as
// project_members, and provisions the project's chat channel — all in one
// call, so "create a project" actually produces a usable project rather
// than a bare row nobody else can see activity in. ensureProjectChannel()
// (chat.ts) is idempotent, matching the brief's "do not create duplicate
// channels if the operation is retried" requirement for free.
export async function createProject(input: CreateProjectInput) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null as Project | null, error: new Error('Not signed in.') }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      description: input.description ?? '',
      due_date: input.due_date ?? null,
      client_account_id: input.client_account_id ?? null,
      owner_id: user.id,
    })
    .select('*')
    .single()
  if (error || !project) return { data: null as Project | null, error: toError(error) }

  const memberIds = Array.from(new Set([user.id, ...(input.member_user_ids ?? [])]))
  await supabase.from('project_members').insert(memberIds.map((user_id) => ({ project_id: project.id, user_id })))

  await ensureProjectChannel(project as Project)

  return { data: project as Project, error: null }
}

export async function updateProject(id: string, input: Partial<Pick<Project, 'name' | 'description' | 'status' | 'due_date'>>) {
  const { error } = await supabase.from('projects').update(input).eq('id', id)
  return { error: toError(error) }
}

export async function listProjectMembers(projectId: string) {
  const { data, error } = await supabase.from('project_members').select('user_id').eq('project_id', projectId)
  return { data: (data ?? []).map((r) => r.user_id as string), error: toError(error) }
}

export async function addProjectMember(projectId: string, userId: string) {
  const { error } = await supabase.from('project_members').insert({ project_id: projectId, user_id: userId })
  return { error: toError(error) }
}

export async function removeProjectMember(projectId: string, userId: string) {
  const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId)
  return { error: toError(error) }
}
