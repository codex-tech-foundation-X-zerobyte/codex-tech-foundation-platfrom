# Architecture — Codex Tech Foundation Platform

This is the canonical description of how the system fits together. If you are
an AI coding agent or a new developer: **read this file, DATABASE-SCHEMA.md,
AUTH-RULES.md, RBAC.md, and REALTIME.md before adding or changing anything.**
Do not invent a competing table, route, service, storage bucket, or auth
mechanism if one already exists here — extend it, or if it's genuinely
missing, add it and document it in the same change.

## One-sentence architecture

React/TypeScript/Vite talks directly to Supabase (Postgres + Auth + Storage +
Edge Functions) using only the public anon key; every authorization decision
is enforced by PostgreSQL Row Level Security, never by the frontend alone.

## Layers

```
Public website + Worker/Manager/Admin/Client workspaces  (src/pages, src/layouts)
                              │
                    src/lib/services/*.ts   ← all Supabase queries live here,
                              │                never inline in a page component
                    src/lib/supabase.ts (anon-key client)
                              │
              ┌───────────────┼────────────────┐
              │                                 │
     Supabase Postgres + RLS            Supabase Edge Functions
     (supabase/migrations/*.sql)        (supabase/functions/*)
              │                                 │
              └────────────── Supabase Auth ────┘
```

- **Browser holds only the anon key.** `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` in `.env.local`. Never put
  `SUPABASE_SERVICE_ROLE_KEY` anywhere the bundler can reach.
- **Every privileged/public-write action is an Edge Function**, not a direct
  table write from the browser: creating a worker/manager account
  (`create-worker`), resolving Worker ID → session (`resolve-worker-login`),
  and the three public forms (`submit-lead`, `submit-contact`,
  `submit-job-application`, plus `create-resume-upload-url`). See
  API-CONTRACT.md for the exact contract of each.
- **Authorization is RLS + the `has_permission()` Postgres function**, not
  frontend role checks. The frontend nav (`src/layouts/navConfig.tsx`) hides
  links a role shouldn't see, but that is a UX convenience — the database
  enforces the real boundary either way. See RBAC.md.

## Directory map

```
src/
├── lib/
│   ├── supabase.ts       — the one Supabase client (anon key)
│   ├── auth.tsx           — AuthProvider/useAuth: loads `profiles` row on session change
│   ├── types.ts           — canonical TypeScript types, mirrors the schema
│   └── services/          — one file per domain; ALL Supabase queries go here
├── components/ui/         — design system (Button, Table, Modal, Field, Toast, ...)
├── layouts/                — WorkspaceLayout + per-role nav config
├── pages/
│   ├── public/             — marketing site, reads published rows only
│   ├── auth/                — Login
│   ├── worker/, admin/, client/ — role workspaces
│   └── cms/                 — content editors, shared across worker/admin routes
└── App.tsx                 — routing + per-role route guards (ProtectedRoute)

supabase/
├── migrations/             — one file per change, applied in order, never edited after merge
└── functions/               — Edge Functions (Deno), one directory per function
```

## What actually exists today vs. what's planned

This matters more than the target diagram in the original brief. As of this
pass:

**Real and working (frontend + service + RLS + real data):**
public website (all pages), worker/admin/client dashboards, projects list,
task board, full CMS (blog, case studies, team profiles, careers —
draft/publish/archive), applications review with private resume access,
Team Files (folders, drag-and-drop multi-upload, real trash with
restore/permanent-delete, versioning, download tracking, search, storage
usage — all on Supabase Storage), Team Chat (team/project/DM channels,
Realtime message delivery, attachments, edit/soft-delete), Voice/Video
Calls (WebRTC mesh, voice + video, per-channel — see REALTIME.md for the
honest caveats on broadcast signaling and TURN-less NAT traversal), roles &
permissions grid, worker AND client provisioning (Worker ID / Client ID +
temp password issuance), audit log viewer, manager role, three-mode login
(Worker/Manager, Client, Super Admin).

**Schema/RLS exists, no UI yet:** cross-project task view, project
workspace tabs (milestones/files/activity as a single project detail
page), client-side project file/update views (client portal still shows
placeholders for its own project files/updates — Team Files is the
internal team library, not yet extended to client-visible deliverables).

**Does not exist at all — not a stub, genuinely absent:** Cloudflare R2
(storage is 100% Supabase Storage — deferred intentionally per the
platform owner's instruction), CI pipeline, PWA offline queue (service
worker caches the app shell only), project status lifecycle migration,
session revocation on suspension, presence/typing/read-receipts/reactions/
mentions in Chat, an SFU for Calls beyond a handful of concurrent
participants, TURN server (STUN-only NAT traversal).

Don't build a second implementation of any "does not exist" item without
checking here first — if it's still absent, this file is stale and should be
updated as part of building it, not worked around.

## Non-negotiables carried over from the project brief

- No hardcoded Super Admin credentials anywhere. See AUTH-RULES.md.
- No service-role key in frontend code, ever.
- No fake dashboard statistics — an honest empty state beats a fabricated number.
- No dead `href="#"` for real functionality — a disabled button with a reason
  beats a link to nowhere.
- One canonical table per concept. `audit_logs` is canonical;
  `audit_log` (singular, from the very first migration) is retained
  un-dropped for data-safety but nothing in the app reads or writes it. Same
  status for `settings` vs `system_settings` — `system_settings` is
  canonical going forward.
