import { useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import { Button, Select, useToast } from './ui'
import { setWorkerDepartments, type DepartmentRole, type DepartmentSummary, type Membership } from '../lib/services'
import { departmentBySlug } from '../workspaces/definitions'
import './DepartmentPlacementEditor.css'

interface Props {
  workerId: string
  workerName: string
  departments: DepartmentSummary[]
  current: Membership[]
  onCancel: () => void
  onSaved: () => void
}

interface Row { in: boolean; role: DepartmentRole }

/**
 * Place a worker in as many departments as they actually work in (a full-stack engineer: frontend, backend and DevOps), choose their
 * role in each, and pick the primary one (it opens first and is what older screens show). Saved in one atomic step; Main Admin only.
 */
export function DepartmentPlacementEditor({ workerId, workerName, departments, current, onCancel, onSaved }: Props) {
  const { push } = useToast()
  const assignable = useMemo(() => departments.filter((d) => d.slug), [departments])   // only the Codex departments have environments
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(assignable.map((d) => {
    const m = current.find((c) => c.department_id === d.id)
    return [d.id, { in: !!m, role: m?.department_role ?? 'member' }]
  })))
  const [primary, setPrimary] = useState<string>(() => current.find((c) => c.is_primary)?.department_id ?? current[0]?.department_id ?? '')
  const [saving, setSaving] = useState(false)

  const chosen = assignable.filter((d) => rows[d.id]?.in)
  const effectivePrimary = chosen.some((d) => d.id === primary) ? primary : chosen[0]?.id ?? ''
  const toggle = (id: string, on: boolean) => setRows((r) => ({ ...r, [id]: { ...r[id], in: on, role: on ? r[id].role : 'member' } }))

  const save = async () => {
    setSaving(true)
    const { error } = await setWorkerDepartments(workerId, chosen.map((d) => ({ department_id: d.id, role: rows[d.id].role, primary: d.id === effectivePrimary })))
    setSaving(false)
    if (error) { push(error.message, 'error'); return }
    push(chosen.length === 0 ? `${workerName} is no longer in any department.` : `${workerName} is now in ${chosen.length} department${chosen.length === 1 ? '' : 's'}.`)
    onSaved()
  }

  return (
    <div className="ctf-dpe">
      <p className="ctf-dpe__intro">Tick every department {workerName} works in. They get each department&apos;s workspace, channels and boards, and can switch between them.</p>
      <ul className="ctf-dpe__list">
        {assignable.map((d) => {
          const row = rows[d.id]
          const def = departmentBySlug(d.slug)
          const Icon = def?.icon
          return (
            <li key={d.id} className={row.in ? 'is-in' : ''}>
              <label className="ctf-dpe__check">
                <input type="checkbox" checked={row.in} onChange={(e) => toggle(d.id, e.target.checked)} />
                {Icon && <Icon size={16} aria-hidden="true" />}
                <span>{d.name}</span>
              </label>
              {row.in && (
                <div className="ctf-dpe__opts">
                  <Select aria-label={`Role in ${d.name}`} value={row.role} onChange={(e) => setRows((r) => ({ ...r, [d.id]: { ...r[d.id], role: e.target.value as DepartmentRole } }))}>
                    <option value="member">Member</option>
                    <option value="admin">Department Admin</option>
                  </Select>
                  <label className="ctf-dpe__primary" title="The department that opens first">
                    <input type="radio" name="primary-department" checked={effectivePrimary === d.id} onChange={() => setPrimary(d.id)} />
                    <Star size={12} aria-hidden="true" /> Primary
                  </label>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="ctf-dpe__hint">Admin is per department: someone can lead DevOps and be an ordinary member of Backend.</p>
      <div className="ctf-dpe__actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} loading={saving}>Save departments</Button>
      </div>
    </div>
  )
}
