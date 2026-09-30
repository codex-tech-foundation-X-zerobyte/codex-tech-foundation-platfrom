import { supabase } from '../supabase'
import type { BlogPost } from '../types'
import { toError } from './shared'

export async function listAllBlogPosts() {
  const { data, error } = await supabase.from('blog_posts').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as BlogPost[], error: toError(error) }
}

export async function getBlogPostById(id: string) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).maybeSingle()
  return { data: data as BlogPost | null, error: toError(error) }
}

export type BlogPostDraft = Pick<BlogPost, 'slug' | 'title' | 'excerpt' | 'body'>

export async function createBlogPost(input: BlogPostDraft) {
  const { data, error } = await supabase.from('blog_posts').insert(input).select('*').single()
  return { data: data as BlogPost | null, error: toError(error) }
}

export async function updateBlogPost(id: string, input: Partial<BlogPostDraft>) {
  const { error } = await supabase.from('blog_posts').update(input).eq('id', id)
  return { error: toError(error) }
}

export async function setBlogPostPublished(id: string, published: boolean) {
  const { error } = await supabase.from('blog_posts').update({ published_at: published ? new Date().toISOString() : null }).eq('id', id)
  return { error: toError(error) }
}

export async function archiveBlogPost(id: string) {
  const { error } = await supabase.from('blog_posts').update({ archived_at: new Date().toISOString() }).eq('id', id)
  return { error: toError(error) }
}
