import { Building2 } from 'lucide-react'
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui'
import { getMyDepartment } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { departmentBySlug } from '../../workspaces/definitions'
import { DepartmentEnvironment } from '../../workspaces/DepartmentEnvironment'
import { DepartmentToolPage } from '../../workspaces/DepartmentToolPage'
import { useParams } from 'react-router'

/** The signed-in worker's own department environment. Which one they get follows from the department they were assigned. */
export function WorkerDepartment() {
  useDocumentTitle('My department')
  const { profile } = useAuth()
  const mine = useAsyncData(`my-dept:${profile?.id}`, () => (profile ? getMyDepartment(profile.id) : Promise.resolve({ data: null, error: null })))

  if (mine.loading) return <SkeletonRows rows={4} height="64px" />
  if (mine.error) return <ErrorState title="Your department couldn't load" description={mine.errorDetail?.message ?? 'Try again in a moment.'} onRetry={mine.reload} />

  const department = mine.data?.department ?? null
  if (!department) return <EmptyState icon={Building2} title="You haven't been assigned to a department yet" description="A Main Admin assigns each worker to a department. Once that's done, your department's workspace, tools and boards appear here." />

  const def = departmentBySlug(department.slug)
  if (!def) return <EmptyState icon={Building2} title={`${department.name} has no workspace yet`} description="This department was created before departments shipped with Codex Workspace, so it has no environment. Ask a Main Admin to move you to one of the Codex departments." />

  return <DepartmentEnvironment def={def} row={department} base="/worker" viewerIsDepartmentAdmin={mine.data?.role === 'admin'} viewerId={profile?.id} />
}

/** One tool inside the worker's own department. */
export function WorkerDepartmentToolPage() {
  const { toolId } = useParams()
  const { profile } = useAuth()
  const mine = useAsyncData(`my-dept:${profile?.id}`, () => (profile ? getMyDepartment(profile.id) : Promise.resolve({ data: null, error: null })))
  if (mine.loading) return <SkeletonRows rows={4} height="64px" />
  if (mine.error) return <ErrorState title="Your department couldn't load" description={mine.errorDetail?.message ?? 'Try again in a moment.'} onRetry={mine.reload} />
  const department = mine.data?.department ?? null
  const def = departmentBySlug(department?.slug)
  if (!department || !def) return <EmptyState icon={Building2} title="You haven't been assigned to a department yet" description="A Main Admin assigns each worker to a department. Once that's done, your department's tools appear here." />
  return <DepartmentToolPage def={def} row={department} base="/worker" toolId={toolId} viewer={{ id: profile?.id, isMainAdmin: false, isDepartmentAdmin: mine.data?.role === 'admin' }} />
}
