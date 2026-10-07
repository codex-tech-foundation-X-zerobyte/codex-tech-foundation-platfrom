import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { id: string; channel_id: string; started_by: string; type: 'voice' | 'video'; status: 'active' | 'ended'; started_at: string; ended_at: string | null }
const call = (over: Partial<Call> = {}): Call => ({ id: 'gc1', channel_id: 'ch1', started_by: 'maya', type: 'voice', status: 'active', started_at: new Date().toISOString(), ended_at: null, ...over })

let role = 'worker'
let active: Call[] = []
let participantCounts: Record<string, number> = {}
let emit: (c: Call) => void = () => {}
const joined: { channel: string; type: string }[] = []
const chimes: number[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role } }) }))
vi.mock('../../src/components/CallProvider', () => ({ useCall: () => ({ phase: 'idle' }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/ringtone', () => ({ playChime: () => chimes.push(1), startRingtone: () => {}, stopRingtone: () => {} }))
vi.mock('../../src/lib/rtc', () => ({ ICE_SERVERS: [], stopStream: () => {}, describeMediaError: () => 'blocked', getLocalMedia: async () => { throw new DOMException('no', 'NotAllowedError') } }))
vi.mock('../../src/lib/services', () => ({
  listActiveGroupCalls: async () => ({ data: active, error: null }),
  countCallParticipants: async () => participantCounts,
  listenForGroupCalls: (cb: (c: Call) => void) => { emit = cb; return () => {} },
  listMyChannels: async () => ({ data: [{ id: 'ch1', type: 'group', name: 'General' }, { id: 'dm1', type: 'dm', name: '' }], error: null }),
  getDisplayNames: async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, i === 'maya' ? 'Maya' : 'Someone'])),
  getOrStartGroupCall: async (channel: string, type: string) => { joined.push({ channel, type }); return { data: call({ channel_id: channel, type: type as 'voice' }), error: null } },
  leaveGroupCall: async () => ({ error: null }), joinGroupCall: async () => ({ error: null }), openGroupSignalingChannel: () => ({ open: async () => {}, send: () => {}, close: () => {} }),
}))

import { GroupCallProvider } from '../../src/components/GroupCallProvider'
import { GroupCallUI } from '../../src/components/GroupCallUI'

const mount = () => render(<GroupCallProvider><GroupCallUI /></GroupCallProvider>)

describe('group call alerts (any page)', () => {
  beforeEach(() => { role = 'worker'; active = []; participantCounts = {}; joined.length = 0; chimes.length = 0; emit = () => {} })

  it('alerts you to a call that started before you loaded the page, with who and where', async () => {
    active = [call()]; participantCounts = { gc1: 2 }
    mount()
    expect(await screen.findByText(/Maya started a voice call/)).toBeTruthy()
    expect(screen.getByText(/in General/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
  })
  it('ignores a stale "active" call that nobody is actually in', async () => {
    active = [call()]; participantCounts = {}
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByText(/started a/)).toBeNull()
  })
  it('ignores calls older than three hours, and your own calls', async () => {
    active = [call({ id: 'old', started_at: new Date(Date.now() - 4 * 3600_000).toISOString() }), call({ id: 'mine', started_by: 'me' })]
    participantCounts = { old: 3, mine: 3 }
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByRole('region', { name: /calls you can join/i })).toBeNull()
  })
  it('alerts live when someone starts a call while you are doing something else, with a chime', async () => {
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    await act(async () => { emit(call({ id: 'live', type: 'video' })) })
    expect(await screen.findByText(/Maya started a video call/)).toBeTruthy()
    expect(chimes).toHaveLength(1)
  })
  it('a call in a private chat reads as "is calling you"', async () => {
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); emit(call({ id: 'dmcall', channel_id: 'dm1' })) })
    expect(await screen.findByText(/Maya is calling you/)).toBeTruthy()
  })
  it('the alert disappears when the call ends', async () => {
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); emit(call()) })
    await screen.findByText(/Maya started/)
    await act(async () => { emit(call({ status: 'ended' })) })
    await waitFor(() => expect(screen.queryByText(/Maya started/)).toBeNull())
  })
  it('Dismiss hides it, and a repeat event for the same call does not bring it back', async () => {
    const user = userEvent.setup()
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); emit(call()) })
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Maya started/)).toBeNull()
    await act(async () => { emit(call()) })
    expect(screen.queryByText(/Maya started/)).toBeNull()
  })
  it('Join enters that channel\'s call with the right type', async () => {
    const user = userEvent.setup()
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); emit(call({ type: 'video' })) })
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    await waitFor(() => expect(joined).toEqual([{ channel: 'ch1', type: 'video' }]))
  })
  it('clients are never alerted', async () => {
    role = 'client'; active = [call()]; participantCounts = { gc1: 2 }
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); emit(call({ id: 'x' })) })
    expect(screen.queryByText(/started a/)).toBeNull()
  })
})
