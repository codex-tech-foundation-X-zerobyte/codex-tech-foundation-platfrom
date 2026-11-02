import { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus, FakePC, FakeStream, fakeDisplayMedia } from './callBus'

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
  useEffect(() => { apis[id] = api })
  return null
}
const user = (id: string) => ({ profile: { id, display_name: id, role: 'worker' } })

async function connect() {
  render(
    <>
      <TestAuth.Provider value={user('A')}><CallProvider><Probe id="A" /></CallProvider></TestAuth.Provider>
      <TestAuth.Provider value={user('B')}><CallProvider><Probe id="B" /></CallProvider></TestAuth.Provider>
    </>,
  )
  await act(async () => { bus.actingUser = 'A'; await apis.A.startCallWith('B', 'voice') })
  await waitFor(() => expect(apis.B.phase).toBe('ringing-incoming'))
  await act(async () => { await apis.B.acceptIncoming() })
  await waitFor(() => { expect(apis.A.phase).toBe('active'); expect(apis.B.phase).toBe('active') }, { timeout: 3000 })
}

describe('screen sharing in a 1:1 call', () => {
  beforeEach(() => {
    bus.reset(); FakePC.all.length = 0; toasts.length = 0
    const g = globalThis as unknown as Record<string, unknown>
    g.RTCPeerConnection = FakePC
    g.MediaStream = FakeStream
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: fakeDisplayMedia } })
  })
  afterEach(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }) })

  it('offers sharing only where the browser can do it', async () => {
    await connect()
    expect(apis.A.canShareScreen).toBe(true)
  })

  it("puts the sharer's screen on the other person's stage WITHOUT replacing their camera/voice stream", async () => {
    await connect()
    const voiceBefore = apis.B.remoteStream
    expect(voiceBefore).not.toBeNull()
    await act(async () => { await apis.A.toggleScreenShare() })
    await waitFor(() => expect(apis.B.remoteScreen).not.toBeNull(), { timeout: 3000 })
    expect(apis.A.screenSharing).toBe(true)
    expect(apis.B.remoteStream).toBe(voiceBefore) // a screen must never take over the audio stream
  })

  it('clears the stage on both sides when the sharer stops', async () => {
    await connect()
    await act(async () => { await apis.A.toggleScreenShare() })
    await waitFor(() => expect(apis.B.remoteScreen).not.toBeNull(), { timeout: 3000 })
    await act(async () => { await apis.A.toggleScreenShare() })
    await waitFor(() => expect(apis.B.remoteScreen).toBeNull(), { timeout: 3000 })
    expect(apis.A.screenSharing).toBe(false)
  })

  it("stops sharing when the browser's own 'Stop sharing' bar is used", async () => {
    let shared: FakeStream | null = null
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: async () => (shared = new FakeStream([], true)) } })
    await connect()
    await act(async () => { await apis.A.toggleScreenShare() })
    expect(apis.A.screenSharing).toBe(true)
    await act(async () => { shared!.getVideoTracks()[0].fireEnded() })
    await waitFor(() => expect(apis.A.screenSharing).toBe(false))
  })

  it('treats cancelling the picker as a non-event, not an error', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: async () => { throw new DOMException('cancelled', 'NotAllowedError') } } })
    await connect()
    await act(async () => { await apis.A.toggleScreenShare() })
    expect(apis.A.screenSharing).toBe(false)
    expect(toasts).toEqual([])
  })

  it('ends the share, and frees the screen capture, when the call ends', async () => {
    await connect()
    await act(async () => { await apis.A.toggleScreenShare() })
    await act(async () => { await apis.A.hangUp() })
    expect(apis.A.screenSharing).toBe(false)
    await waitFor(() => expect(apis.B.phase).toBe('idle'))
    expect(apis.B.remoteScreen).toBeNull()
  })
})
