import { beforeEach, describe, expect, it, vi } from 'vitest'

const log: string[] = []
const cfg = { assignError: null as null | { message: string }, projectError: null as null | { message: string } }

vi.mock('../../src/lib/supabase', () => {
  const from = (table: string) => {
    const b: Record<string, unknown> = {}
    let op = 'select'
    b.insert = (payload: unknown) => { op = 'insert'; log.push(`insert ${table} ${JSON.stringify(Array.isArray(payload) ? payload.length : 1)}`); return b }
    b.delete = () => { op = 'delete'; return b }
    b.eq = (c: string, v: string) => { log.push(`${op} ${table} where ${c}=${v}`); return b }
    b.select = () => b
    b.single = async () => cfg.projectError ? { data: null, error: cfg.projectError } : { data: { id: 'proj-1', name: 'Zerobyte Launch' }, error: null }
    b.then = (resolve: (v: unknown) => void) => resolve({ error: table === 'project_departments' && op === 'insert' ? cfg.assignError : null, data: [] })
    return b
  }
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: { id: 'main-admin' } } }), getSession: async () => ({ data: { session: null } }) } } }
})

import { distributeProject } from '../../src/lib/services/assignments'
import { stageStatus } from '../../src/lib/services/tasks'

const input = { name: 'Zerobyte Launch', description: '', status: 'planning' as const }
const brief = (id: string) => ({ departmentId: id, objective: ' Build it ', deliverables: [' A ', '', 'B'], deadline: '' })

beforeEach(() => { log.length = 0; cfg.assignError = null; cfg.projectError = null })

describe('distributeProject', () => {
  it('refuses to create a project that no department will work on', async () => {
    const r = await distributeProject(input, [])
    expect(r.error?.message).toMatch(/at least one department/i)
    expect(log).toEqual([])
  })

  it('creates the project once and assigns every chosen department', async () => {
    const r = await distributeProject(input, [brief('d1'), brief('d2')])
    expect(r.error).toBeNull()
    expect(r.project?.id).toBe('proj-1')
    expect(r.assigned).toEqual(['d1', 'd2'])
    expect(log.filter((l) => l.startsWith('insert projects'))).toHaveLength(1)
    expect(log).toContain('insert project_departments 2')
  })

  it('removes the project again if it could not be assigned, rather than leaving it half-distributed', async () => {
    cfg.assignError = { message: 'permission denied' }
    const r = await distributeProject(input, [brief('d1')])
    expect(r.project).toBeNull()
    expect(r.error?.message).toMatch(/wasn't created.*permission denied/)
    expect(log).toContain('delete projects where id=proj-1')
  })

  it('does not touch assignments when the project itself fails to create', async () => {
    cfg.projectError = { message: 'boom' }
    const r = await distributeProject(input, [brief('d1')])
    expect(r.error).toBeTruthy()
    expect(log.some((l) => l.includes('project_departments'))).toBe(false)
  })
})

describe('stageStatus', () => {
  const stages = ['Backlog', 'Ready', 'In development', 'Code review', 'QA', 'Deployed']
  it('first stage is to do, last is done, everything between is in progress', () => {
    expect(stageStatus(stages, 'Backlog')).toBe('todo')
    expect(stageStatus(stages, 'Code review')).toBe('in_progress')
    expect(stageStatus(stages, 'Deployed')).toBe('done')
  })
  it('treats an unknown stage as not started', () => { expect(stageStatus(stages, 'Nope')).toBe('todo') })
})
