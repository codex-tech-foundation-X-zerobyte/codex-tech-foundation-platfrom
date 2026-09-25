import { supabase } from '../supabase'
import type { BlogPost, CaseStudy, Career, TeamProfile } from '../types'
import { toError } from './shared'

export async function listBlogPosts() {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .not('published_at', 'is', null)
    .is('archived_at', null)
    .order('published_at', { ascending: false })
  return { data: (data ?? []) as BlogPost[], error: toError(error) }
}

export async function getBlogPost(slug: string) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('slug', slug).not('published_at', 'is', null).maybeSingle()
  return { data: data as BlogPost | null, error: toError(error) }
}

export async function listCaseStudies() {
  const { data, error } = await supabase
    .from('case_studies')
    .select('*')
    .eq('publication_status', 'published')
    .order('published_at', { ascending: false })
  return { data: (data ?? []) as CaseStudy[], error: toError(error) }
}

export async function getCaseStudy(slug: string) {
  const { data, error } = await supabase.from('case_studies').select('*').eq('slug', slug).eq('publication_status', 'published').maybeSingle()
  return { data: data as CaseStudy | null, error: toError(error) }
}

export async function listCareers() {
  const { data, error } = await supabase
    .from('careers')
    .select('*')
    .not('published_at', 'is', null)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  return { data: (data ?? []) as Career[], error: toError(error) }
}

export async function getCareer(slug: string) {
  const { data, error } = await supabase.from('careers').select('*').eq('slug', slug).not('published_at', 'is', null).maybeSingle()
  return { data: data as Career | null, error: toError(error) }
}

export async function listPublicTeam() {
  const { data, error } = await supabase
    .from('team_profiles')
    .select('*')
    .eq('is_public', true)
    .order('display_order', { ascending: true })
  return { data: (data ?? []) as TeamProfile[], error: toError(error) }
}

export async function submitJobApplication(input: {
  career_id: string
  name: string
  email: string
  cover_note: string
  resume_path?: string | null
}) {
  const { error } = await supabase.functions.invoke('submit-job-application', { body: input })
  return { error: error ? new Error('Unable to submit your application right now.') : null }
}

/**
 * Uploads a résumé to the private `applications` bucket without ever giving the
 * anonymous applicant direct write access to it: an edge function mints a
 * single-use signed upload URL scoped to one random path, then the file is
 * uploaded straight to that URL. Returns the storage path to attach to the
 * application, or an error if the file type isn't accepted.
 */
export async function uploadResume(file: File) {
  const { data, error } = await supabase.functions.invoke('create-resume-upload-url', { body: { filename: file.name } })
  if (error || !data?.path || !data?.token) {
    return { path: null, error: new Error('Please upload a PDF or Word document.') }
  }
  const { error: uploadError } = await supabase.storage.from('applications').uploadToSignedUrl(data.path, data.token, file)
  if (uploadError) return { path: null, error: new Error('Unable to upload your résumé right now.') }
  return { path: data.path as string, error: null }
}
