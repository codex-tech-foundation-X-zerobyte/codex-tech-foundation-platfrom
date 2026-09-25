# Realtime

**Status: implemented (Pass 5: Chat, Pass 6: Calls).** Both use Supabase
Realtime for live delivery. `src/lib/realtime.ts` is the one place
`supabase.channel()` is called — pages never call it directly. Presence,
typing indicators, and project-activity live updates are still not
implemented; see "What's still not built" below.

## What's implemented

- **Channels**: `team` (one per org, auto-created), `project` (one per
  project, created on first open), `dm` (1:1, created via
  `create_dm_channel()`). Membership is computed from existing tables
  rather than duplicated — see `can_access_channel()` in the Pass 5
  migration: team channels check `profiles.role`, project channels check
  `project_members`/`client_projects` (the same tables that already gate
  REST access to that project), and only DMs need their own
  `channel_members` table, since there's no other table to derive a DM's
  membership from.
- **Messages**: send (text and/or one attachment), edit, soft-delete (the
  row stays as a "Message deleted" tombstone; body and attachment are
  cleared, the attachment's storage object is actually removed).
- **Realtime delivery**: `subscribeToChannelMessages()` subscribes to
  Postgres Changes (`INSERT`/`UPDATE`) on `messages`, filtered
  server-side to one `channel_id` — a client is never subscribed to a
  firehose of every message in the system, and RLS still applies to the
  changefeed itself, so a manipulated filter couldn't leak another
  channel's messages.
- **Attachments**: a dedicated private `chat-attachments` bucket (kept
  separate from Team Files' `resources` bucket deliberately — see the
  migration comment for why conflating "delete this message" with "delete
  this team file" would be wrong). Storage RLS parses the channel_id out of
  the object path (`<channel_id>/<filename>`) and reuses
  `can_access_channel()`, so attachment access always matches the message's
  own access rule with no separate policy to keep in sync.
- **UI**: `ChatPage.tsx` — sidebar (Team, Project channels, DMs), thread
  view, composer with file attach, inline edit/delete for your own
  messages. Reachable at `/worker/chat` and `/admin/chat` (Manager shares
  the Admin route). No client-facing route — Chat is an internal team
  surface per §39 of the brief ("clients must not automatically receive
  internal team channels"), enforced by RLS (every channel-creation and
  DM-creation path requires a team role), not just by the missing nav link.

## What's still not built

Presence (online/offline), typing indicators, read/unread state, @mentions,
reactions, message search, and call signaling. These were deliberately
scoped out of Pass 5 to ship a working core rather than a wide,
half-finished surface — see ROADMAP.md for the "next pass" ordering. Voice/
video calls should build their signaling on top of this same
`realtime.ts` module rather than introducing a second Realtime pattern.

## Design notes for what's still not built

**Notifications**: per-user live feed (`notifications:<user_id>`) of new
rows in the existing `notifications` table — straightforward extension of
`realtime.ts` once something actually writes notification rows (see
`/docs/NOTIFICATIONS.md` — nothing does yet, independent of Realtime).

**Presence/typing**: use Supabase Presence, scoped per-channel, not a
global online-users list. Not started.

## Voice/Video Calls — status: implemented (Pass 6)

Schema: `calls` (always scoped to a `channel_id` — there is no standalone
"call anyone" mode; a call is a thing that happens inside a channel you
already have access to) and `call_participants` (join/leave tracking).
Access reuses `can_access_channel()` wholesale — no second membership
model. Signaling (SDP offers/answers, ICE candidates) uses Realtime
Broadcast on `call:<call_id>`, not `postgres_changes` — this is ephemeral
exchange data, not something worth persisting to Postgres the way chat
messages are.

**Read this before assuming Broadcast has the same guarantee as
`postgres_changes` above: it doesn't, in this implementation.**
`postgres_changes` payloads are filtered through RLS on the underlying
table; a plain (non-private) Broadcast channel is relayed to anyone
subscribed to that exact channel name, with no RLS check on the broadcast
messages themselves. The protection here is: (a) a client can only ever
*learn* a call's UUID by successfully querying `calls`/`call_participants`,
which ARE RLS-protected via `can_access_channel()`, and (b) the channel
name is that same unguessable UUID — the same class of protection this
codebase already uses for chat-attachment storage paths and DM channel
IDs, not a new pattern invented for this. It is **not** the same as
server-enforced authorization. Supabase supports "private channels" with
RLS policies on `realtime.messages` for exactly this case — deliberately
not implemented here, because getting that schema/API exactly right
without a live Supabase project to verify against risks shipping a policy
that *looks* like protection but silently doesn't apply, which is worse
than the documented gap above. Whoever hardens this next should start from
Supabase's own Realtime Authorization docs, not from guessing the current
API shape here.

**WebRTC**: `src/lib/useCallSession.ts` manages one `RTCPeerConnection` per
remote participant (full mesh) — public STUN only
(`stun:stun.l.google.com:19302`), no TURN server, since a TURN server needs
real infrastructure this environment can't provision (the same class of
external dependency Cloudflare R2 was). Calls between peers both behind
restrictive/symmetric NATs may fail to connect without one — a real, known
limitation, not silently ignored. Mesh topology matches the brief's own
framing ("~8-10 internal users... add an SFU later for larger meetings") —
it does not scale past a handful of concurrent participants per call;
introducing an SFU is exactly the documented future step, not a surprise.

**UI**: `CallView.tsx` (video/avatar tiles, mute/camera/leave), wired into
`ChatPage.tsx`'s channel header (voice/video call buttons, a live "call in
progress · Join" banner via `subscribeToChannelCalls()`).

## Guardrail

Realtime subscriptions must be cleaned up on unmount — `ChatPage.tsx`'s
`useEffect` for message subscriptions does this via `unsubscribe()` (which
wraps `supabase.removeChannel()`) in its cleanup function. Follow that
pattern for any new subscription; an un-unsubscribed channel is a real leak,
doubly so under React StrictMode's mount/unmount/remount in development.

