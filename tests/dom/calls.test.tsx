import { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bus, FakePC, FakeStream } from './callBus'

vi.mock('../../src/lib/services', async () => await import('./callBus'))
vi.mock('../../src/lib/rtc', async () => { const { rtcMock } = await import('./callBus'); return rtcMock })
vi.mock('../../src/lib/ringtone', () => ({ startRingtone: () => {}, stopRingtone: () => {} }))
vi.mock('../../src/lib/auth', async () => {
  const { useContext } = await import('react')
  const { TestAuth } = await import('./testAuth')
  return { useAuth: () => useContext(TestAuth) }
})
const toasts: string[] = []
vi.mock('../../src/components/ui', () => ({ useToast: () => ({ push: (m: string) => toasts.push(m) }) }))

import { CallProvider, useCall } from '../../src/components/CallProvider'
import { TestAuth } from './testAuth'

type Api = ReturnType<typeof useCall>
const apis: Record<string, Api> = {}
function Probe({ id }: { id: string }) {
  const api = useCall()
  useEffect(() => { apis[id] = api }) // publish the latest API to the test after every render
  return null
}

function mount() {
  const user = (id: string) => ({ profile: { id, display_name: id, role: 'worker' } })
  return render(
    <>
      <TestAuth.Provider value={user('A')}><CallProvider><Probe id="A" /></CallProvider></TestAuth.Provider>
      <TestAuth.Provider value={user('B')}><CallProvider><Probe id="B" /></CallProvider></TestAuth.Provider>
    </>,
  )
}

const ring = async () => {
  await act(async () => { bus.actingUser = 'A'; await apis.A.startCallWith('B', 'voice') })
  await waitFor(() => expect(apis.B.phase).toBe('ringing-incoming'))
}

describe('1:1 call handshake', () => {
  beforeEach(() => {
    bus.reset(); FakePC.all.length = 0; toasts.length = 0
    ;(globalThis as unknown as Record<string, unknown>).RTCPeerConnection = FakePC
    ;(globalThis as unknown as Record<string, unknown>).MediaStream = FakeStream
  })

  it('rings the callee, and both sides reach "active" after the callee picks up', async () => {
    mount()
    await ring()
    expect(apis.A.phase).toBe('ringing-outgoing')
    expect(apis.B.peerName).toBe('User A') // the incoming banner can show WHO is calling
    await act(async () => { await apis.B.acceptIncoming() })
    await waitFor(() => { expect(apis.A.phase).toBe('active'); expect(apis.B.phase).toBe('active') }, { timeout: 3000 })
    expect(apis.A.remoteStream).not.toBeNull() // remote audio exists to be played
    expect(apis.B.remoteStream).not.toBeNull()
  })

  it('works even when the callee is SLOW to join the signalling channel (the original bug)', async () => {
    bus.calleeSubscribeMs = 400
    mount()
    await ring()
    await act(async () => { await apis.B.acceptIncoming() })
    await waitFor(() => { expect(apis.A.phase).toBe('active'); expect(apis.B.phase).toBe('active') }, { timeout: 4000 })
    // The caller must never have sent an offer into the void before the callee announced it was listening.
    const firstReady = bus.log.findIndex((l) => l === 'callee:ready')
    const firstOffer = bus.log.findIndex((l) => l.startsWith('caller:offer'))
    expect(firstReady).toBeGreaterThanOrEqual(0)
    expect(firstOffer).toBeGreaterThan(firstReady)
    expect(bus.log.some((l) => l.includes('lost'))).toBe(false)
  })

  it('recovers if the first "ready" message is lost (callee keeps announcing)', async () => {
    bus.dropReady = 1
    mount()
    await ring()
    await act(async () => { await apis.B.acceptIncoming() })
    await waitFor(() => { expect(apis.A.phase).toBe('active'); expect(apis.B.phase).toBe('active') }, { timeout: 5000 })
    expect(bus.log).toContain('callee:ready(dropped)')
  })

  it('queues ICE candidates that arrive before the remote description instead of dropping them', async () => {
    mount()
    await ring()
    await act(async () => { await apis.B.acceptIncoming() })
    await waitFor(() => expect(apis.A.phase).toBe('active'), { timeout: 3000 })
    // Every candidate either side received was eventually applied; the fake PC rejects any added too early.
    for (const pc of FakePC.all) expect(pc.rejectedCandidates).toBe(0)
    expect(FakePC.all.some((pc) => pc.addedCandidates.length > 0)).toBe(true)
  })

  it('if the caller hangs up before anyone answers, the callee banner goes away', async () => {
    mount()
    await ring()
    await act(async () => { await apis.A.hangUp() })
    await waitFor(() => { expect(apis.B.phase).toBe('idle'); expect(apis.A.phase).toBe('idle') })
    expect(toasts).toContain('Missed call.')
  })

  it('declining returns the caller to idle with a clear message', async () => {
    mount()
    await ring()
    await act(async () => { await apis.B.declineIncoming() })
    await waitFor(() => expect(apis.A.phase).toBe('idle'))
    expect(toasts).toContain('Call declined.')
  })

  it('ending an active call ends it for BOTH people', async () => {
    mount()
    await ring()
    await act(async () => { await apis.B.acceptIncoming() })
    await waitFor(() => expect(apis.A.phase).toBe('active'), { timeout: 3000 })
    await act(async () => { await apis.A.hangUp() })
    await waitFor(() => { expect(apis.A.phase).toBe('idle'); expect(apis.B.phase).toBe('idle') })
  })

  it('a blocked microphone fails immediately and never rings the other person', async () => {
    bus.mediaDenied = true
    mount()
    await act(async () => { bus.actingUser = 'A'; await apis.A.startCallWith('B', 'voice') })
    expect(apis.A.phase).toBe('idle')
    expect(bus.calls.size).toBe(0)
    expect(apis.B.phase).toBe('idle')
    expect(toasts.join(' ')).toMatch(/blocked/i)
  })

  it('cannot start a second call while one is in progress', async () => {
    mount()
    await ring()
    await act(async () => { await apis.A.startCallWith('B', 'voice') })
    expect(bus.calls.size).toBe(1)
    expect(toasts.join(' ')).toMatch(/current call/i)
  })
})
