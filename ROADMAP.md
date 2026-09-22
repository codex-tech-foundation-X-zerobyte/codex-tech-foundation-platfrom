# Codex Tech Foundation — Redesign Status &amp; Roadmap

This document is the honest record of what's actually been delivered against the
120-item brief, across two passes, what's intentionally deferred, and what still
needs a real security review before this goes near production. Read it before
assuming any section of the app is "done."

## Pass 1 — foundation

**Design system**: full token set (`src/styles/tokens.css`/`base.css`), a component
library in `src/components/ui/` (Button, Badge/StatusBadge, Surface with 5 variants,
EmptyState, ErrorState, Skeleton, SectionHeading/Stat/ProgressBar/Avatar/Tabs, Table,
form Field primitives, Toast, Modal), and an original SVG brand mark.

**Public site**: Landing/hero, What We Build, Projects (list + detail), Case Studies
(list + detail), Blog (list + detail), Careers (list + detail + apply), About, Team,
Contact, Start a Project, Privacy/Terms, custom 404 — all on real Supabase data.

**Auth &amp; workspace shell**: session/profile context, redesigned Login, shared
`WorkspaceLayout` (sidebar/topbar/mobile drawer) configured per role.

**Worker/Admin/Client workspaces**: real dashboards backed by live queries, worker
Projects table + Tasks board, admin Workers table, client project detail with a
working request form.

**Data layer**: schema-accurate `types.ts`, split `services/` modules, three edge
functions that the frontend needed but didn't have (`submit-lead`, `submit-contact`,
`submit-job-application`).

## Pass 2 — this round

**Full RLS audit (item 84/117)** — went through every policy in all three migrations,
not just spot-checked. Two real bugs found and fixed in
`supabase/migrations/20260913000000_rls_audit_fixes.sql`:

1. **Storage confidentiality gap (high).** The `project-assets` bucket's read/upload
   policies only checked `bucket_id`, not which project a file belonged to — any
   authenticated user, including a client on a completely different project, could
   read or upload into any file in that bucket. Rewrote both policies to scope by
   project ownership, matching the (correct) pattern already used by the newer
   `private-project-files` bucket.
