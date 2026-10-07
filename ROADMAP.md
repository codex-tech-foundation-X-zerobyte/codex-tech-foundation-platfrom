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

## Refinement pass (UI, calls, chat, dev tools, hardening)

**Fixed**

- Typing in the Create project / client / worker dialogs lost focus after one character. `Modal`'s focus effect
  depended on `onClose`, which every parent re-creates each render. Regression-tested in `tests/dom/modal.test.tsx`.
- Calls: the callee could pick up and never connect (offer sent before the callee had joined the signalling channel);
  ICE candidates were dropped; the caller's ring timeout kept running after an answer; voice calls had no `<audio>`
  element (silent); a blocked microphone left the UI stuck on "Ringing". Handshake documented in `docs/CALLS.md`.
- Chat: composer lost focus after each send, no sender names, no grouping, duplicate-prone realtime handling.
- Bare `<button>`s had no reset, so they showed the browser's grey face and outset border ("button cover").
- `<Link><Button/></Link>` nesting replaced with `ButtonLink`; a CTA that did a full page reload now navigates.
- Client accounts could not see their own projects, milestones or updates, could not file requests, and clients could
  read unpublished drafts. Chat/call name lookups returned nothing for workers. `calls` rows could be rewritten by either
  participant. All in migration `20260923000000_functional_gap_fixes.sql`, tested against a real Postgres.
- The project did not type-check as shipped (`react-router-dom` v7 is a re-export shim). Imports now come from `react-router`.
- Sign-in: signed-out users hit a dead-end "Access restricted"; a transient profile fetch failure looked like sign-out.

**Added**

- Command palette (Cmd/Ctrl+K), live notification bell, breadcrumbs, page headers, error boundaries, route code-splitting.
- 14 browser-only dev tools (`/worker/tools`, `/admin/tools`) and a live System status page.
- Worker Clients directory, client Requests and Maintenance pages, staff request triage tab, Kanban drag-and-drop with rollback.
- Safe Markdown renderer for blog posts (the editor toolbar already produced Markdown that the public page showed raw).
- Landing page: live build-pipeline terminal, scroll reveals, animated process line, platform section.

## Production-error audit and second pass

**Traced to root cause (each reproduced on a real Postgres, then fixed and regression-tested)**

- `PATCH worker_profiles` → 400: `audit_row_change()` read `new.id`, but `worker_profiles` and `client_users` have no `id` column (primary key is `user_id`). The trigger on `status` changes raised `42703` and rolled the update back, so suspending/reactivating a worker or client never worked.
- `POST project_updates` → 403: RLS was on and the table had only SELECT policies — no INSERT policy for any role, superadmin included.
- API tool `PATCH /get` → 405: the demo URL was hard-coded to `/get` and never followed the method dropdown. (Every non-GET method would have failed.)

**Also found and fixed:** duplicated "General" (the list query returned one row per channel member); project uploads failing (raw file names as storage keys, real errors discarded, file input never reset, managers and linked clients lacking storage permissions); an unsafe temp-password generator (up to 18.7% character bias); no security headers; any worker could add themselves to someone else's chat channel.

**Added:** private 1:1 chat with a People directory; global presence; group-call invitations on any page; unread badges; chat attachments; Security monitor (database + GitHub + Vercel + headers); TURN relay self-test; expanded Settings; real overview dashboards for every role; failed-request diagnostics (status, code, message, hint — never tokens or bodies); build- and run-time guard against shipping a service key.

See `docs/DEPLOY_CHECKLIST.md` for what you must run, and `docs/SECURITY_MONITOR.md`.

## Not done — don't assume otherwise

- **Rich-text editing**: still a plain-text / lightweight-Markdown editor, not TipTap/Lexical.
- **Dynamic sitemap generation**: `public/sitemap.xml` is static.
- **TURN relay**: calls work on most networks with STUN alone; some corporate/symmetric-NAT pairs need a TURN server
  (`VITE_TURN_*`). Not provisioned by this repo.
- **1:1 vs group calls**: joining a group call during a 1:1 call is blocked, but an *incoming* 1:1 call while you are in a group call is not auto-declined as "busy".
- **Group calls are a mesh** (one connection per pair), comfortable to ~6 people. Beyond that an SFU is the right tool.
- **Project file visibility**: linked clients can read every file on their project (same as the existing `client_id`
  rule). There is no per-file "internal only" flag.
- **Visual verification**: no browser was available while building this pass, so layouts were verified by type-check,
  lint, build and DOM tests, not by eye. Look at every page once before shipping.

## Verification

`npx tsc -b`, `npm run lint`, `npm run build`, and `npm test` (Node tests + Vitest/jsdom DOM tests) all run clean.
The RLS migration was applied on top of every existing migration in Postgres 16 and exercised with simulated users.

