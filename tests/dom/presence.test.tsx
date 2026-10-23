import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let role = 'worker'
type Meta = { status?: string }
let state: Record<string, Meta[]> = {}
let onSync: () => void = () => {}
let onSubscribe: (s: string) => void = () => {}
const tracked: Meta[] = []
const joinedChannels: string[] = []
let removed = 0

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role } }) }))
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      joinedChannels.push(name)
      const ch = {
        on: (_t: string, _f: unknown, cb: () => void) => { onSync = cb; return ch },
        subscribe: (cb: (s: string) => void) => { onSubscribe = cb; return ch },
        track: async (m: Meta) => { tracked.push(m) },
        presenceState: () => state,
      }
      return ch
    },
    removeChannel: async () => { removed += 1 },
  },
}))

import { PresenceProvider, usePresence } from '../../src/components/PresenceProvider'

function Probe() {
  const { onlineIds, statusOf } = usePresence()
  return <div data-testid="p">{[...onlineIds].sort().join(',')}|{statusOf('a')}|{statusOf('b')}|{statusOf('zzz')}</div>
}
const text = () => screen.getByTestId('p').textContent

describe('global presence', () => {
  beforeEach(() => { role = 'worker'; state = {}; tracked.length = 0; joinedChannels.length = 0; removed = 0 })

  it('joins ONE workspace-wide channel as soon as a team member is signed in, and announces itself once subscribed', async () => {
    render(<PresenceProvider><Probe /></PresenceProvider>)
    expect(joinedChannels).toEqual(['presence:team'])
    await act(async () => { onSubscribe('SUBSCRIBED') })
    expect(tracked).toEqual([{ status: 'online' }])
  })
  it('reports who is online, away, or not at all', async () => {
    render(<PresenceProvider><Probe /></PresenceProvider>)
    state = { a: [{ status: 'online' }], b: [{ status: 'away' }] }
    await act(async () => { onSync() })
    expect(text()).toBe('a,b|online|away|offline')
  })
  it('someone with several tabs is online if ANY is in the foreground', async () => {
    render(<PresenceProvider><Probe /></PresenceProvider>)
    state = { a: [{ status: 'away' }, { status: 'online' }], b: [{ status: 'away' }, { status: 'away' }] }
    await act(async () => { onSync() })
    expect(text()).toBe('a,b|online|away|offline')
  })
  it('marks you away when the tab is hidden, and back online when it returns', async () => {
    render(<PresenceProvider><Probe /></PresenceProvider>)
    const setVisibility = (v: 'hidden' | 'visible') => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')) }
    await act(async () => { setVisibility('hidden') })
    await act(async () => { setVisibility('visible') })
    expect(tracked).toEqual([{ status: 'away' }, { status: 'online' }])
  })
  it('re-announces after a reconnect (SUBSCRIBED fires again)', async () => {
    render(<PresenceProvider><Probe /></PresenceProvider>)
    await act(async () => { onSubscribe('SUBSCRIBED'); onSubscribe('SUBSCRIBED') })
    expect(tracked).toHaveLength(2)
  })
  it('leaves the channel on unmount', () => {
    const { unmount } = render(<PresenceProvider><Probe /></PresenceProvider>)
    unmount()
    expect(removed).toBe(1)
  })
  it('clients are never tracked and never shown anyone', async () => {
    role = 'client'
    render(<PresenceProvider><Probe /></PresenceProvider>)
    expect(joinedChannels).toEqual([])
    expect(text()).toBe('|offline|offline|offline')
  })
})
