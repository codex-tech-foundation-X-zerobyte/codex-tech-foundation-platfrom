# Calls

## 1:1 handshake

Signalling messages are Supabase Realtime **broadcasts**. Broadcasts are *not stored or replayed*: a message sent
before the other side has finished subscribing is lost. The protocol is built around that.

```
caller                                   callee
  |  getUserMedia (fail fast, no ring)      |
  |  INSERT calls (status=ringing) -------->|  sees the row via postgres_changes
  |  subscribe call-signal:<id>             |  ring + banner (name via profiles)
  |  ring...                                |  user taps Accept
  |                                         |  getUserMedia
  |                                         |  subscribe call-signal:<id>   <-- BEFORE marking accepted
  |<---- UPDATE status=accepted ------------|
  |<---- broadcast: ready ------------------|  repeated every 1.5s until an offer arrives (max 12x)
  |  createOffer -> broadcast offer ------->|
  |<---- broadcast: answer -----------------|
  |<--- ICE candidates both ways (queued until remoteDescription is set) --->
  connected
```

Design rules that fix the original "callee picks up but nothing happens" bug:

1. The callee subscribes **before** it marks the call accepted, and speaks first (`ready`).
2. The caller never sends an offer until it hears `ready`. A duplicate `ready` makes it re-send the same offer.
3. ICE candidates that arrive before the remote description are queued and flushed afterwards.
4. The ring timeout is cleared the moment the call is answered (it used to fire mid-call).
5. `connecting` has a 25s timeout so a blocked network fails visibly instead of hanging.

State lives in refs inside `CallProvider`; realtime callbacks read refs, never a stale render's closure.

Tests: `tests/dom/calls.test.tsx` runs two real providers against an in-memory bus with real broadcast semantics
and a fake `RTCPeerConnection` that rejects early ICE candidates. Re-introducing the old behaviour makes them fail.

## Networks

STUN only (Google's public servers) connects most home/office networks. Symmetric NATs and strict firewalls need TURN:
set `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`. The System status page checks that this browser can
start calls (secure context, media devices, WebRTC) and that Realtime connects.

## Group calls

Full mesh, one `RTCPeerConnection` per pair. Whoever is already in the room offers to a newcomer on `join`, so each pair
negotiates in one direction only (no glare). Comfortable up to about six people.
