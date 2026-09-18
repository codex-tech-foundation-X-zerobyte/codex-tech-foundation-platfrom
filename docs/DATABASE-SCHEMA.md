# Database Schema

Source of truth: `supabase/migrations/*.sql`, applied in filename order. This
document summarizes it for quick reference — if the two disagree, the
migrations are correct and this file is stale and needs fixing.

## Migration order

1. `20260912000000_initial.sql` — `profiles`, `projects` (v1), `project_members`, `notifications`, `audit_log` (superseded, see below), base RLS.
2. `20260912000001_platform_content.sql` — `clients`, `tasks`, `resources`, `project_updates`, `project_requests`, `project_files`, `content_pages`, `blog_posts`, `careers`, `applications`, `leads`, `settings` (superseded, see below), public storage buckets.
3. `20260912000002_architecture_rebuild.sql` — RBAC tables (`roles`, `permissions`, `role_permissions`, `user_roles`), `departments`, `worker_profiles`, `client_users`, `client_projects`, `project_milestones`, `case_studies`, `team_profiles`, `audit_logs` (canonical), `notification_preferences`, `push_subscriptions`, `system_settings` (canonical), `has_permission()` function, `projects.publication_status`/`published_at`/`public_visibility`.
4. `20260913000000_rls_audit_fixes.sql` — storage confidentiality fix, missing write policies, profile self-update policy.
5. `20260913000001_seed_roles_permissions.sql` — seed data for `roles`/`permissions`/`role_permissions`.
6. `20260913000002_resources_bucket.sql` — storage bucket + policies for the `resources` table.
7. `20260914000000_manager_role_enum.sql` — adds `'manager'` to the `app_role` enum.
8. `20260914000001_manager_role_rbac.sql` — manager role seed, `bootstrap_super_admin()`, CMS/leads/applications RLS gap fixes, storage policy updates for manager.
9. `20260914000002_rate_limiting.sql` — `rate_limit_events` + `check_rate_limit()`, used by public Edge Functions.
10. `20260915000000_client_provisioning.sql` — `clients.client_code`, RLS fix letting clients read their own company record.
11. `20260915000001_team_files.sql` — folders/trash/versioning/download-tracking columns on `resources`, `resource_versions` table, narrow `audit_logs` insert policy for file-activity logging.
12. `20260916000000_team_chat.sql` — `channels`, `channel_members`, `messages`, `can_access_channel()`, `create_dm_channel()`, `chat-attachments` bucket, **and a fix to `profiles` SELECT RLS** (see below — found while building Chat, not introduced by it).
13. `20260917000000_calls.sql` — `calls`, `call_participants`, reusing `can_access_channel()` from the Chat migration for access (no new membership model).

## Duplicate/legacy structures — READ BEFORE TOUCHING

- **`audit_log` (singular) is legacy.** It was created in the very first
  migration before the RBAC rebuild introduced `audit_logs` (plural), which
  has a richer shape (`severity`, `success`, `ip_address`, `user_agent`) and
  is what `has_permission('audit_logs.view')`-gated RLS protects. **Every
  service/Edge Function in this codebase writes to and reads from
  `audit_logs`.** `audit_log` was not dropped (avoiding a destructive
  migration against data that might exist in a live project) but nothing in
  the app touches it. If you're adding audit logging anywhere, use
  `audit_logs`.
- **`settings` (from `platform_content`) is legacy** in the same sense:
  `system_settings` (from `architecture_rebuild`, with `is_secret` and
  `updated_by`) is the intended destination for the Settings pages that are
  currently `ScaffoldPage` placeholders in all three workspaces. Neither
  table is read anywhere in `src/` today, so there is no live consolidation
  risk — just don't build against `settings`.
- **`profiles` SELECT RLS bug, found and fixed in Pass 5**: from the very
  first migration through Pass 4, the only SELECT policy on `profiles` was
  `id = auth.uid() or current_role() = 'superadmin'`. That meant any
  worker or manager viewing another team member's name — including
  `AdminWorkers.tsx`'s `listWorkers()`, live since Pass 3 — got an empty
  `display_name` for every row but their own, silently, for anyone who
  wasn't superadmin. Fixed additively in the Pass 5 migration (`team views
  colleague profiles`): any team-role viewer can see any team-role target's
  basic profile row. Client profiles are unaffected (excluded on both
  sides of that policy) — this did not widen client visibility.

## Core tables (grouped)

**Identity/RBAC**: `profiles` (id = auth.users.id, `role` enum:
`worker`|`manager`|`superadmin`|`client` — coarse classification and route
guarding), `worker_profiles` (worker_id, department, status, `must_change_password`), `client_users` (links a profile to a `clients` row), `roles`/`permissions`/`role_permissions`/`user_roles` (fine-grained authorization — see RBAC.md), `departments`.

**Projects**: `projects` (status enum `planning|active|review|complete` —
NOTE: this is the v1 status set; the brief's proposed
`planning|in_development|active|maintenance|paused|completed|archived` was
**not** migrated in this pass, see ROADMAP.md), `project_members`,
`client_projects`, `tasks`, `project_milestones`, `project_updates`,
`project_requests`, `project_files`.

**CMS/CRM**: `content_pages`, `blog_posts`, `case_studies`, `team_profiles`,
`careers`, `applications`, `leads`, `clients`.

**Platform**: `notifications`, `notification_preferences`,
`push_subscriptions`, `audit_logs`, `system_settings`, `rate_limit_events`.

**Chat**: `channels` (`kind`: `team`|`project`|`dm`), `channel_members`
(DMs only — team/project membership is computed, not stored; see RBAC.md-
style note in REALTIME.md), `messages`.

**Calls**: `calls` (always scoped to a `channel_id`), `call_participants`
(join/leave tracking; not the access gate — `can_access_channel()` on the
call's channel is).

## Storage buckets

| Bucket | Public | Scoping |
|---|---|---|
| `public-content` | yes | published content only; superadmin uploads |
| `private-project-files` | no | path-prefixed by `project_id`; project owner/client or worker/manager/superadmin |
| `project-assets` | no | same scoping as above |
| `applications` | no | anonymous upload via signed URL from `create-resume-upload-url` only, random path |
| `resources` | no | worker/manager/superadmin read/upload/delete |
| `chat-attachments` | no | path-prefixed by `channel_id`; access follows `can_access_channel()`, same rule as the message itself |

## Key Postgres functions

- `current_role()` — returns the caller's `profiles.role`. Used for coarse
  role checks (`in ('worker','manager','superadmin')`) where that's the
  correct granularity.
- `has_permission(permission_key text)` — returns true if the caller's
  `user_roles` → `role_permissions` grants that key, OR if
  `profiles.role = 'superadmin'` (superadmin always passes, independent of
  seed data). Used for anything that should be independently grantable.
- `check_rate_limit(bucket, identifier, max_attempts, window_seconds)` —
  security-definer, callable only by `service_role`; the shared rate-limit
  primitive for Edge Functions.
- `bootstrap_super_admin(target_user_id, target_display_name)` —
  security-definer, callable only by `service_role`/`postgres`; see
  AUTH-RULES.md.
- `can_access_channel(p_channel_id)` — the single membership check for
  Chat; every RLS policy on `channels`/`channel_members`/`messages` and the
  `chat-attachments` storage policies call this instead of re-deriving
  membership logic per policy. See REALTIME.md.
- `create_dm_channel(other_user_id)` — security-definer; the one place a
  DM's two `channel_members` rows are created together. A plain insert
  can't do this (RLS only allows inserting your own membership row).
