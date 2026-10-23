import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, Building2, Users } from 'lucide-react'
import { Badge, ButtonLink, EmptyState, ErrorState, SkeletonRows, Surface } from '../../components/ui'
import { getDepartmentBySlug, listDepartmentSummaries } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { DEPARTMENTS, departmentBySlug } from '../../workspaces/definitions'
import { DepartmentEnvironment } from '../../workspaces/DepartmentEnvironment'
import { DepartmentToolPage } from '../../workspaces/DepartmentToolPage'
import './AdminDepartments.css'

/**
 * The company's departments. They already exist: Codex ships with its eight departments, each with its own
 * environment, so this page is an overview of the organisation, not a form for building it. A Main Admin's job here is
 * to see who works where and to assign Department Admins.
 */
export function AdminDepartments() {
  useDocumentTitle('Departments')
  const summaries = useAsyncData('summaries', listDepartmentSummaries)

  if (summaries.error) return <ErrorState title="Departments couldn't load" description={summaries.errorDetail?.message ?? 'Try again in a moment.'} onRetry={summaries.reload} />
  if (summaries.loading) return <SkeletonRows rows={4} height="96px" />

  const rows = summaries.data?.departments ?? []
  const bySlug = new Map(rows.filter((r) => r.slug).map((r) => [r.slug as string, r]))
  const legacy = rows.filter((r) => !r.slug)
  const unassigned = summaries.data?.unassigned ?? 0

  return (
    <div className="ctf-depts">
      {unassigned > 0 && (
        <Surface variant="warning" className="ctf-depts__notice">
          <Users size={16} aria-hidden="true" />
          <span>{unassigned} {unassigned === 1 ? 'worker has' : 'workers have'} no department yet and won&apos;t get a department environment.</span>
          <ButtonLink to="/admin/workers" variant="secondary" size="sm">Open workers</ButtonLink>
        </Surface>
      )}

      <ul className="ctf-depts__grid" aria-label="Departments">
        {DEPARTMENTS.map((def) => {
          const row = bySlug.get(def.slug)
          const Icon = def.icon
          return (
            <li key={def.slug}>
              <Link to={`/admin/departments/${def.slug}`} className="ctf-depts__card" style={{ ['--dept-accent' as string]: def.accent }}>
                <span className="ctf-depts__icon" aria-hidden="true"><Icon size={20} /></span>
                <div className="ctf-depts__body">
                  <strong>{def.name}</strong>
                  {def.dashboardTitle !== def.name && <span className="ctf-depts__title">{def.dashboardTitle}</span>}
                  <p>{def.tagline}</p>
                  <div className="ctf-depts__meta">
                    {!row ? <Badge tone="warning">Not provisioned</Badge> : <Badge tone={row.workerCount ? 'accent' : 'neutral'}>{row.workerCount} {row.workerCount === 1 ? 'worker' : 'workers'}</Badge>}
                    {row && (row.admins.length > 0 ? <span className="ctf-depts__admin">Admin: {row.admins.join(', ')}</span> : <Badge tone="warning">No Department Admin</Badge>)}
                  </div>
                </div>
                <ArrowRight size={16} className="ctf-depts__go" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>

      {legacy.length > 0 && (
        <Surface>
          <h2 className="ctf-depts__h2">Other departments</h2>
          <p className="ctf-depts__muted">These were created by hand before departments shipped with Codex Workspace. They have no environment.</p>
          <ul className="ctf-depts__legacy">{legacy.map((d) => <li key={d.id}><Building2 size={14} aria-hidden="true" /> {d.name} <Badge tone="neutral">{d.workerCount} {d.workerCount === 1 ? 'worker' : 'workers'}</Badge></li>)}</ul>
        </Surface>
      )}
    </div>
  )
}

/** A single department's environment, as the Main Admin sees it. */
export function AdminDepartmentPage() {
  const { slug } = useParams()
  const def = departmentBySlug(slug)
  const { profile } = useAuth()
  const row = useAsyncData(`dept:${slug}`, () => getDepartmentBySlug(slug ?? ''))
  useDocumentTitle(def?.dashboardTitle ?? 'Department')

  if (!def) return <EmptyState icon={Building2} title="That department doesn't exist" description="Codex's departments are fixed. Pick one from the list." action={<ButtonLink to="/admin/departments" variant="secondary">All departments</ButtonLink>} />
  if (row.loading) return <SkeletonRows rows={4} height="64px" />
  if (row.error) return <ErrorState title="This department couldn't load" description={row.errorDetail?.message ?? 'Try again.'} onRetry={row.reload} />

  return (
    <div className="ctf-depts">
      <Link to="/admin/departments" className="ctf-depts__back"><ArrowLeft size={14} aria-hidden="true" /> All departments</Link>
      <DepartmentEnvironment def={def} row={row.data} base="/admin" canManage={profile?.role === 'superadmin'} viewerId={profile?.id} />
    </div>
  )
}

/** One tool inside a department, as the Main Admin sees it. */
export function AdminDepartmentToolPage() {
  const { slug, toolId } = useParams()
  const def = departmentBySlug(slug)
  const { profile } = useAuth()
  const row = useAsyncData(`dept:${slug}`, () => getDepartmentBySlug(slug ?? ''))
  if (!def) return <EmptyState icon={Building2} title="That department doesn't exist" description="Codex's departments are fixed. Pick one from the list." action={<ButtonLink to="/admin/departments" variant="secondary">All departments</ButtonLink>} />
  if (row.loading) return <SkeletonRows rows={4} height="64px" />
  if (row.error) return <ErrorState title="This department couldn't load" description={row.errorDetail?.message ?? 'Try again.'} onRetry={row.reload} />
  return <DepartmentToolPage def={def} row={row.data} base="/admin" toolId={toolId} viewer={{ id: profile?.id, isMainAdmin: profile?.role === 'superadmin', isDepartmentAdmin: false }} />
}
