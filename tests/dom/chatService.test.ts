import { describe, expect, it, vi } from 'vitest'

let rows: unknown[] = []
vi.mock('../../src/lib/supabase', () => {
  const builder = () => { const b: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b; b.then = (r: (v: unknown) => void) => r({ data: rows, error: null, status: 200 }); return b }
  return { supabase: { from: () => builder(), auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) } } }
})

import { listMyChannels } from '../../src/lib/services/chat'

describe('listMyChannels', () => {
  it('never returns the same channel twice, even if the query does', async () => {
    const general = { id: 'g', type: 'group', name: 'General', chat_channel_members: [{ user_id: 'me' }] }
    rows = [general, general, general, general, general, { id: 'p', type: 'project', name: 'Acme', chat_channel_members: [{ user_id: 'me' }] }]
    const { data } = await listMyChannels()
    expect(data.map((c) => c.id)).toEqual(['g', 'p'])
  })
  it('strips the embedded membership rows from what it returns', async () => {
    rows = [{ id: 'g', type: 'group', name: 'General', chat_channel_members: [{ user_id: 'me' }] }]
    const { data } = await listMyChannels()
    expect('chat_channel_members' in data[0]).toBe(false)
  })
})
