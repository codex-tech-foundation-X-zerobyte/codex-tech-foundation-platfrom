import { listBlogPosts, listCareers, listCaseStudies, listPublicTeam } from '../lib/services'
import type { BlogPost, Career, CaseStudy, TeamProfile } from '../lib/types'
import { useAsyncData } from './useAsyncData'

export interface LandingContent { posts: BlogPost[]; work: CaseStudy[]; roles: Career[]; team: TeamProfile[] }

async function loadLive() {
  // Each list already resolves to [] on failure, so one broken source can't blank the others — and the public page
  // never shows an error state for optional content; a section with nothing to show simply doesn't render.
  const [posts, work, roles, team] = await Promise.all([listBlogPosts(), listCaseStudies(), listCareers(), listPublicTeam()])
  return { data: { posts: posts.data, work: work.data, roles: roles.data, team: team.data } as LandingContent, error: null }
}

export function useLandingContent(): LandingContent | null {
  const { data } = useAsyncData('landing-live', loadLive)
  return data
}
