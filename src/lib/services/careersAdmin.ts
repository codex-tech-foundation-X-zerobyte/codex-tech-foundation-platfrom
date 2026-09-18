import { supabase } from '../supabase'
import type { ApplicationStatus, Career, JobApplication } from '../types'
import { toError } from './shared'

export async function listAllCareers() {
  const { data, error } = await supabase.from('careers').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as Career[], error: toError(error) }
}

export async function getCareerById(id: string) {
  const { data, error } = await supabase.from('careers').select('*').eq('id', id).maybeSingle()
  return { data: data as Career | null, error: toError(error) }
}

export type CareerDraft = Pick<Career, 'slug' | 'title' | 'team' | 'location' | 'employment_type' | 'description' | 'requirements'>

export async function createCareer(input: CareerDraft) {
  const { data, error } = await supabase.from('careers').insert(input).select('*').single()
  return { data: data as Career | null, error: toError(error) }
}

export async function updateCareer(id: string, input: Partial<CareerDraft>) {
  const { error } = await supabase.from('careers').update(input).eq('id', id)
  return { error: toError(error) }
}

export async function setCareerPublished(id: string, published: boolean) {
  const { error } = await supabase.from('careers').update({ published_at: published ? new Date().toISOString() : null }).eq('id', id)
  return { error: toError(error) }
}

export async function archiveCareer(id: string) {
  const { error } = await supabase.from('careers').update({ archived_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}

// Applications review — the review half of §28. Resume access stays behind
// the private `applications` bucket + signed URLs (see storage helper in
// shared.ts); nothing here exposes a public resume URL.
export async function listApplications(careerId?: string) {
  let query = supabase.from('applications').select('*').order('created_at', { ascending: false })
  if (careerId) query = query.eq('career_id', careerId)
  const { data, error } = await query
  return { data: (data ?? []) as JobApplication[], error: toError(error) }
}

export async function updateApplicationStatus(id: string, status: ApplicationStatus) {
  const { error } = await supabase.from('applications').update({ status }).eq('id', id)
  return { error: toError(error) }
}
