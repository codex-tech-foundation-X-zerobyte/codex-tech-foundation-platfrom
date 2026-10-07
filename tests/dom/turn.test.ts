import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testTurnRelay } from '../../src/lib/rtc'

/** A scriptable RTCPeerConnection: each test decides what the "network" does after the offer is set. */
type Script = (pc: FakePC) => void
let script: Script = () => {}
let created: FakePC[] = []
class FakePC {
  config: RTCConfiguration
  onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null
  onicecandidateerror: ((e: { errorCode: number; errorText: string }) => void) | null = null
  closed = false
  constructor(config: RTCConfiguration) { this.config = config; created.push(this) }
  createDataChannel() {}
  async createOffer() { return { type: 'offer', sdp: '' } }
  async setLocalDescription() { setTimeout(() => script(this), 0) }
  close() { this.closed = true }
}
const PC = FakePC as unknown as typeof RTCPeerConnection
const TURN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }, { urls: ['turn:relay.expressturn.com:3478', 'turns:relay.expressturn.com:443'], username: 'u', credential: 'c' }]

describe('TURN relay test', () => {
  beforeEach(() => { created = []; script = () => {} })
  afterEach(() => vi.useRealTimers())

  it('returns null when no TURN server is configured (STUN alone)', async () => {
    expect(await testTurnRelay(100, [{ urls: 'stun:stun.l.google.com:19302' }], PC)).toBeNull()
    expect(created).toHaveLength(0)
  })
  it('passes only when a RELAY candidate is allocated', async () => {
    script = (pc) => { pc.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 2 1.2.3.4 5 typ relay raddr 0.0.0.0' } }) }
    const r = await testTurnRelay(1000, TURN, PC)
    expect(r?.ok).toBe(true)
    expect(created[0].closed).toBe(true) // never leaves a connection open
  })
  it('forces relay-only and sends only the TURN entries (so STUN cannot make a broken relay look healthy)', async () => {
    script = (pc) => { pc.onicecandidate?.({ candidate: { candidate: 'x typ relay y' } }) }
    await testTurnRelay(1000, TURN, PC)
    expect(created[0].config.iceTransportPolicy).toBe('relay')
    expect(created[0].config.iceServers).toEqual([TURN[1]])
  })
  it('host and srflx candidates do NOT count as success', async () => {
    script = (pc) => { pc.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 2 10.0.0.2 5 typ host' } }); pc.onicecandidate?.({ candidate: { candidate: 'candidate:2 1 udp 2 1.2.3.4 5 typ srflx' } }) }
    const r = await testTurnRelay(60, TURN, PC)
    expect(r?.ok).toBe(false)
  })
  it('wrong credentials fail fast with a specific message (does not wait for the timeout)', async () => {
    script = (pc) => { pc.onicecandidateerror?.({ errorCode: 401, errorText: 'Unauthorized' }) }
    const started = performance.now()
    const r = await testTurnRelay(5000, TURN, PC)
    expect(r?.ok).toBe(false)
    expect(r?.detail).toMatch(/username or credential/)
    expect(performance.now() - started).toBeLessThan(1000)
  })
  it('an unreachable server (701) reports that, after the timeout', async () => {
    script = (pc) => { pc.onicecandidateerror?.({ errorCode: 701, errorText: '' }) }
    const r = await testTurnRelay(80, TURN, PC)
    expect(r?.ok).toBe(false); expect(r?.detail).toMatch(/Could not reach the TURN server/)
  })
  it('silence times out with a clear explanation', async () => {
    const r = await testTurnRelay(50, TURN, PC)
    expect(r?.ok).toBe(false); expect(r?.detail).toMatch(/No relay address was allocated/)
  })
  it('only the first outcome counts (no double resolution if events keep arriving)', async () => {
    script = (pc) => { pc.onicecandidate?.({ candidate: { candidate: 'a typ relay' } }); pc.onicecandidateerror?.({ errorCode: 701, errorText: '' }) }
    expect((await testTurnRelay(500, TURN, PC))?.ok).toBe(true)
  })
})
