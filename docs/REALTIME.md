# Realtime

## Critical gotcha — read this before adding any new postgres_changes subscription

A table must be explicitly added to the `supabase_realtime` publication
before `postgres_changes` subscriptions on it will ever fire — this is
**not** automatic just because RLS exists or the table exists. This caused
a real, shipped bug: `calls` had a working `postgres_changes` subscription
in the frontend, a correct RLS policy, and a row was genuinely created on
every call attempt — but the callee's client never received the event,
because `calls` was never added to the publication (only `chat_messages`
had been, for the chat feature). Fixed in
`20260921000001_realtime_publication_fix.sql`, which also covers
`group_calls`/`group_call_participants` for the same reason. **Any future
table you add a `postgres_changes` listener for needs its own
`alter publication supabase_realtime add table public.<name>;`** — grep
`src/` for `postgres_changes` and cross-check against `grep -rn "add table"
supabase/migrations/` if something's silently not firing.

## Actual state today: Team Chat is implemented

`chat_channels`, `chat_channel_members`, `chat_messages`
(`20260916000001_team_chat.sql`). Membership-gated via `is_channel_member()`
(a security-definer helper — avoids the recursive-RLS trap of a policy on
`chat_channel_members` querying `chat_channel_members` to check itself).
Workers/managers/superadmins can create channels and add members; anyone
can leave a channel themselves; only channel members can read or send.

Frontend: `src/lib/services/chat.ts` (real Realtime subscriptions +
presence, not polling) and `src/pages/TeamChat.tsx`, wired to
`/worker/chat` and `/admin/chat` (not `/client/*` — clients deliberately
never get a channel subscription to internal chat, matching the isolation
rule below).

**Known gap found while wiring this up**: `TeamChat.tsx` imported
`./TeamChat.css`, which didn't exist — would have failed the Vite build.
Fixed. If you're reading this because a similar "component references a
file that was never created" bug turned up elsewhere, that's the class of
bug to grep for (`grep -rn "^import.*\.css'" src/` and check each resolves).

**Not implemented**: DM channels specifically (schema supports arbitrary
channels including two-member ones, but no dedicated "start a DM" UI flow
exists — only channel creation is exposed). Typing indicators, mentions,
reactions, message editing/deletion UI (the RLS policy allows senders to
edit their own messages; no UI button calls it), attachments, read/unread
tracking. Presence (online/offline) IS implemented via Supabase Presence.

## Voice/video calls: implemented, not live-tested

`calls` table (`20260920000000_calls.sql`) holds call session state — who
called whom, status (`ringing`/`accepted`/`declined`/`missed`/`ended`/
`cancelled`), timestamps. RLS restricts every row to its two participants
only, not "any worker" the way most other tables here work — a call is
inherently 1:1. Only `worker`/`manager`/`superadmin` can start or receive
calls in this pass; clients don't get a calling surface, matching chat's
isolation rule.

The actual WebRTC signaling (SDP offer/answer, ICE candidates) is **not**
stored anywhere — `src/lib/services/calls.ts`'s `openSignalingChannel()`
opens one Realtime *broadcast* channel per call, used only for that call's
duration, and nothing broadcast through it is persisted.

`src/components/CallProvider.tsx` is the state machine (mounted once at the
app root in `App.tsx`, so an incoming call can be received from any page):
listens for incoming calls via `postgres_changes` on `calls` filtered to
`callee_id = me`, manages the `RTCPeerConnection` lifecycle, local/remote
`MediaStream`s, a 45-second ring timeout that auto-marks a call missed. UI
in `src/components/CallUI.tsx` (incoming-call banner, active-call window
with mute/camera/hang-up) and call buttons next to online members in
`TeamChat.tsx`.

**1:1 only in the `calls` table** — no group/conference calling there. A
separate `group_calls`/`group_call_participants` schema
(`20260921000000_group_calls.sql`) handles channel-scoped group calls
instead (join/leave a room tied to a chat channel, e.g. General), using the
same mesh-signaling approach but a "join" broadcast protocol rather than
ring/accept/decline — see `GroupCallProvider.tsx`. Mesh means every
participant connects directly to every other one; this does not scale
indefinitely (bandwidth and CPU cost grow with the square of participant
count). The ~8-10 person target from the original spec is a soft ceiling
for mesh, not a hard guarantee — an SFU (selective forwarding unit) would
replace this approach for real conference-scale calling, and is future
work, not attempted here.

**ICE servers**: public Google STUN only (free, no credentials). This will
connect on most networks but is a known, real limitation — symmetric NATs
and some corporate firewalls won't successfully connect through STUN alone.
Production-reliable connectivity needs a TURN server (its own credentialed
relay infrastructure), which isn't configured — see the comment at the top
of `CallProvider.tsx` for where to add one.

**What I could verify by reading the code**: the signaling state machine's
logic (offer/answer/ICE routing, ring-timeout, hangup propagation to both
sides), that RLS only ever exposes a call row to its two participants, and
that a real bug I found while writing this (a stale-closure bug in the
cleanup function that would have silently failed to stop the microphone/
camera on hangup — `localStream` was read from a `useCallback` with empty
deps, always seeing its initial `null` value) is fixed.

**What I could NOT verify, because it requires two real browsers on two
real machines**: whether an actual call connects end-to-end, whether ICE
negotiation succeeds on a real network, browser permission-prompt handling,
and the specific cross-browser scenario (Edge caller, Chrome callee) the
brief asked for. Test this for real before relying on it.

## Authorization rule (applies to chat today, and to calls whenever built)

Realtime channel subscriptions must be authorized the same way RLS
authorizes table access. Chat does this correctly — `chat_channels`/
`chat_messages` RLS gates who can even see a channel exists. Any future
Realtime feature should follow the same pattern: don't let the client join
a channel it shouldn't be in just because it knows the channel name.
