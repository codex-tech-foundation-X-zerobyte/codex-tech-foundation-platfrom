# Workspace Architecture

_Describes the repository as audited on 2026-10-07 and the target direction. Update when architecture changes._

## 1. Frontend
- Stack: Vite 8, React 19, TypeScript 6, react-router 7, lucide-react. No state library; contexts + hooks (`useAsyncData`, `usePermission`).
- Entry: `src/main.tsx` → `src/App.tsx`. Providers (outermost→inner): ErrorBoundary, `AuthProvider`, `ToastProvider`, `PresenceProvider`, `ChatActivityProvider`, `CallProvider`, `GroupCallProvider`; `CallUI` / `GroupCallUI` render above the router.
- Routing (`App.tsx`): public site; `/login`; three role shells built by `<Workspace>`: `/worker/*` (worker, superadmin), `/admin/*` (superadmin, manager), `/client/*` (client). Every page is `lazy()`. Guard = `ProtectedRoute` (role list) → `ChangePasswordGate` → `WorkspaceLayout` (sidebar/topbar driven by `navConfig.tsx`; `superadminOnly` items filtered by `navForRole`).
- Data access: `src/lib/services/*` (one module per domain) wrapping the Supabase client; types in `src/lib/types.ts` (hand-maintained mirror of schema).
- UI kit: `src/components/ui/*`; tokens in `src/styles/tokens.css`.
- Tests: `tests/*.test.mjs` (node:test) and `tests/dom/*` (vitest + Testing Library); SQL tests in `supabase/tests/`.

## 2. Backend (Supabase)
- Postgres with RLS on all tables; migrations in `supabase/migrations/` (28 files, ordered by timestamp).
- Edge Functions (`supabase/functions/`): change-password, create-client, create-worker, create-resume-upload-url, health, resolve-client-login, resolve-worker-login, security-monitor, send-notification, submit-contact, submit-job-application, submit-lead. Shared: `_shared/auth.ts` (`authorizeCaller`), `rateLimit.ts`, `securityProviders.ts`.
- Storage buckets: project assets, private project files, resources, applications (résumés), chat uploads.

## 3. Database entities (existing)
profiles, user_roles, roles, permissions, role_permissions, departments (slug, is_system), worker_profiles (department_id, department_role), clients, client_users, client_projects, projects, project_members, project_milestones, project_requests, project_updates, project_files, tasks, resources, leads, applications, blog_posts, case_studies, team_profiles, careers, content_pages, chat_channels, chat_channel_members, chat_messages, calls, group_calls, group_call_participants, notifications, notification_preferences, push_subscriptions, audit_logs, settings, system_settings, rate_limit_events.
Realtime channel names must be unique per subscription (see `subscribeToNotifications`): supabase-js returns the existing channel for a repeated topic and throws on `.on()` after `.subscribe()`.
(`audit_log` was consolidated into `audit_logs` in `20260914000000`.)

## 4. Permissions (current model)
- `profiles.role` ∈ worker | manager | superadmin | client: routing + superadmin bypass.
- `has_permission(key)` / `has_permission_for(user, key)`: superadmin always true; others via `user_roles → role_permissions → permissions`. Role-level only.
- Role/permission/security/system-settings tables are guarded by `current_role() = 'superadmin'` directly (not via permission keys).
- Several operational tables still use `current_role() in ('worker','superadmin')` ⇒ all workers see all tasks/requests/files/clients. See `docs/RBAC.md`. This is the main thing to change for spec §53.
- UI hiding (`usePermission`, `superadminOnly`) is a convenience only; RLS is the enforcement.

