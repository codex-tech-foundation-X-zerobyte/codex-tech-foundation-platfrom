import { Building2, Star } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui'
import { getMyDepartments, type MyDepartment } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { departmentBySlug } from '../../workspaces/definitions'
import { DepartmentEnvironment } from '../../workspaces/DepartmentEnvironment'
import { DepartmentToolPage } from '../../workspaces/DepartmentToolPage'
import './WorkerDepartment.css'

/** Which of the worker's departments is on screen: the one in the address, otherwise their primary one. */
function pick(mine: MyDepartment[], slug: string | undefined): MyDepartment | null {
  if (slug) return mine.find((m) => m.department.slug === slug) ?? null
  return mine.find((m) => m.isPrimary) ?? mine[0] ?? null
}

function useMyDepartments() {
  const { profile } = useAuth()
  const mine = useAsyncData(`my-depts:${profile?.id}`, () => (profile ? getMyDepartments(profile.id) : Promise.resolve({ data: [] as MyDepartment[], error: null })))
  return { profile, mine }
}

/** Tabs for switching between the departments a worker belongs to. Renders nothing for a single-department worker. */
function DepartmentSwitcher({ mine, activeSlug, toolId }: { mine: MyDepartment[]; activeSlug: string | null | undefined; toolId?: string }) {
  if (mine.length < 2) return null
  return (
    <nav className="ctf-dswitch" aria-label="Your departments">
      <span className="ctf-dswitch__label">Your departments</span>
      {mine.map((m) => {
        const active = m.department.slug === activeSlug
        return (
          <Link key={m.department.id} to={`/worker/department/${m.department.slug ?? ''}`} className={`ctf-dswitch__chip ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            {m.isPrimary && <Star size={11} aria-label="Primary department" />}
            {m.department.name}
            {m.role === 'admin' && <em>Admin</em>}
          </Link>
        )
      })}
      {toolId && <span className="ctf-dswitch__note">Switching returns you to the department&apos;s home.</span>}
    </nav>
  )
}

const NOT_ASSIGNED = <EmptyState icon={Building2} title="You haven't been assigned to a department yet" description="A Main Admin places each worker in one or more departments. Once that's done, your department workspaces, boards and tools appear here." />

/** A worker's department environment. A worker can belong to several; the one shown follows the address, defaulting to their primary. */
export function WorkerDepartment() {
  useDocumentTitle('My department')
  const { slug } = useParams()
  const { profile, mine } = useMyDepartments()

  if (mine.loading) return <SkeletonRows rows={4} height="64px" />
  if (mine.error) return <ErrorState title="Your departments couldn't load" description={mine.errorDetail?.message ?? 'Try again in a moment.'} onRetry={mine.reload} />
  const list = mine.data ?? []
  if (list.length === 0) return NOT_ASSIGNED
  const current = pick(list, slug)
  if (!current) return <EmptyState icon={Building2} title="You're not in that department" description="You can only open departments you belong to. Pick one of yours below." action={<DepartmentSwitcher mine={list} activeSlug={null} />} />

  const def = departmentBySlug(current.department.slug)
  const body = def
    ? <DepartmentEnvironment key={current.department.id} def={def} row={current.department} base="/worker" viewerIsDepartmentAdmin={current.role === 'admin'} viewerId={profile?.id} />
    : <EmptyState icon={Building2} title={`${current.department.name} has no workspace yet`} description="This department was created before departments shipped with Codex Workspace, so it has no environment. Ask a Main Admin to move you to one of the eight Codex departments." />
  return <><DepartmentSwitcher mine={list} activeSlug={current.department.slug} />{body}</>
}

/** One tool inside one of the worker's departments. */
export function WorkerDepartmentToolPage() {
  const { toolId, slug } = useParams()
  const { profile, mine } = useMyDepartments()
  if (mine.loading) return <SkeletonRows rows={4} height="64px" />
  if (mine.error) return <ErrorState title="Your departments couldn't load" description={mine.errorDetail?.message ?? 'Try again in a moment.'} onRetry={mine.reload} />
  const list = mine.data ?? []
  const current = pick(list, slug)
  const def = departmentBySlug(current?.department.slug)
  if (!current || !def) return NOT_ASSIGNED
  return (
    <>
      <DepartmentSwitcher mine={list} activeSlug={current.department.slug} toolId={toolId} />
      <DepartmentToolPage def={def} row={current.department} base="/worker" toolId={toolId} viewer={{ id: profile?.id, isMainAdmin: false, isDepartmentAdmin: current.role === 'admin' }} />
    </>
  )
}
