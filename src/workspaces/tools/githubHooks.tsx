import { Link } from 'react-router'
import { GitBranch } from 'lucide-react'
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui'
import { githubRepos, loadIntegrationState, type GithubRepo } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Viewer } from '../DepartmentWork'

export const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Shared gate: GitHub connected? Any repositories linked to this department? Otherwise say exactly what is missing. */
export function useRepositories(base: '/worker' | '/admin', viewer: Viewer) {
  const state = useAsyncData('integration-state', loadIntegrationState)
  const connected = state.data?.github?.status === 'connected'
  const repos = useAsyncData(`gh-repos:${connected}`, async () => {
    if (!connected) return { data: { repos: [] as GithubRepo[] }, error: null }
    const r = await githubRepos()
    return { data: r.data ?? { repos: [] as GithubRepo[] }, error: r.error }
  })
  const hubLink = viewer.isMainAdmin ? <Link to={`${base}/integrations`}>Open Integrations</Link> : null

  let gate: React.ReactNode = null
  if (state.loading || (connected && repos.loading)) gate = <SkeletonRows rows={3} />
  else if (!connected) gate = <EmptyState icon={GitBranch} title="GitHub is not connected" description={viewer.isMainAdmin ? 'Connect GitHub in the Integrations hub to browse repositories, pull requests and CI here.' : 'A Main Admin needs to connect GitHub before repositories appear here.'} action={hubLink ?? undefined} />
  else if (repos.error) gate = <ErrorState title="GitHub couldn't be reached" description={repos.errorDetail?.message ?? 'Try again.'} onRetry={repos.reload} />
  else if ((repos.data?.repos ?? []).length === 0) gate = <EmptyState icon={GitBranch} title="No repositories linked to this department" description={viewer.isMainAdmin ? 'Link a repository to this department in the Integrations hub.' : 'Ask a Main Admin to link your department\u2019s repositories. You only see repositories linked to your department.'} action={hubLink ?? undefined} />
  return { gate, repos: (repos.data?.repos ?? []).filter((r) => !r.error), broken: (repos.data?.repos ?? []).filter((r) => r.error), reload: repos.reload }
}
