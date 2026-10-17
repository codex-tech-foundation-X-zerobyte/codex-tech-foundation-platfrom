/**
 * In-memory stand-in for the calls table + the realtime signalling channel, with the semantics that matter:
 *  - a broadcast is delivered ONLY to handlers that are already subscribed (real Supabase broadcast is not replayed)
 *  - subscribing takes time (configurable), so "callee joins late" can be simulated
 */
type Status = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended' | 'cancelled'
export interface CallRow { id: string; caller_id: string; callee_id: string; type: 'voice' | 'video'; status: Status; started_at: string }
type Handler = (p: { kind: string; [k: string]: unknown }) => void

export const bus = {
  actingUser: 'A',
  calls: new Map<string, CallRow>(),
  incoming: new Map<string, (c: CallRow) => void>(),
  outgoing: new Map<string, (c: CallRow) => void>(),
  openers: new Map<string, number>(),
  handlers: new Map<string, Map<'caller' | 'callee', Handler>>(),
  log: [] as string[],
  dropReady: 0,
  calleeSubscribeMs: 0,
  mediaDenied: false,
  reset() {
    this.calls.clear(); this.incoming.clear(); this.outgoing.clear(); this.openers.clear(); this.handlers.clear()
    this.log = []; this.dropReady = 0; this.calleeSubscribeMs = 0; this.mediaDenied = false; this.actingUser = 'A'
  },
}

const later = (fn: () => void, ms = 2) => setTimeout(fn, ms)
const notify = (row: CallRow) => {
  later(() => bus.outgoing.get(row.caller_id)?.({ ...row }))
  later(() => bus.incoming.get(row.callee_id)?.({ ...row }))
}
const setStatus = async (id: string, status: Status) => {
  const row = bus.calls.get(id)
  if (!row) return { error: null }
  const finished = ['declined', 'missed', 'ended', 'cancelled'].includes(row.status)
  if (!finished) { row.status = status; notify(row) }
  return { error: null }
}

export const startCall = async (calleeId: string, type: 'voice' | 'video') => {
  const row: CallRow = { id: `call-${bus.calls.size + 1}`, caller_id: bus.actingUser, callee_id: calleeId, type, status: 'ringing', started_at: new Date().toISOString() }
  bus.calls.set(row.id, row)
  later(() => bus.incoming.get(calleeId)?.({ ...row }))
  return { data: { ...row }, error: null }
}
export const acceptCall = (id: string) => setStatus(id, 'accepted')
export const declineCall = (id: string) => setStatus(id, 'declined')
export const cancelCall = (id: string) => setStatus(id, 'cancelled')
export const endCall = (id: string) => setStatus(id, 'ended')
export const markMissed = (id: string) => setStatus(id, 'missed')
export const getDisplayNames = async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, `User ${i}`]))
export const listenForCalls = (userId: string, cb: (c: CallRow) => void) => { bus.incoming.set(userId, cb); return () => { bus.incoming.delete(userId) } }
export const listenForOutgoingCallUpdates = (userId: string, cb: (c: CallRow) => void) => { bus.outgoing.set(userId, cb); return () => { bus.outgoing.delete(userId) } }

export const openSignalingChannel = (callId: string) => {
  const n = (bus.openers.get(callId) ?? 0) + 1
  bus.openers.set(callId, n)
  const role: 'caller' | 'callee' = n === 1 ? 'caller' : 'callee'
  const other = role === 'caller' ? 'callee' : 'caller'
  return {
    open(handler: Handler) {
      return new Promise<void>((resolve) => {
        later(() => {
          if (!bus.handlers.has(callId)) bus.handlers.set(callId, new Map())
          bus.handlers.get(callId)!.set(role, handler) // only NOW can this side receive anything
          resolve()
        }, role === 'callee' ? bus.calleeSubscribeMs : 1)
      })
    },
    send(payload: { kind: string }) {
      if (payload.kind === 'ready' && bus.dropReady > 0) { bus.dropReady -= 1; bus.log.push(`${role}:ready(dropped)`); return }
      const target = bus.handlers.get(callId)?.get(other)
      bus.log.push(`${role}:${payload.kind}${target ? '' : '(lost: other side not subscribed)'}`)
      if (target) later(() => target(payload))
    },
    close() { bus.handlers.get(callId)?.delete(role) },
  }
}

export const rtcMock = {
  ICE_SERVERS: [] as unknown[],
  describeMediaError: () => 'Access to your microphone was blocked.',
  stopStream: () => {},
  getLocalMedia: async () => {
    if (bus.mediaDenied) throw new DOMException('denied', 'NotAllowedError')
    return new FakeStream()
  },
}

export class FakeStream {
  private tracks = [{ kind: 'audio', enabled: true, stop() {} }]
  constructor(_tracks?: unknown[]) { void _tracks }
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks }
  getVideoTracks() { return [] }
}

/** Behaves like the real thing where it matters: addIceCandidate REJECTS until a remote description exists. */
export class FakePC {
  localDescription: { type: string } | null = null
  remoteDescription: { type: string } | null = null
  signalingState = 'stable'
  connectionState = 'new'
  onicecandidate: ((e: { candidate: { toJSON: () => unknown } }) => void) | null = null
  ontrack: ((e: { streams: FakeStream[]; track: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addedCandidates: unknown[] = []
  rejectedCandidates = 0
  static all: FakePC[] = []
  constructor() { FakePC.all.push(this) }
  addTrack() {}
  async createOffer() { return { type: 'offer', sdp: 'o' } }
  async createAnswer() { return { type: 'answer', sdp: 'a' } }
  async setLocalDescription(d: { type: string }) {
    this.localDescription = d
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
    setTimeout(() => { this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'c1' }) } }); this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'c2' }) } }) }, 0)
    this.maybeConnect()
  }
  async setRemoteDescription(d: { type: string }) { this.remoteDescription = d; this.maybeConnect() }
  async addIceCandidate(c: unknown) {
    if (!this.remoteDescription) { this.rejectedCandidates += 1; throw new Error('InvalidStateError: remote description not set') }
    this.addedCandidates.push(c)
  }
  private maybeConnect() {
    if (this.localDescription && this.remoteDescription && this.connectionState !== 'connected') {
      setTimeout(() => { this.connectionState = 'connected'; this.ontrack?.({ streams: [new FakeStream()], track: {} }); this.onconnectionstatechange?.() }, 15)
    }
  }
  close() { this.connectionState = 'closed' }
}