2. **Silently missing write policies (high).** `worker_profiles`, `case_studies`,
   `team_profiles`, `project_milestones`, `roles`, `permissions`, `role_permissions`,
   `user_roles`, `departments`, `client_users`, `client_projects`, and
   `system_settings` all had RLS enabled with a SELECT policy only — no
   INSERT/UPDATE/DELETE policy existed at all. This meant "deny by default" applied
   even to superadmin through the normal client. Concretely, it had already broken
   the admin worker-suspend button built in pass 1 without erroring loudly (RLS
   failures on `.update()` return an error result, not a thrown exception, and the
   UI didn't surface it distinctly from any other failure). Added explicit
   superadmin-managed policies for all of them, using the same `current_role()`
   pattern already established elsewhere in the schema (not `has_permission()`,
   since `role_permissions` had no seed data and would have locked superadmin out
   too).
3. Also added a missing **profile self-update policy** — previously nobody, not even
   a user editing their own display name, could update a `profiles` row through the
   client. The policy prevents self-escalating `role` via a subquery check.
4. **Documented, not changed**: `notifications` has no user-insert policy on
   purpose (letting any user insert a notification addressed to another user_id
   would be a spoofing vector) — left a comment in the migration so a future
   reviewer doesn't "fix" this into a hole. Also documented that `tasks`,
   `project_requests`, `project_files`, `resources`, and `clients` treat all workers
   as one trusted internal group rather than scoping to project membership — that
   was already the design in the prior migrations, not something introduced or
   silently changed here; flagged for the team to confirm it's still intended as
   the org grows.

**Closed the résumé-upload gap** flagged at the end of pass 1: added
`create-resume-upload-url`, an edge function that mints a single-use signed upload
URL scoped to one random path (extension-validated), so an anonymous applicant can
upload a résumé without the `applications` bucket ever granting public write access.
Wired into the apply form with a real file picker.

**Permissions UI (item 54)**: `roles`/`permissions`/`role_permissions` now have a
real service layer and — since those tables had zero rows — a seed migration
(`20260913000001_seed_roles_permissions.sql`) with a sensible default permission set
grouped by resource. `/admin/roles` is a working grant/revoke checkbox grid per role,
writing directly to `role_permissions`.

**File manager (items 57–58)**: the `resources` table existed with a `storage_path`
column but no storage bucket ever backed it — added one
(`20260913000002_resources_bucket.sql`) with worker/superadmin-scoped read/upload/
delete policies. `ResourcesManager` is a real upload/list/download/delete UI, shared
by both the worker and admin Resources routes, using signed URLs for downloads
rather than public links.

**Blog CMS, end to end (items 55–56, 109)**: full draft → publish → archive service
layer, an admin list view with inline publish/unpublish/archive actions, and an
editor with a lightweight Markdown-style formatting toolbar (bold/heading/list/
quote/link). **Deliberately not a rich-text editor** — I can't install or verify a
new dependency like TipTap or Lexical without network access in this environment,
and shipping an unverified dependency is worse than shipping something simpler that
definitely works. The public blog page still renders plain paragraphs (splitting on
blank lines) rather than parsing any markup, which sidesteps HTML-sanitization risk
entirely rather than partially solving it.

**SEO basics (item 91)**: `robots.txt` (disallowing the authenticated workspaces),
a `sitemap.xml` covering the static routes only — commented clearly that dynamic
entries (projects/case studies/posts/careers) need a small server-side generator
that doesn't exist yet — and a dependency-free `useDocumentTitle` hook wired into
the four public detail pages (project, case study, blog post, career).

## Pass 3 — this round

Full repo audit against two consolidated briefs (RBAC/Manager role, security
hardening, docs-as-source-of-truth, worker provisioning, RLS gap fixes). See
`/docs/` for the durable reference material this pass created — this section
is the changelog.

**Security fix (high) — worker login leaked real email addresses.**
`resolve-worker-login` used to resolve a Worker ID to an email and return it
to the browser, which then signed in itself. Any caller could learn a
worker's real email with any worker_id + any password, before the password
was even checked. Rewrote the function to verify the password server-side
(via a request-scoped anon-key client, never the service role) and return a
session (`access_token`/`refresh_token`) instead — the email never reaches
the browser. Updated `Login.tsx` to use `supabase.auth.setSession()`.
Also added the rate limiting (8 attempts / 5 min per IP+worker_id) that
didn't exist before — worker-ID brute forcing was previously unlimited.

**Security fix (medium) — public form + resume-upload endpoints had no rate
limiting at all.** Added a shared DB-backed primitive
(`check_rate_limit()` / `rate_limit_events`,
`20260914000002_rate_limiting.sql`) and wired it into `submit-lead`,
`submit-contact`, `submit-job-application`, and `create-resume-upload-url`.

**RBAC gap fix (high) — worker CMS/CRM routes were silently non-functional.**
`blog_posts`, `careers`, `content_pages`, `leads`, and `applications` each
had exactly one RLS policy: superadmin-only `for all`. The worker workspace
has had a live "Content → Blog" route since Pass 1; any worker's write
there was failing RLS silently, and every worker "Leads" nav item and the
"Applications" admin review flow were dead ends for anyone but superadmin.
Fixed with additive `has_permission()`-gated policies
(`20260914000001_manager_role_rbac.sql`) — nothing existing was narrowed.

**Manager role — implemented end to end.** `manager` added to the
`app_role` enum (its own migration,
`20260914000000_manager_role_enum.sql`, since Postgres won't let a new enum
value be used in the same transaction it's added in), seeded into
`roles`/`role_permissions` with an operational-but-not-superadmin
permission set (see `/docs/RBAC.md` for the exact table), and wired into
the frontend: `Role` type, `ProtectedRoute`, a `MANAGER_NAV` (Admin nav
minus Roles/Audit/Security/Settings), and `AdminWorkspace` now shares one
implementation between admin and manager with the superadmin-only routes
wrapped in a nested `SuperAdminOnly` guard rather than a duplicated
component. Manager can create workers (not other managers — only superadmin
can) and can only update/suspend `worker`-role accounts, enforced by an RLS
policy that joins back to `profiles.role`, not by trusting the caller.

**Worker provisioning — implemented end to end (was completely absent).**
New `create-worker` Edge Function: checks the caller's own
`workers.create` permission via their forwarded JWT, generates a unique
`CTF-WKR-NNNN` Worker ID, creates the real Supabase Auth user via
`auth.admin.createUser` (service role, never exposed to the browser),
inserts `profiles`/`worker_profiles`/`user_roles`, writes an `audit_logs`
entry, and returns a one-time temporary password. `AdminWorkers.tsx` now has
a real "Create worker" modal (role selector visible to superadmin only) and
a one-time credentials reveal (copy-to-clipboard, closed = gone, nothing
persisted client-side). **Not done**: the equivalent for clients
(`create-client`) — the pattern is proven, extending it is the highest-value
next step (see below).

**Super Admin bootstrap — implemented.**
`bootstrap_super_admin(uuid, display_name)`, security-definer, `EXECUTE`
revoked from `anon`/`authenticated` so it's unreachable from the browser
regardless of the caller's role; callable only via service-role/SQL Editor.
Idempotent, writes an audit log entry. See `/docs/AUTH-RULES.md`.

**Audit log viewer — implemented.** `/admin/audit` (superadmin-only) reads
the canonical `audit_logs` table with a severity filter; was a
`ScaffoldPage` before this pass. `audit_logs` (plural) confirmed as the one
canonical table — `audit_log` (singular, from the very first migration) is
unused anywhere in the app and documented as legacy rather than silently
duplicated (see `/docs/DATABASE-SCHEMA.md`).

**Docs suite — created.** `/docs/ARCHITECTURE.md`,
`/docs/DATABASE-SCHEMA.md`, `/docs/AUTH-RULES.md`, `/docs/RBAC.md`,
`/docs/API-CONTRACT.md`, `/docs/REALTIME.md`, `/docs/FILE-STORAGE.md`,
`/docs/NOTIFICATIONS.md`, `/docs/CONTRIBUTING.md`, `/docs/DEVELOPMENT.md` —
written to reflect the actual current state, including explicit "this does
not exist yet" sections for chat/calls/R2/client login, not aspirational
descriptions of the target architecture only.

## Pass 4 — this round

Scope: CMS extension (case studies/team/careers), client provisioning +
Client ID login, and Team Files — explicitly on Supabase Storage, not R2,
per the platform owner's direction ("we are going to use Supabase storage
once I am ready we are going to implement [R2]"). See `/docs/` updates in
the same commit as this changelog.

**CMS extension — complete.** `caseStudyAdmin.ts`, `careersAdmin.ts`,
`teamAdmin.ts` follow the exact `blogAdmin.ts` pattern from Pass 2:
list/create/update/publish/archive. New pages: `CaseStudyAdminList` +
`CaseStudyEditor`, `CareersAdminList` + `CareerEditor`, `TeamAdminList` +
`TeamProfileEditor` (with real photo upload to `public-content`),
`AdminApplications` (status pipeline + private resume access via
short-lived signed URLs, never a public resume link). Wired into both
Worker and Admin/Manager workspace routing and nav. **Found and fixed while
building this**: the `CaseStudy` and `TeamProfile` TypeScript types were
missing real columns (`seo_title`, `seo_description`, `social_links`) that
existed in the database since Pass 3's migration — a type/schema drift bug,
now corrected in `types.ts`.

**Client provisioning + Client ID login — complete.** New migration adds
`clients.client_code` (unique, `CTF-CLT-NNNN`) and — found while wiring the
client portal — a missing RLS policy: clients had **no way to read their
own company's `clients` row at all**, only worker/manager/superadmin could.
Fixed additively (`clients view own company`). New `create-client` Edge
Function mirrors `create-worker`'s exact security shape (permission check
via the caller's own JWT, service-role isolation, unique-ID generation,
one-time temp password, audit log entry) and supports both creating a new
company and adding a second login to an existing one. New
`resolve-client-login` Edge Function is a direct copy of
`resolve-worker-login`'s fixed shape (server-side password check, no email
leak, generic errors, rate limited) — checking `client_users.status`
instead of `worker_profiles.status`. `AdminClients.tsx` replaces the old
`ScaffoldPage` with a real client list, status controls, and a create modal
with project-assignment checkboxes and a one-time credentials reveal.

