import { supabase } from '../supabase'
import type { CaseStudy, PublicationStatus } from '../types'
import { toError } from './shared'

export async function listAllCaseStudies() {
  const { data, error } = await supabase.from('case_studies').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as CaseStudy[], error: toError(error) }
}

export async function getCaseStudyById(id: string) {
  const { data, error } = await supabase.from('case_studies').select('*').eq('id', id).maybeSingle()
  return { data: data as CaseStudy | null, error: toError(error) }
}

export type CaseStudyDraft = Pick<
  CaseStudy,
  'slug' | 'title' | 'summary' | 'problem' | 'goals' | 'approach' | 'challenges' | 'solution' | 'results' | 'technologies' | 'seo_title' | 'seo_description'
>

export async function createCaseStudy(input: CaseStudyDraft) {
  const { data, error } = await supabase.from('case_studies').insert(input).select('*').single()
  return { data: data as CaseStudy | null, error: toError(error) }
}

export async function updateCaseStudy(id: string, input: Partial<CaseStudyDraft>) {
  const { error } = await supabase.from('case_studies').update(input).eq('id', id)
  return { error: toError(error) }
}

export async function setCaseStudyStatus(id: string, status: PublicationStatus) {
  const patch: Record<string, unknown> = { publication_status: status }
  if (status === 'published') patch.published_at = new Date().toISOString()
  const { error } = await supabase.from('case_studies').update(patch).eq('id', id)
  return { error: toError(error) }
}

export async function setCaseStudyFeatured(id: string, featured: boolean) {
  const { error } = await supabase.from('case_studies').update({ featured }).eq('id', id)
  return { error: toError(error) }
}
