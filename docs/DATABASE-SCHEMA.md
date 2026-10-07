# Database Schema

Canonical reference. Full DDL lives in `supabase/migrations/` (applied in
filename order) — this is a map of what exists and why, not a copy of the SQL.
If you're about to create a table, **search this list first.**

## Removed (do not recreate)

- `audit_log` (singular) — superseded by `audit_logs`. Dropped in
  `20260914000000_consolidate_duplicates.sql` after migrating any rows.
- `settings` (singular) — superseded by `system_settings`. Same migration.

If you find code anywhere referencing either of these, it's a bug — fix the
reference, don't recreate the table.

## Identity & RBAC

- **profiles** — one row per `auth.users` row (via `on_auth_user_created`
  trigger → `provision_profile()`). `role` is the `app_role` enum
  (`worker` | `manager` | `superadmin` | `client`) — coarse classification
  and routing only. See RBAC.md for how this relates to real authorization.
- **roles**, **permissions**, **role_permissions**, **user_roles** — the
  actual authorization system. `user_roles` is kept in sync with
  `profiles.role` automatically by the `sync_user_role()` trigger
  (`on_profile_role_set`) — don't populate it manually.
- **worker_profiles** — one per worker/manager login. `worker_id` (e.g.
  `CTF-WKR-A1B2C3D4`) is the login identifier. `status`:
  `active | suspended | banned | inactive`. `must_change_password` flag exists
  but isn't enforced by the frontend yet (see AUTH-RULES.md).
- **client_users** — one per client login (a `clients` company can have more
  than one). `client_code` (e.g. `CTF-CLI-A1B2C3D4`) is the login identifier.
  `status`: `active | suspended | banned | inactive | closed`.
- **departments** — worker department reference table.

## Projects & work

- **clients** — the company/account record. `status`:
  `prospect | active | paused | archived` (business lifecycle, separate from
  `client_users.status` which is account-access status).
- **client_projects** — join table: which clients can see which projects.
- **projects** — `status` (`project_status` enum): `planning | in_development
  | active | maintenance | paused | completed | archived` — migrated in
  `20260916000000_project_status_vocabulary.sql` from the original 4-value
  enum (`planning|active|review|complete`). Postgres enums can't have values
  removed in place, so this created a new type, remapped existing rows
  (`review`→`in_development`, `complete`→`completed`), and swapped it in —
  see that migration's header comment for the exact mapping reasoning.
- **project_members** — worker assignment to a project.
- **tasks** — `status`: `todo | in_progress | blocked | done`. `priority`:
  `low | normal | high | urgent`.
- **project_milestones**, **project_updates**, **project_requests**,
  **project_files** — see their respective columns in the migrations; RLS
  scopes client visibility to their own project via `client_projects`.

## CMS / public content

- **blog_posts** — full CRUD via `src/lib/services/blogAdmin.ts` +
  `/admin/content` and `/worker/content/blog`. The only content type with a
  complete editor so far.
- **case_studies** — full CRUD via `src/lib/services/caseStudyAdmin.ts` +
  `/admin/content/case-studies` and `/worker/content/case-studies`. Same
  draft/publish pattern as blog.
- **team_profiles**, **careers**, **content_pages** — exist in the schema
  with RLS policies, but have no dedicated admin editor yet (both are
  `ScaffoldPage` placeholders in the nav; `content_pages` isn't wired into
  the frontend at all).

## CRM / hiring

- **leads** — `status`: `new | contacted | qualified | converted | closed`
  (matches `LeadStatus` in `types.ts`; the spec's `new|contacted|qualified|
  proposal|won|lost` was not migrated to). **No public INSERT policy** —
  writes only via the `submit-lead`/`submit-contact` edge functions using the
  service-role key. This was a real vulnerability before
  `20260914000002_manager_rbac_and_security_fixes.sql` — see AUTH-RULES.md.
- **applications** — job applications. Same pattern: no public INSERT policy,
  writes only via `submit-job-application`. `resume_path` points into the
  private `applications` storage bucket (signed URLs only, see
  FILE-STORAGE.md).

## Platform

- **resources** — internal file manager records (see FILE-STORAGE.md).
- **notifications**, **notification_preferences**, **push_subscriptions** —
  in-app notifications exist and are used (`NotificationsPage.tsx`). Push
  notifications have a table but no sending implementation yet.
- **audit_logs** — canonical audit table (see AUTH-RULES.md for what's
  actually logged today).
- **system_settings** — canonical key/value settings table. No admin UI
  reads/writes it yet.
- **rate_limit_events** — backs `check_rate_limit()`; written/read only by
  edge functions via service role, no RLS policies at all (correct — nothing
  else should touch it).

## Storage buckets

`project-assets`, `private-project-files`, `public-content`, `applications`,
`resources`. See FILE-STORAGE.md for access rules — `project-assets` in
particular had a real confidentiality bug (fixed in
`20260914000000`/`20260913000000`'s predecessor migration) that's worth
reading about before touching bucket policies again.
