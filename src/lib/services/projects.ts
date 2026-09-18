import { supabase } from '../supabase'
import type { Project, ProjectMilestone, ProjectUpdate } from '../types'
import { toError } from './shared'

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