**Login page rebuilt — three-way mode toggle.** `Login.tsx` now has
Worker/Manager, Client, and Super Admin tabs instead of a single Worker-ID
field. Super Admin mode calls `supabase.auth.signInWithPassword` directly
(no Edge Function needed — there's no short ID to resolve). After sign-in,
the page fetches the session's `profiles.role` and routes to that role's
home from one shared mapping (`ROLE_HOME`), so it can't drift from
`App.tsx`'s route guards. This closes the "Super Admin email/password
sign-in UI" gap flagged at the end of Pass 3.

**Team Files — complete, on Supabase Storage.** Extended the existing
`resources` table rather than building a second, competing files table:
`parent_id`/`is_folder` for folders, `deleted_at` for a **real** trash
(restorable — see the bug fix below), `size_bytes`/`mime_type`/
`download_count`/`current_version` for metadata, and a new
`resource_versions` table for genuine version history (old versions never
overwritten). `resourceFiles.ts` implements folder navigation, drag-and-drop
multi-file upload, search, trash/restore/permanent-delete, version upload +
download, per-file download tracking, and a real aggregate storage-usage
query. `ResourcesManager.tsx` is a full rebuild with breadcrumb folder
navigation, a Files/Trash tab toggle, and a version-history modal.
**Bug found and fixed**: the previous `deleteResource()` called
`storage.remove()` immediately — anything "archived" was **not actually
recoverable** despite `archived_at` looking like a soft-delete flag.
`moveToTrash()` now genuinely preserves the object; only an explicit
`permanentlyDelete()` (from the trash view) removes bytes.
**Also found and fixed**: `audit_logs` had no INSERT policy at all — every
prior write went through a service-role Edge Function, which bypasses RLS.
File-activity logging writes directly from the browser, so it needed one;
added a narrowly-scoped policy (`team logs their own file activity`) that
only permits the five specific file-lifecycle actions with a self-attributed
actor — it does not open the door to inserting arbitrary security-critical
entries like `role.assigned`.

## Pass 5 — this round

Scope: Team Chat, as prioritized at the top of Pass 4's "next pass" list —
schema first, then the centralized Realtime module, then UI, in that order,
per the plan.

**Schema — `channels`, `channel_members`, `messages`.** Deliberately reuses
existing membership tables instead of duplicating them: team-channel access
is `profiles.role`, project-channel access is the same
`project_members`/`client_projects` tables that already gate REST access to
that project, and only DMs need their own `channel_members` rows (there's
no other table to derive 1:1 membership from). All of it goes through one
security-definer function, `can_access_channel()`, that every RLS policy
(channels, channel_members, messages, and the `chat-attachments` storage
bucket) calls — one membership rule, not five copies of it.

**Bug found and fixed while building this (pre-existing, not introduced by
Chat)**: `profiles` SELECT RLS has been `id = auth.uid() or current_role()
= 'superadmin'` since the very first migration. That means any worker or
manager viewing another team member's name — including
`AdminWorkers.tsx`'s `listWorkers()`, live since Pass 3 — has been
silently getting an empty `display_name` for every row but their own the
entire time, unless the viewer happened to be superadmin. This had nothing
to do with Chat specifically; it would have surfaced the moment any
non-superadmin opened the Workers list. Fixed additively — team members can
now see each other's basic profile row; client profiles are unaffected.

**Bug found and fixed in my own draft before it shipped**: the first
version of `openDirectMessage()` tried to seed both participants of a new
DM with two plain inserts into `channel_members`. That can't work — the
correct, minimal RLS policy on that table only allows inserting a row for
*yourself* (`user_id = auth.uid()`), which is exactly what stops one user
from adding a third party to someone else's DM. Caught this by re-reading
my own policy against my own service code before finishing, not by a user
report. Fixed with `create_dm_channel()`, a security-definer function that
is the one deliberate, narrow exception: it only ever inserts the caller
and one explicitly-named other team member, never an arbitrary user.

**Realtime module — `src/lib/realtime.ts`.** The one place
`supabase.channel()` is called anywhere in `src/`.
`subscribeToChannelMessages()` filters server-side to one `channel_id`
(never a firehose of every message in the system), and RLS still applies to
the Postgres Changes feed itself. Every subscribing component
(`ChatPage.tsx`) unsubscribes in its `useEffect` cleanup.

**Chat UI — `ChatPage.tsx`.** Sidebar (Team channel, Project channels, DMs)
+ thread view + composer. Send, edit, soft-delete (tombstone stays in
place, attachment's storage object is actually removed), one attachment per
message (separate `chat-attachments` bucket, not reusing Team Files'
`resources` bucket — deleting a message and deleting a team file are
different lifecycles and shouldn't be the same operation). Reachable at
`/worker/chat` and `/admin/chat` (Manager shares the Admin route). No
client-facing route or nav entry — enforced by RLS (every channel/DM
creation path requires a team role), not just by hiding the link.

**Deliberately not built in this pass**: presence, typing indicators,
read/unread state, @mentions, reactions, and message search. Scoping these
out was a choice to ship a working core end-to-end rather than a wider
surface with more of it half-finished — see "Explicitly NOT done" below.

## Pass 6 — this round

Scope: Voice/Video Calls, next in Pass 5's suggested order — built on
`src/lib/realtime.ts`, the same module Chat established, per that plan.

**Schema — `calls`, `call_participants`.** Every call belongs to a
`channel_id`; there is no standalone "call anyone" mode. This means call
access reuses `can_access_channel()` from the Chat migration wholesale —
zero new membership logic to keep in sync with Chat's. `call_participants`
tracks who's actually joined/left for the UI; it is not itself the access
gate (a channel member can always join a call in their own channel).

**Signaling — Realtime Broadcast, with an honest limitation documented,
not silently assumed away.** SDP offers/answers and ICE candidates go over
`call:<call_id>` broadcast channels. Unlike Chat's `postgres_changes`
subscriptions, Broadcast on a plain channel is **not** checked against
Postgres RLS the way table changefeeds are — the protection here is that a
client can only ever learn a call's UUID via an RLS-protected query, plus
channel-name unguessability (the same practical-protection pattern already
used for chat-attachment paths and DM channel IDs elsewhere in this
codebase). Supabase's "private channels" feature would give this a real
RLS-enforced guarantee via policies on `realtime.messages` — deliberately
**not** implemented, because writing that policy correctly without a live
Supabase project to verify the exact current API against risks shipping
something that looks like protection but silently doesn't apply, which is
worse than the documented gap. See REALTIME.md for the full writeup and a
pointer to where to pick this up.

**WebRTC — `src/lib/useCallSession.ts`.** One `RTCPeerConnection` per
remote participant (full mesh — a new joiner offers to everyone already
present; the offer/answer/ICE exchange is deduplicated per pair by that
direction rule, not by a race). Public STUN only
(`stun:stun.l.google.com:19302`); no TURN server, since running one needs
real infrastructure this environment can't provision — the same class of
external dependency Cloudflare R2 was for storage. Calls between two peers
both behind restrictive/symmetric NATs may simply fail to connect without
one; this is stated plainly in REALTIME.md, not left as a silent edge case.

**UI — `CallView.tsx` + `ChatPage.tsx` wiring.** Video/avatar tiles,
mute/camera/leave controls; voice/video call buttons and a live "call in
progress · Join" banner (via a new `subscribeToChannelCalls()` helper) in
the channel header.

**Two bugs caught in my own draft before they shipped, not after the
fact:**
1. `createPeerConnection` originally took an unused `callId` parameter,
   suppressed with a `void callId` no-op to satisfy the lint rule rather
   than actually removing the dead parameter. Cleaned up — the parameter
   didn't do anything and shouldn't have existed.
2. The mute/camera toggle handlers originally set `track.enabled` from the
   *stale* pre-toggle state value in a way that happened to be
   arithmetically correct but was genuinely confusing to read (relying on
   an inversion that isn't obvious at the call site). Rewrote both to
   compute the next state explicitly first, then apply it — same behavior,
   actually readable.

**Deliberately not built in this pass**: presence, typing indicators,
read/unread, @mentions, reactions, message search (carried over from Pass
5), plus an SFU for calls beyond a handful of concurrent participants and
a TURN server for NAT traversal. See "Explicitly NOT done" below.

<<<<<<< HEAD
=======
## Pass 7 — this round: live bug reports, not a spec

Scope: four specific, user-reported bugs on a real deployment, not a
brief. Diagnosed and fixed each one individually.

**Bug fix (critical) — worker/client sessions randomly logging out.**
`AuthProvider.refresh()` called `supabase.auth.getUser()`, which makes a
real network round-trip to Supabase's Auth server on every call, and
silently discarded its `error`. `onAuthStateChange` fires this on every
`TOKEN_REFRESHED` event (roughly hourly) — any single transient network
hiccup, rate limit, or timing overlap with the background token refresh
made a perfectly valid session look logged-out and booted the user, even
though nothing was actually wrong with their session. Rewrote to use
`supabase.auth.getSession()` (reads the already-validated local session
state, no network call) and to only ever clear the profile on an actual
`SIGNED_OUT` event — a failed *profile* fetch no longer gets treated the
same as a lost *session*. This is also a documented Supabase footgun:
calling `getUser()` synchronously from inside an `onAuthStateChange`
callback risks deadlocking with the client's own auth state machine.

**Bug fix (major) — there was no way to create a project, anywhere, for
any role.** Confirmed by reading the actual code, not assumed: `/admin/projects`
was a `ScaffoldPage` with zero functionality, and `WorkerProjects.tsx` only
listed projects — neither had ever had a create button or form. The RLS
policy already allowed worker/manager/superadmin to insert into `projects`
(since the very first migration) — this was purely a missing service
function and UI, not a backend gap. Added `createProject()` (also adds the
creator + chosen teammates as `project_members` and provisions the
project's chat channel via the already-idempotent `ensureProjectChannel()`
in one call), `updateProject()`, and member management functions to
`projects.ts`. New shared `CreateProjectModal.tsx` used by both
`WorkerProjects.tsx` and the new `AdminProjects.tsx` (which replaces the
old scaffold) — one implementation, not two.

**Feature (major) — real incoming-call alerts, not just a banner on the
page you happened to have open.** The previous "call in progress · Join"
banner only rendered inside `ChatPage` for whichever channel was currently
selected — someone being called while anywhere else in the app had no way
to know. New `IncomingCallListener.tsx`, mounted once at the app root
(inside the Router, outside any one workspace), subscribes to ALL `calls`
INSERTs with no channel filter — this is deliberate and safe, not a broad-
access mistake: Postgres Changes still enforces `can_access_channel()` RLS
on every row before it reaches the client, so a user only ever receives
events for calls they can actually access. Shows a real accept/decline
alert with the caller's name and channel; Accept deep-links to
`/worker/chat?join=<callId>&channel=<channelId>` (or `/admin/chat`),
which `ChatPage.tsx` now reads on mount to select the channel and join the
already-active call directly (not call `startCall()` again, which would
incorrectly start a second call).

**Clarified, not a bug**: "a general group chat to communicate with each
other" — this already exists. It's the `team` channel built in Pass 5
(auto-created via `ensureTeamChannel()`, shown first in the Chat sidebar
for every worker/manager/superadmin). It was very likely unreachable
because of the session-logout bug above — if a session look-logged-out
before Chat ever loaded, there was no way to discover it. Worth confirming
it's visible now that the session bug is fixed, rather than building a
second general-chat mechanism that would just be a duplicate of the one
that already works.

**Feature (major) — real Account Settings for all three roles, replacing
three separate "coming next" scaffolds.** Found a real gap while doing
this: `/admin/settings` was wrapped in `SuperAdminOnly` — a Manager had no
settings page at all, not even to change their own password. New
`account.ts` service (`updateOwnProfile()`, `changePassword()`,
`getOwnEmail()`), plus `getMyWorkerProfile()`/`getMyClient()` for the
role-specific read-only info block (Worker ID and status; organization and
Client ID). One shared `AccountSettings.tsx` used by all three workspaces
— display name, password change, role info — rather than three separate
implementations. The `SuperAdminOnly` wrapper on `/admin/settings` is
removed; organisation-wide platform configuration (the `system_settings`
table) is a separate, still-unbuilt concern from personal account settings
and wasn't conflated with it.

**Feature (major) — real Leads management, replacing two scaffolds.**
There was real data with nowhere to go: the public site's contact and
start-project forms have written to `leads` since Pass 1/2 via
`submit-lead`/`submit-contact`, but no admin UI ever existed to see,
assign, or act on a single one of them. RLS was already correct
(`leads.view`/`leads.manage` from the Pass 3 fix) — this was purely a
missing schema (added `notes`, `assigned_to`) and UI gap. New
`listLeads()`/`updateLeadStatus()`/`assignLead()`/`updateLeadNotes()` in
`leads.ts`, and one shared `LeadsPage.tsx` (list with status filter and
inline status change, a detail modal for notes/assignment) used by both
Worker and Admin/Manager — RLS already scopes both identically, so one
implementation covers both. **Not built**: converting a lead to a client
or project — that's a real, separate feature (would need to actually
create a `clients`/`projects` row from lead data) and wasn't forced in to
avoid shipping something half-considered.

## Pass 8 — this round: deploy targets, a critical Realtime bug, and chat/nav UX

**CRITICAL bug found and fixed — `calls` and `notifications` were never
added to the Realtime publication.** Supabase Realtime only broadcasts
`postgres_changes` for tables explicitly added to the `supabase_realtime`
publication — RLS correctness and client subscription code are irrelevant
if the table isn't in that list at all. Only `messages` was ever added
(Pass 5's migration). This means every `postgres_changes` subscription on
`calls` since Pass 6 (`subscribeToChannelCalls`, and the global
`IncomingCallListener` built in Pass 7) has been silently unable to fire a
single event this whole time, regardless of how correct the surrounding
code looked. This is very likely the actual, underlying reason incoming
calls were never alerting anyone — independent of, and more fundamental
than, the UI-level global-listener fix built believing the subscription
itself already worked. Fixed with one migration adding both tables to the
publication; also fixes the new live notification-badge feed below.

**GitHub Pages — a real second deployment target, not just Vercel
troubleshooting.** GitHub Pages has no server-side rewrite capability
(unlike Vercel's `vercel.json`), so an SPA needs a specific, well-known
workaround or direct navigation/refresh on any nested route 404s. Built
the standard fix (`public/404.html` + a decode script in `index.html`'s
`<head>`) and *verified the encode/decode round-trip with a script before
shipping it* — including a route with both query params and a hash
fragment — rather than trusting memory of the pattern. Also: `vite.config.ts`
now reads `VITE_BASE_PATH` for its `base` config (GitHub Pages project
sites serve from a subpath, Vercel serves from root); the new
`.github/workflows/pages.yml` derives the correct subpath automatically
from the real repo name (`github.event.repository.name`) so the same
codebase builds correctly for both targets with no manual toggling and no
risk of a hardcoded repo name silently breaking one target or the other.

**Chat UI — WhatsApp-style alignment and real sender identity in
groups.** Own messages now align right, others' left; sender name/avatar
shown once per consecutive run (not repeated per message) and only in
group channels — a DM's two participants don't need a name label, same as
WhatsApp. Timestamp moved into the bubble itself.

**Collapsible sidebars — both the main workspace nav and the Chat page's
own channel list**, independently, each persisted to `localStorage`. Real
finding while wiring the main sidebar's collapse: it's a CSS Grid layout,
so the child's own `width` property doesn't control the actual column
width — the grid track does. Caught and fixed by checking the rendered
CSS against the grid definition rather than assuming the naive `width`
change would work.

**Notification bell — was a completely dead button, now real.** The
existing topbar bell icon had no `onClick` at all. New
`getUnreadNotificationCount()`, a live-updating unread badge via the newly
publication-fixed `notifications` table (`subscribeToMyNotifications()` in
`realtime.ts`), and a click that navigates to the already-built
`NotificationsPage` — which also **had no route for Client at all** until
this pass (`/client/notifications` didn't exist; only worker and admin did).

>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
## Explicitly NOT done — don't assume otherwise

- **Rich-text editing**: still a plain-text/lightweight-markdown editor
  across all CMS types (blog, case studies, careers), not TipTap/Lexical.
- **Kanban drag-and-drop**: the worker task board still changes status via a
  select control, not drag-and-drop.
- **Full admin surfaces**: worker profile detail, project CMS, cross-project
  task view, security overview — still `ScaffoldPage` placeholders with a
  real row count.
- **PWA/offline work**: untouched.
- **Real automated test coverage**: `tests/smoke.test.mjs` was extended
  again this pass (client provisioning, Team Files schema/behavior
  assertions) but it's still a smoke test, not integration/RLS tests
  against a live database.
- **Dynamic sitemap generation**: noted above, not built.
- **File previews and internal file links**: Team Files is download-only —
  no inline PDF/image preview, and no "link this file in a task/message"
  (partly blocked on Team Chat not existing). Per-file granular sharing
  (private-to-me, shared-with-these-people) doesn't exist either — every
  team member with resources access sees every file, same as before this pass.
- **Client-visible deliverables**: Team Files is the internal team library.
  The client portal's own file/update views are still placeholders —
  extending client-facing file access (`project_files`, deliverables) to
  the same real pattern is a natural next step but wasn't done here.
<<<<<<< HEAD
=======
- **Developer Tools page** (QR/hash/base64/URL encode-decode utilities) —
  requested, not built this pass.
- **Light/Dark/System theme and the visitor-area animated background** —
  requested, not built this pass. This is a genuinely large, cross-cutting
  change (every surface's CSS needs a real light-mode palette, not an
  inverted dark one) and doing it well alongside everything else in this
  pass would have meant doing it rushed — deliberately deferred rather
  than shipped half-considered.
- **Still-scaffolded routes** (confirmed by reading `App.tsx` directly, not
  guessed): Security overview, Worker profile detail, cross-project Task
  view, project workspace detail tabs (`/worker/projects/:id`,
  `/admin/projects/:id` — the project itself is real, this is only the
  detail view), client-side files/updates/maintenance, organisation-wide
  platform configuration (`system_settings` has no UI), and lead-to-client/
  project conversion.
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
- **Team Chat**: implemented (Pass 5) but still missing presence, typing
  indicators, read/unread state, @mentions, reactions, and message search —
  deliberately deferred to ship a working core first.
- **Voice/Video Calls**: implemented (Pass 6) — voice/video 1:1 and small
  group calls work over WebRTC mesh. Missing: an SFU (so this doesn't scale
  past a handful of concurrent participants per call — the brief's own
  stated target), a TURN server (calls between peers both behind
  restrictive NATs can fail to connect), call invitations/ringing UI
  distinct from "join whatever's active" (there's no "ring this specific
  person and let them accept/decline before joining" flow — anyone who
  opens the channel and clicks the call button just joins), and
  RLS-enforced (vs. UUID-unguessability-protected) broadcast signaling —
  see REALTIME.md for the exact tradeoff.
- **Cloudflare R2**: storage is 100% Supabase Storage — deliberately, per
  explicit direction from the platform owner (not a stopgap). See
  `/docs/FILE-STORAGE.md` for the abstraction point (`shared.ts`'s `storage`
  helper) for whenever that migration happens.
- **Project status lifecycle migration**: `projects.status` is still the v1
  enum (`planning|active|review|complete`), not the brief's proposed
  `planning|in_development|active|maintenance|paused|completed|archived`.
  Not migrated this pass — flagged in `/docs/DATABASE-SCHEMA.md` rather than
  silently left inconsistent with the brief.
- **CI pipeline / GitHub Actions**: not created. `/docs/CONTRIBUTING.md`
  documents the intended branch workflow; no automated enforcement exists yet.
- **Session revocation on suspension**: an already-issued session survives a
  worker or client being suspended until the token expires or they sign
  out — see `/docs/AUTH-RULES.md` "Account status enforcement" for why and
  what a real fix would require.

## Verification — what I could and couldn't check

Still no network access in this environment, so `npm install` / `npm run build` /
`npm run lint` / `npm test` could not be run here — same limitation as pass 1. Ran
the same static checks again after every batch of changes this pass (import
resolution, unused-import detection matching `noUnusedLocals`/`noUnusedParameters`,
`verbatimModuleSyntax` compliance, bracket balance) — all clean, plus a manual
paren-balance check on the three new SQL migrations. **This is still not a
substitute for the real build.** Please run:

```bash
npm install
npm run lint
npm test
npm run build
```

and apply the new migrations (`npx supabase db push` or equivalent) before assuming
any of this works end to end. The RLS changes in particular should be tested against
a real Supabase project — policy logic that looks right on paper is exactly the kind
of thing that needs to be exercised with real requests from each role.

## Suggested order for the next pass

1. Run the real build and apply all migrations (including the five added
   since Pass 3) against a live Supabase project; fix whatever surfaces.
   Confirm the Realtime publication (`supabase_realtime`) is enabled — the
   Chat migration adds `messages` to it, but if the publication itself
   doesn't exist on a given project that statement will fail and needs a
   one-line fix (create the publication first). Also confirm WebRTC works
   end to end between two real accounts on two real devices/networks — it
   cannot be exercised in this sandbox at all (no browser, no camera/mic,
   no second peer).
2. Calls: add a ringing/invitation flow (currently "join whatever's
   active," not "ring a specific person") and, if group calls need to
   scale past a handful of people, an SFU — mesh is deliberately the MVP
   choice per the brief's own framing.
3. Chat polish: presence, typing indicators, read/unread, @mentions,
   reactions, message search — in roughly that priority order (presence
   and read/unread are the most-missed features in practice).
4. Extend client-facing file/update views to the same real pattern Team
   Files now uses internally (client portal currently has placeholders for
   its own project files/updates).
5. Cross-project admin views: task view, project CMS, worker profile detail.
6. Kanban drag-and-drop for the worker task board.
7. Project status lifecycle migration (`projects.status` v1 → the brief's
   proposed 7-state enum) — do this before building more project UI on top
   of the old enum, to avoid a second migration later.
8. PWA/offline pass, then accessibility pass, once page content has stabilized.
9. Cloudflare R2 migration — only once real Cloudflare credentials exist;
   the abstraction point is documented in `/docs/FILE-STORAGE.md` and
   doesn't require re-touching any page component.
10. Supabase "private channels" (RLS on `realtime.messages`) to close the
    broadcast-signaling gap documented in REALTIME.md, once someone can
    verify the exact current API against a live project.
