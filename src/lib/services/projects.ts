import { supabase } from '../supabase'
import type { Project, ProjectMilestone, ProjectUpdate } from '../types'
import { getCurrentUserId, storage, toError } from './shared'
import { storageKey } from '../storagePath'

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

/**
 * The signed-in CLIENT's own projects. listMyProjects() is wrong for clients: RLS also lets everyone read
 * published public showcase projects, so `data[0]` could be somebody else's marketing project.
 * Uses the my_client_projects() RPC (migration 20260923000000); falls back to a client_id filter if that
 * migration hasn't been applied yet so the page degrades instead of breaking.
 */
export async function listMyClientProjects() {
  const rpc = await supabase.rpc('my_client_projects')
  if (!rpc.error) return { data: (rpc.data ?? []) as Project[], error: null as Error | null }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: [] as Project[], error: new Error('Not signed in') }
  const { data, error } = await supabase.from('projects').select('*').is('archived_at', null).eq('client_id', user.id).order('updated_at', { ascending: false })
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

export async function updateProjectStatus(id: string, status: Project['status']) {
  const { error } = await supabase.from('projects').update({ status }).eq('id', id)
  return { error: toError(error) }
}

export async function createMilestone(input: { project_id: string; title: string; description: string; target_date: string | null }) {
  const { error } = await supabase.from('project_milestones').insert({ ...input, status: 'planned', percentage: 0, is_public: false })
  return { error: toError(error) }
}

export async function updateMilestone(id: string, input: { status?: string; percentage?: number }) {
  const patch: Record<string, unknown> = { ...input }
  if (input.status === 'complete') patch.completed_date = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('project_milestones').update(patch).eq('id', id)
  return { error: toError(error) }
}

export async function publishProjectUpdate(input: { project_id: string; title: string; body: string }) {
  // The author must be the signed-in user: the INSERT policy requires author_id = auth.uid(). Sending `null` when the
  // session lookup failed (as this used to) guaranteed a 403 whose cause was invisible. Fail early with the real reason.
  const userId = await getCurrentUserId()
  if (!userId) return { error: new Error('Your session has expired. Please sign in again.') }
  if (!input.title.trim() || !input.body.trim()) return { error: new Error('An update needs a title and a message.') }
  const { error, status } = await supabase
    .from('project_updates')
    .insert({ ...input, title: input.title.trim(), body: input.body.trim(), author_id: userId, published_at: new Date().toISOString() })
  return { error: toError(error, status) }
}

export interface ProjectFile {
  id: string
  project_id: string
  uploaded_by: string | null
  name: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export async function listProjectFiles(projectId: string) {
  const { data, error } = await supabase.from('project_files').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  return { data: (data ?? []) as ProjectFile[], error: toError(error) }
}

export async function uploadProjectFile(projectId: string, file: File) {
  const userId = await getCurrentUserId()
  if (!userId) return { error: new Error('Your session has expired. Please sign in again.') }
  // The storage KEY is made safe (see safeFileName); the person's original file name is kept for display in the row below.
  const path = storageKey([projectId], file.name)
  const { error: uploadError } = await storage.upload('private-project-files', path, file)
  if (uploadError) return { error: uploadError } // the real reason: too large / not permitted / bad type...
  const { error, status } = await supabase.from('project_files').insert({
    project_id: projectId, name: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size, uploaded_by: userId,
  })
  if (error) {
    await storage.remove('private-project-files', [path]) // don't leave an orphaned object behind when the record is refused
    return { error: toError(error, status) }
  }
  return { error: null }
}

export async function getProjectFileUrl(path: string) {
  return storage.getSignedUrl('private-project-files', path, 300)
}

export async function deleteProjectFile(id: string, storagePath: string) {
  const { error } = await supabase.from('project_files').delete().eq('id', id)
  if (!error) await storage.remove('private-project-files', [storagePath])
  return { error: toError(error) }
}

export interface CreateProjectInput {
  name: string
  description: string
  status: Project['status']
  client_account_id?: string | null
  due_date?: string | null
}

/**
 * Creates a project and adds the creator as a project member so they can
 * see it immediately under RLS's "projects visible to members" policy (the
 * owner_id check alone already covers this, but explicit membership matters
 * once other workers are assigned later — see project_members).
 */
export async function createProject(input: CreateProjectInput) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('You must be signed in to create a project.') }

  const { data, error } = await supabase
    .from('projects')
    .insert({ ...input, owner_id: user.id })
    .select('*')
    .single()
  if (error || !data) return { data: null, error: toError(error) ?? new Error('Could not create the project.') }

  const { error: memberError } = await supabase.from('project_members').insert({ project_id: data.id, user_id: user.id })
  // Membership failure shouldn't hide a successful project creation from the
  // caller — the project exists either way (owner_id already grants access).
  // Surface it as a distinct, non-fatal warning instead of swallowing it.
  return { data: data as Project, error: null, memberWarning: memberError ? toError(memberError) : null }
}