## 5. Department architecture (pre-provisioned, template-driven)
- The eight Codex departments ship with the product. `supabase/migrations/20260926000000_preprovisioned_departments.sql` seeds them (`departments.slug`, `is_system = true`); the migration adopts same-named hand-made rows and never duplicates. System departments cannot be deleted or re-slugged (trigger).
- `src/workspaces/definitions.ts` holds one `DepartmentDef` per department: identity, accent, dashboard cards, sections (in-page navigation), boards (workflow stages), tools (status derives from `builtin` / `integration` / planned), channels, metrics, suggested roles. The database `slug` must equal the definition `slug` and `name` (a test parses the migration to enforce it).
- `src/workspaces/DepartmentEnvironment.tsx` renders ANY definition; `pages/admin/AdminDepartments.tsx` (overview + `/admin/departments/:slug`) and `pages/worker/WorkerDepartment.tsx` (`/worker/department`) are thin wrappers. To add a department: add a seed row + a definition (future: a template).
- Membership: `worker_profiles.department_id` + `department_role` (`member` | `admin`). Only a superadmin can change `department_role` (trigger `guard_department_role`, independent of RLS). A worker moved to another department loses admin there. Departments are readable by internal accounts (worker/manager/superadmin), writable only by superadmin.
- Honest-by-construction: `integrationStatus()` always returns `not_connected` until an integrations backend exists; metrics never show numbers without a source.
- Department-scoped (since 20260927): `project_departments`, department tasks (`tasks.department_id`/`stage`), `announcements`. Helpers `current_department_id()` and `is_department_admin(dept)` (active admins only).
- NOT yet department-scoped: projects/files/clients still use the old "all workers are one trusted group" RLS (see `docs/RBAC.md`). Department-scoped RLS is the next security milestone.

### Project model
Project (company-level, created once by the Main Admin) -> `project_departments` (objective, deliverables, deadline, status assigned > accepted > in_review > changes_requested > completed) -> tasks carrying `department_id` + the department's workflow `stage` (stage text lives in `definitions.ts`; task `status` is derived from stage position by `stageStatus()`). Distribution from the browser is not transactional, so `distributeProject()` deletes the project if the assignments fail.

## 5b. Visibility, lifecycle, records, integrations (2026-10-08)
- **Visibility:** `can_see_project()` / `can_edit_project()` (security definer) are the single rule for everything under a project. `current_department_id()` and `is_department_admin()` (active admins only) are the department primitives. Policies call these; they never trust the `worker` role alone.
- **Access ends with the account:** `current_role()` returns null for suspended / banned / inactive / review / offboarded workers, which fails every `current_role() in (...)` policy and `has_permission()`.
- **Lifecycle:** `worker_profiles.status` has eight states; `guard_worker_status` allows changes from a Main Admin, a trusted server, a nested trigger (cases) or a manager holding `workers.suspend` (never to/from offboarded), and refuses direct changes while a case is open. `suspension_cases` is decided only by a Main Admin; events are append-only; nothing is deleted.
- **Records engine:** `department_records(department_id, kind, stage, fields jsonb, ...)`. What a kind means (stages, fields, calendar dates, closed stages) lives in `definitions.ts`; adding a department tool needs a definition, not a migration. Form validation, field visibility and dashboard counts are pure functions in `workspaces/records.ts`.
- **Tools:** each `ToolDef` has exactly one backing (builtin page, record kind, KB category, files category, native tool, external launcher); `NATIVE` in `DepartmentToolPage.tsx` is a `Record<NativeTool, ...>` so an unimplemented native tool is a compile error.
- **Integrations:** secrets live in `integration_secrets` (RLS on, no policies, privileges revoked); only Edge Functions with the service role read them. Repository access is decided by RLS on `integration_repositories` queried with the CALLER's token inside the function, so the database rules are the only rules. `webhook-inbox` is public by design: the unguessable token is the capability, bodies are capped, credential headers dropped, inboxes keep 200 requests.
- **Calendar:** pure helpers in `lib/calendar.ts`; sources are meetings, assignment deadlines, task due dates and each record kind's dated fields.

## 6. Realtime
Presence, chat, calls and notifications use Supabase Realtime (see `docs/REALTIME.md`, `docs/CALLS.md`). Providers sit above the router so alerts work on every page.

## 7. Integrations
Security monitor providers (`securityProviders.ts`), TURN relay env vars, web push subscriptions. No GitHub/Figma/Canva project integrations yet.

## 8. Target architecture (from master spec; not yet built)
`Shared Company Core + Department Workspaces + Role/Permission Layer + Specialized Tools + Cross-Department Projects`
- Add `department_members(user_id, department_id, dept_role)`, department-scoped SQL helpers, project↔department assignment (`project_departments`), approvals, announcements, meetings, knowledge docs, onboarding, worker lifecycle states.
- Department workspaces live as lazy-loaded route modules (e.g. `src/workspaces/<dept>/`) sharing the design system and a single AppShell whose nav is computed from (department, role, permissions), replacing the hardcoded `WORKER_NAV` / `ADMIN_NAV` lists.
- Authorization must stay server-side (RLS + Edge Functions); never rely on hidden routes.

## 9. Important decisions
See `WORKSPACE_PROGRESS.md` → Architecture Decisions (D1–D4, open D-open-1..3).
