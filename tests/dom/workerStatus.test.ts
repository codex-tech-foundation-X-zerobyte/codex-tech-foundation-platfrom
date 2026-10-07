import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A chainable stand-in for supabase-js's builder that resolves with whatever PostgREST "would" have said. */
let response: { data: unknown; error: unknown; status: number }
const calls: { table: string; patch: unknown; filter: unknown }[] = []
const builder = (table: string, patch: unknown) => {
  const b: Record<string, unknown> = {}
  b.eq = (col: string, val: string) => { calls.push({ table, patch, filter: { [col]: val } }); return b }
  b.select = () => b
  b.then = (resolve: (v: unknown) => void) => resolve(response)
  return b
}
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: (table: string) => ({ update: (patch: unknown) => builder(table, patch) }), auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } },
}))

import { updateWorkerStatus } from '../../src/lib/services/workers'

const USER = '19230577-6467-49a8-acec-19166cdb27ff'

describe('updateWorkerStatus', () => {
  beforeEach(() => { calls.length = 0 })

  it('sends only a valid status, keyed by user_id', async () => {
    response = { data: [{ user_id: USER }], error: null, status: 200 }
    expect(await updateWorkerStatus(USER, 'suspended')).toEqual({ error: null })
    expect(calls).toEqual([{ table: 'worker_profiles', patch: { status: 'suspended' }, filter: { user_id: USER } }])
  })

  it('rejects an invalid status locally, without making a request', async () => {
    const { error } = await updateWorkerStatus(USER, 'disabled' as never)
    expect(error?.message).toMatch(/not a valid worker status/)
    expect(calls).toHaveLength(0)
  })

  it('surfaces the REAL database error (code + HTTP status) instead of a silent generic 400', async () => {
    response = { data: null, status: 400, error: { code: '42703', message: 'record "old" has no field "id"', details: null, hint: null } }
    const { error } = await updateWorkerStatus(USER, 'suspended')
    expect(error).toMatchObject({ name: 'AppError', code: '42703', status: 400, technical: 'record "old" has no field "id"' })
    expect(error?.message).toMatch(/internal error 42703/)
  })

  it('reports a permission denial clearly', async () => {
    response = { data: null, status: 403, error: { code: '42501', message: 'new row violates row-level security policy for table "worker_profiles"' } }
    const { error } = await updateWorkerStatus(USER, 'banned')
    expect(error?.message).toBe("You don't have permission to do that.")
  })

  it('treats an update RLS silently filtered to zero rows as a failure, not success', async () => {
    response = { data: [], error: null, status: 200 }
    const { error } = await updateWorkerStatus(USER, 'suspended')
    expect(error?.message).toMatch(/don't have permission/)
  })
})
