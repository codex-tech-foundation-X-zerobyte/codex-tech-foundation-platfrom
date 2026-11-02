import { useMemo } from 'react'
import { getMyDepartments, listDepartmentSummaries } from '../../lib/services'
import type { Viewer } from '../../lib/fundWorkflow'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../hooks/useAsyncData'

/** Who is looking at the Finance office, which departments they may act for, and whether they belong to Finance. */
export function useFinanceViewer() {
  const { profile } = useAuth()
  const mine = useAsyncData(`fin-depts:${profile?.id}`, async () => (profile && profile.role !== 'superadmin' ? getMyDepartments(profile.id) : { data: [], error: null }))
  const all = useAsyncData('fin-all-depts', async () => (profile?.role === 'superadmin' ? listDepartmentSummaries() : { data: { departments: [], unassigned: 0 }, error: null }))
  const viewer: Viewer = useMemo(() => {
    const m = mine.data ?? []
    return { id: profile?.id, isMainAdmin: profile?.role === 'superadmin', isFinanceManager: m.some((x) => x.department.slug === 'finance' && x.role === 'admin'), adminOf: m.filter((x) => x.role === 'admin').map((x) => x.department.id) }
  }, [profile, mine.data])
  const isFinance = (mine.data ?? []).some((x) => x.department.slug === 'finance') || viewer.isMainAdmin
  const departments = viewer.isMainAdmin ? (all.data?.departments ?? []).map((d) => ({ id: d.id, name: d.name })) : (mine.data ?? []).map((x) => ({ id: x.department.id, name: x.department.name }))
  /** Every department's name, for company-wide budget screens (Finance and the Main Admin see all of them). */
  const departmentNames = new Map(departments.map((d) => [d.id, d.name]))
  return { viewer, isFinance, departments, departmentNames, loading: mine.loading || all.loading }
}
