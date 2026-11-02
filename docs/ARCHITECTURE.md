# Architecture

This document reflects the ACTUAL implementation as of this writing. If code and
this document disagree, that's a bug — fix the code or fix the doc, but don't
let them drift. Before adding a new table, service, edge function, or type,
search this file and the other docs in this folder first. See CONTRIBUTING.md
for the exact rule.

## Stack

React + TypeScript + Vite, Supabase (Postgres, Auth, Edge Functions, Storage,
Realtime). No other backend. No other frontend framework. See
`package.json` for exact versions — don't assume, check.

## Layers

```
Public website  |  Worker platform  |  Admin platform  |  Client portal
        └──────────────────┬──────────────────────────────────┘
                    Auth + RBAC (see AUTH-RULES.md, RBAC.md)
                            │
                     src/lib/services/*  (one module per domain — see below)
                            │
                     Supabase (Postgres + RLS, Edge Functions, Storage)
```

## Frontend structure

- `src/components/ui/` — the component library (Button, Badge, Surface, Table,
  Modal, Toast, form fields, etc). Reuse these; don't create ad-hoc variants.
- `src/layouts/` — `PublicLayout` (public site chrome) and `WorkspaceLayout`
  (shared sidebar/topbar shell for worker/admin/client, configured per role
  via `navConfig.tsx`). `navForRole()` in `WorkspaceLayout.tsx` hides
  `superadminOnly` nav items from non-superadmins.
- `src/pages/` — one folder per surface: `public/`, `auth/`, `worker/`,
  `admin/`, `client/`, `cms/`. `ScaffoldPage.tsx` is the honest placeholder
  for workspace sections not yet built — it shows a real live row count where
  possible, never fake data.
- `src/lib/types.ts` — canonical TypeScript types. One definition per concept.
  If you need a type for something in the schema, check here first.
- `src/lib/services/` — one file per domain (`projects.ts`, `tasks.ts`,
  `content.ts`, `workers.ts`, `roles.ts`, `blogAdmin.ts`, `resourceFiles.ts`,
  `leads.ts`, `workspace.ts`, `shared.ts`), re-exported from `index.ts`. Pages
  call these; pages should not contain raw Supabase queries.
- `src/hooks/useAsyncData.ts` — shared fetch-on-mount/fetch-on-key-change
  hook. Use this instead of hand-rolling `useEffect` + `useState` for data
  fetching in a page.
- `src/lib/auth.tsx` — `AuthProvider`/`useAuth()`. Holds the current session's
  `profile` (id, display_name, role, organization, avatar_path, status).

## Backend structure

- `supabase/migrations/` — every schema change is a migration file, applied
  in filename order. Never hand-edit a live schema outside a migration.
- `supabase/functions/` — edge functions for anything that needs the
  service-role key or must not trust the client (validation, provisioning,
  privileged reads). `supabase/functions/_shared/` holds reusable helpers
  (`rateLimit.ts`, `auth.ts`) — import from there, don't copy-paste.
- `supabase/bootstrap/` — manually-run, one-time scripts. NOT applied by
  `supabase db push`. Currently: `create-superadmin.sql`.

## Current implementation status (honest, not aspirational)

Built and wired end-to-end: public website (all pages, real Supabase data),
auth (Worker ID / Client ID / admin email, role-based routing, forced
password change on first login), worker/admin/client dashboards, blog +
case study CMS (draft→publish→archive), team + careers CMS, permissions UI
(`/admin/roles`), file manager for internal resources, worker/client
provisioning edge functions, rate limiting on all public-facing edge
functions, manager role with narrower RBAC than worker, applications review
(with signed-URL résumé access), lead CRM, audit log viewer, project
creation, notification sending (`/admin/roles`-style permission-gated
broadcast, plus 1:1), Team Chat (Realtime, presence, channel-scoped RLS,
General channel auto-seeded and auto-joined) with 1:1 voice/video calling
(WebRTC, signaling via Realtime broadcast — implemented but not live-tested
across real browsers, see REALTIME.md).

Not built yet (see individual docs for target design where one exists):
group/conference calls (would need an SFU), Cloudflare R2 storage adapter
(Supabase Storage is the working path today), worker ID card image
generation, DM channels in chat, calendar, global search, command palette,
full live RLS-matrix test suite. Each of these needs follow-up work — don't
assume any of them exist because this doc lists them, this section exists
specifically so nobody assumes that.
