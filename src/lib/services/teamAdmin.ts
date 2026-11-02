import { supabase } from '../supabase'
import type { TeamProfile } from '../types'
import { storage, toError } from './shared'
import { safeFileName } from '../storagePath'

export async function listAllTeamProfiles() {
  const { data, error } = await supabase.from('team_profiles').select('*').order('display_order', { ascending: true })
  return { data: (data ?? []) as TeamProfile[], error: toError(error) }
}

export async function getTeamProfileById(id: string) {
  const { data, error } = await supabase.from('team_profiles').select('*').eq('id', id).maybeSingle()
  return { data: data as TeamProfile | null, error: toError(error) }
}

export type TeamProfileDraft = Pick<TeamProfile, 'display_name' | 'public_title' | 'bio' | 'display_order'>

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

/** The photo file stays until the trash is purged, so restoring brings the profile back with its picture. */
export async function deleteTeamProfile(id: string) {
  const { data, error, status } = await supabase.from('team_profiles').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to remove this team member, or they were already removed.") }
  return { error: null }
}

/** Uploads to the public-content bucket (team photos are meant to be publicly visible) and stores the public URL's path. */
export async function uploadTeamPhoto(profileId: string, file: File) {
  const path = `team/${profileId}-${Date.now()}-${safeFileName(file.name)}`
  const { error: uploadError } = await storage.upload('public-content', path, file)
  if (uploadError) return { error: uploadError }
  const { error } = await supabase.from('team_profiles').update({ photo_path: path }).eq('id', profileId)
  return { error: toError(error) }
}

export function getTeamPhotoUrl(photoPath: string | null) {
  if (!photoPath) return null
  return storage.getPublicUrl('public-content', photoPath)
}
