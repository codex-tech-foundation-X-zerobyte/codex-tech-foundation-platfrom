import { supabase } from '../supabase'
import { toError } from './shared'
import type { ProjectMilestone } from '../types'

export interface RecentUpdate { id: string; title: string; project_id: string; project_name: string; created_at: string; published_at: string | null }

/** The newest project updates across every project the caller can see (RLS decides which). */
export async function listRecentProjectUpdates(limit = 8) {
  const { data, error, status } = await supabase
    .from('project_updates')
    .select('id, title, project_id, created_at, published_at, projects(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = ((data ?? []) as unknown as { id: string; title: string; project_id: string; created_at: string; published_at: string | null; projects: { name: string } | { name: string }[] | null }[]).map((r) => ({
    id: r.id, title: r.title, project_id: r.project_id, created_at: r.created_at, published_at: r.published_at,
    project_name: (Array.isArray(r.projects) ? r.projects[0]?.name : r.projects?.name) ?? 'A project',
  }))
  return { data: rows as RecentUpdate[], error: toError(error, status) }
}

/** Milestones for several projects in ONE query (instead of one request per project). */
export async function listMilestonesForProjects(projectIds: string[]) {
  if (projectIds.length === 0) return { data: [] as ProjectMilestone[], error: null }
  const { data, error, status } = await supabase.from('project_milestones').select('*').in('project_id', projectIds)
  return { data: (data ?? []) as ProjectMilestone[], error: toError(error, status) }
}

/** How many rows have each value of `column` — e.g. leads by status. Capped so it can never become a huge download. */
export async function getStatusCounts(table: string, column: string, limit = 5000) {
  const { data, error, status } = await supabase.from(table).select(column).limit(limit)
  const counts: Record<string, number> = {}
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = String(row[column] ?? 'unknown')
    counts[key] = (counts[key] ?? 0) + 1
  }
  return { data: counts, error: toError(error, status) }
}

/** Blog posts visitors can actually read — the same rule as the public blog (published, not archived). */
export async function countPublishedPosts() {
  const { count, error, status } = await supabase
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .not('published_at', 'is', null)
    .is('archived_at', null)
  return { data: count ?? 0, error: toError(error, status) }
}
