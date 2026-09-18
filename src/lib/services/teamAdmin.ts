import { supabase } from '../supabase'
import type { TeamProfile } from '../types'
import { storage, toError } from './shared'

export async function listAllTeamProfiles() {
  const { data, error } = await supabase.from('team_profiles').select('*').order('display_order', { ascending: true })
  return { data: (data ?? []) as TeamProfile[], error: toError(error) }
}

export async function getTeamProfileById(id: string) {
  const { data, error } = await supabase.from('team_profiles').select('*').eq('id', id).maybeSingle()
  return { data: data as TeamProfile | null, error: toError(error) }
}

export type TeamProfileDraft = Pick<TeamProfile, 'display_name' | 'public_title' | 'bio' | 'skills' | 'display_order'>

export async function createTeamProfile(input: TeamProfileDraft) {
  const { data, error } = await supabase.from('team_profiles').insert(input).select('*').single()
  return { data: data as TeamProfile | null, error: toError(error) }
}

export async function updateTeamProfile(id: string, input: Partial<TeamProfileDraft>) {
  const { error } = await supabase.from('team_profiles').update(input).eq('id', id)
  return { error: toError(error) }
}

export async function setTeamProfileVisibility(id: string, isPublic: boolean) {
  const { error } = await supabase.from('team_profiles').update({ is_public: isPublic }).eq('id', id)
  return { error: toError(error) }
}

export async function setTeamProfileFeatured(id: string, featured: boolean) {
  const { error } = await supabase.from('team_profiles').update({ featured }).eq('id', id)
  return { error: toError(error) }
}

export async function deleteTeamProfile(id: string) {
  const { error } = await supabase.from('team_profiles').delete().eq('id', id)
  return { error: toError(error) }
}

// The public Team page reads `photo_path` and must actually render it — this
// uploads to the public-content bucket (already public/read-anywhere) and
// writes the resulting path onto the profile row in one step.
export async function uploadTeamPhoto(id: string, file: File) {
  const path = `team/${id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await storage.upload('public-content', path, file)
  if (uploadError) return { error: toError(uploadError) }
  const { error } = await supabase.from('team_profiles').update({ photo_path: path }).eq('id', id)
  return { error: toError(error) }
}
