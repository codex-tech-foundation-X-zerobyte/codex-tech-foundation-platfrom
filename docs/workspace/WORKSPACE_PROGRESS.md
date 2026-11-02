# Workspace Progress

_Last updated: 2026-10-08. Phases B-E and most of F-G are implemented; see "Completed: the full Workspace layer" and WORKSPACE_DEPLOYMENT.md._
**Also read `WORKSPACE_ORGANIZATION_ASSESSMENT.md` (honest scorecard).** **Read `WORKSPACE_ARCHITECTURE_CORRECTION.md` first: departments are pre-provisioned and template-driven, never created by the Main Admin.**
Source of truth for vision: `WORKSPACE_MASTER_PROMPT.md`. Architecture: `WORKSPACE_ARCHITECTURE.md`.

## Baseline (verified 2026-10-07 on the uploaded `codex-tech-foundation-refined.zip`)
- `npm ci` OK · `npm run build` OK (tsc -b + vite) · `npm run lint` 0 errors / 9 warnings · `npm test` 123 vitest tests pass (14 files) plus node:test suites.
- Any regression against this baseline must be fixed before moving on.

## Completed (pre-Workspace platform work, still valid)
- Vite + React 19 + react-router 7 + Supabase (Postgres/RLS/Edge Functions), deployed (Vercel + Supabase).
- Design system primitives in `src/components/ui/` (Button, Badge, Surface, Table, Modal, Toast, Field, Skeleton, EmptyState, ErrorState, PageHeader, SearchInput, Switch, CopyButton).
- Auth (`lib/auth.tsx`), forced password change gate, worker/client login resolvers, rate limiting.
- Three role shells (`/worker`, `/admin`, `/client`) with lazy-loaded routes; `ProtectedRoute` by role.
- Projects, tasks (kanban), clients, leads, applications, CMS (blog, case studies, team, careers), resources/files.
- Team chat (channels, DMs, general channel, project channels auto-provisioned), 1:1 calls, group calls, TURN support, presence, chat activity.
- Notifications (in-app + send-notification function), audit log trigger + admin audit page, security monitor, system status, dev tools.
- RBAC base: `roles`, `permissions`, `role_permissions`, `user_roles`, `has_permission()` / `has_permission_for()`, `/admin/roles` grant grid.
- Docs in `docs/` (RBAC, REALTIME, CALLS, SECURITY_MONITOR, etc.).

## Gap analysis vs master spec (Phase A findings)
| Spec area | Current state | Gap |
|---|---|---|
| Identity | Product/branding is "Portal/Platform"; package `codex-tech-foundation-platform` | Rename to Workspace in UI copy/titles/docs |
| Departments | **Done (foundation):** 8 pre-provisioned departments, definitions, environments, Department Admin role (assignable by Main Admin only), worker auto-assignment to environment | Department-scoped RLS (what a Department Admin may see/do beyond their label), real boards backed by tasks, department channels, suspension requests |
| Roles | `app_role` enum = worker, manager, superadmin, client. Role drives routing (`roleHome`) and a superadmin bypass | No Department Admin, Team Lead, or External Collaborator levels. `manager` is a global operational role, not department-scoped |
| Permissions | Role-level only (no per-user or per-department scoping). Many tables still use `current_role() in (...)` | Need department/project-scoped authorization; convert remaining hardcoded checks |
| Worker lifecycle | `WorkerStatus` = active/suspended/banned/inactive | No INVITED/SUSPENSION_PENDING/REVIEW/OFFBOARDED states, no suspension-request → Main Admin approval flow |
| Projects | Single `projects` table, `project_members(project_id,user_id)`, milestones, requests, updates | No `project_departments`, objectives/deliverables, per-department assignment, templates, or multi-step creation flow (`CreateProjectModal` is single modal) |
| Tasks | `todo/in_progress/blocked/done`, one assignee, priority, due date | No department, creator, labels, checklist, dependencies, comments, watchers, review states, per-department workflows |
| Workers see too much | RLS treats all workers as one trusted group on tasks/requests/files/clients (documented in RBAC.md) | Conflicts with spec §53 (least-privilege, project-scoped visibility) — highest-risk change |
| Home / My Work | Role dashboards (`WorkerDashboard`, `AdminDashboard`) | No company Home, announcements, or unified My Work |
| Approvals | None (only project requests from clients) | New central approval queue |
| Announcements | None (admin can send notifications) | New module (+ acknowledgement) |
| Meetings / Calendar | Calls exist (1:1 + group) | No meeting records, agenda/notes/action items, or calendar |
| Knowledge base | None | New module |
| Onboarding | Forced password change only | New checklist system |
| Search / Command palette | `CommandPalette.tsx` exists | Verify scope; add permission-aware global search |
| Audit | `audit_logs` + triggers + `/admin/audit` (superadmin) | Add filters (user/dept/project/severity), more event types, tamper protection review |
| Dept workspaces | One generic worker shell; Dev tools + Content CMS bolted into worker nav | Need modular per-department nav/dashboards (Development, Security, Design, Marketing, Content, AI Lab, Growth) |
| Integrations | Security monitor providers (Supabase/GitHub etc.), TURN | No GitHub project/repo linking, Figma/Canva links, integrations hub |
| Company Pulse | `AdminDashboard` has company metrics | Rework as Company Pulse (activity, not employee scores) |
| Files | `resources` + `project_files` + storage buckets | No folder tree, per-file permissions, department association |
| Presence | `PresenceProvider` (online) | Away/Busy states, contextual "viewing" presence |
| Handoff docs | None | Created this session (`docs/workspace/`) |

## Completed in the Workspace effort (2026-10-07)
- **Bug fix (high):** `subscribeToNotifications` reused one realtime channel name per user; the shell's unread badge and `WorkerDashboard` both subscribe, so the 2nd call threw and put every worker's Overview into the error boundary. Channel names are now unique per subscription. Regression test: `tests/dom/notificationsSubscribe.test.ts` (verified failing without the fix).
- **Architecture correction (Phase B).** An earlier version of this effort shipped a generic "create / rename / delete department" page. That was the wrong model and has been removed. Now:
  - **Migration `20260926000000_preprovisioned_departments.sql`** seeds the eight Codex departments (`slug`, `is_system`), adopting same-named hand-made departments instead of duplicating them; system departments cannot be deleted or re-slugged; adds `worker_profiles.department_role` (`member` | `admin`) guarded by a trigger so only a Main Admin can assign Department Admins (and an admin moved to another department is demoted); lets internal accounts SELECT departments (previously only a superadmin could, so no worker could resolve their own department). Idempotent. Tested: `supabase/tests/preprovisioned_departments.test.sql` (14 checks) plus the three older SQL suites on a from-scratch migration chain (97 checks, all pass).
  - **Template-driven definitions** `src/workspaces/definitions.ts`: one declarative definition per department (dashboard cards, in-page sections, boards/workflows, tools with honest status, channels, metrics, integrations, suggested roles). Adding a department = adding a definition.
  - **`DepartmentEnvironment`** renders any definition (Overview / board / tools / integrations / channels / Team). Distinct per department (e.g. Cybersecurity has Security Operations + Security Lab with an authorised-use notice; Frontend has Sprint board + Dev tools). Nothing is sample data: unconnected integrations say "<X> not connected", metrics say "No data yet" / "No connected data source", tools are Available (exists in app) / Not connected / Planned.
  - **Pages:** `/admin/departments` (overview of the eight, head-count, Department Admins, unassigned-worker warning, legacy departments listed separately), `/admin/departments/:slug` (environment; Main Admin can make/remove Department Admins and move workers), `/worker/department` ("My department": the worker automatically gets the environment of the department they were assigned).
  - **Create worker** now requires a Department (only Codex departments are offered), suggests department-specific positions, and can create the worker as that department's admin (`create-worker` edge function accepts `department_role`, validates it, audits it).
- **Branding:** signed-in shell now shows "Codex Workspace / Tech Foundation" (`Brand workspace` prop). Public site keeps "Codex Tech Foundation".
- **Admin nav regrouped:** People / Work / Public site / Toolbox / System (was one 9-item "Operations" group mixing work and CMS).
- **UI fixes:** admin KPI row no longer orphans a 6th card on 1440px (`Dash.css`); removed emoji from worker empty state.
- Baseline now: build OK, lint 0 errors / 9 warnings, **153 vitest tests pass** + node:test suites; **97 SQL checks pass** (4 files) against local PostgreSQL 16 with Supabase stubs.

## Completed: project orchestration + company HQ (Phase E core, 2026-10-07)
- **Migration `20260927000000_project_orchestration_and_announcements.sql`** (tested, `supabase/tests/project_orchestration.test.sql`, 34 checks): helpers `current_department_id()` / `is_department_admin()` (active admins only); `projects.priority/start_date`; `project_departments` (one project, many departments; Main Admin assigns, Department Admin accepts / submits, only Main Admin completes or rewrites the brief; admins notified, or the Main Admin if a department has none); `tasks.department_id` + `stage` with department scoping (legacy null-department tasks unchanged; department tasks readable by that department or the assignee, creatable only by that department's admin AFTER accepting the assignment and only for members of the department; assignees can move but not rewrite/reassign); `announcements` (company or department; Main Admin company-wide, Department Admin own department; notification fan-out skips author and suspended accounts).
- **Bug found by the tests and fixed:** the first draft of the assignment read policy used `has_permission('projects.view')`, which the *worker* role holds by default, so every worker could read every department's assignments. Now managers only.
- **UI:** 3-step project wizard (Main Admin) with honest distribution result ("Ike notified" vs "No Department Admin yet"); assignments panel with role-appropriate actions; department board backed by real tasks (create, move, highlight own); Company HQ at `/worker/company` and `/admin/company` (announcements + composer, upcoming deadlines, live org chart); sign-in copy now says Codex Workspace.
- Tests now: **188 vitest** + node:test suites, **131 SQL checks** (5 files) on local PostgreSQL 16.
- Not done from the directive: suggested-task templates in the wizard, task checklists/comments/dependencies/watchers, per-task review states, clarification requests, department channels, suspension-request flow, department-scoped files/projects/clients, knowledge base, meetings, calendar, approvals inbox, onboarding, integrations.

## UI review notes (Playwright + mocked Supabase, 1440px and 390px)
- Harness: dev server with fake `VITE_SUPABASE_*` pointing at 127.0.0.1:54321, requests intercepted by Playwright route mocks, fake session in `localStorage` (`sb-127-auth-token`). Not committed (lives outside the repo); recreate if needed.
- Looks good: worker + admin overview, departments, mobile departments. Not yet reviewed visually: tasks board, chat, projects, client shell, public site. Admin Security page threw only because the mock returned a wrong shape for `security-monitor` (mock artifact, not verified against real data).
- Remaining UI observations: workspace is still three role shells with hardcoded nav; no company Home / My Work; breadcrumbs show role name ("Worker > Overview") rather than workspace/department.

## In Progress
- Phase C/D: environments are real but data-less. The boards are the workflow definition with empty states; they need tasks that carry a department and a workflow stage (Phase E: project -> department assignment -> tasks). Department Admin is a role *label* enforced only for who can assign it; the powers listed in the correction doc (break projects into tasks, assign workers, review, request suspension) are not built.
- **Known issue found while testing (NOT fixed, needs your decision):** no migration ever creates the `manager` role row. `20260914000002` grants manager permissions with `where r.name = 'manager'`, which matches nothing on a database built from migrations alone, and `sync_user_role()` finds no role to attach, so `manager` accounts have no permissions. Older SQL tests (`audit_trigger_and_project_updates`, `chat_dm_uploads_security_posture`) assume exactly that state, so production probably matches it. Fixing it would silently grant every existing manager ~23 permissions (clients, projects, workers.update, resources...), so it was deliberately NOT included in the departments migration. Decide: map managers to Department Admins instead, or create the role with explicit grants.

## Blocked
- None. Decisions needed from the owner are listed under Architecture Decisions (D-open).

## Not Started
Phases B–H of spec §62 (foundation, organization, project orchestration, communication, department workspaces, integrations, polish).

## Known Bugs
- None open that were reported against this zip. Earlier reported issues (input focus loss, call answer UI, API tool 405, `worker_profiles` 400, `project_updates` 403) have regression tests in `tests/dom/`; re-verify against production after deploy.
- Lint: 9 warnings (e.g. `useToast` export in `Toast.tsx` — react-refresh rule). Non-blocking.

## Architecture Decisions
- D1: Evolve the existing app in place; do not rewrite (spec §44).
- D2: One app, shared core + department modules lazy-loaded; no separate apps.
- D3 (proposed): Keep `profiles.role` as coarse account class for routing; add **department membership with a department role** (`department_members`) as the scoping layer. Do not overload the `app_role` enum with per-department roles.
- D4 (proposed): Reuse `departments`, `project_members`, `audit_logs`, `chat_channels`, `notifications`, `resources`; add new tables only for concepts with no existing equivalent (`project_departments`, `approvals`, `announcements`, `meetings`, `knowledge_documents`, etc.).
- D-open-1: Should existing `manager` accounts map to Department Admins, or stay as global operational managers?
- D-open-2: Should client (external) accounts remain a separate `/client` shell? (Assumed yes.)
- D-open-3: Which departments to seed first (spec lists Development, Cybersecurity, UI/UX, Marketing, Content, AI/ML, Growth).

## Database Changes
- None yet this effort (departments feature uses the existing schema). Latest migration: `20260925000000_chat_dm_uploads_security_posture.sql`. New migrations must sort after it.

## Environment / Integration Notes
- Frontend env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_CONTACT_*`, optional `VITE_TURN_URL/USERNAME/CREDENTIAL` (calls).
- Service-role key is server-side only (Edge Functions). Edge functions must call `authorizeCaller()` from `_shared/auth.ts`.
- Prod CSP is `Report-Only` in `vercel.json`.

## Completed: the full Workspace layer (2026-10-08)
- **Department-scoped visibility** (`20260928000000`): `can_see_project()` / `can_edit_project()`; projects, files, milestones, requests, updates, members, tasks, clients and resources follow department membership (unassigned projects stay visible so nothing vanishes). Found while testing: the worker role holds projects.view/update and clients.view by default, so permission shortcuts had to be removed for workers.
- **Lifecycle** (`20260928000001`): INVITED -> ACTIVE -> SUSPENSION_PENDING -> SUSPENDED -> REVIEW -> ACTIVE|OFFBOARDED. `suspension_cases` + append-only `suspension_case_events`; Department Admin raises, Main Admin decides (Restore / Continue / Move to review / Offboard with confirm). `current_role()` returns null for blocked statuses so access ends everywhere; the app also ends the session and shows why. A worker with an open case cannot have their status changed behind it. Invited -> active happens in the database when they first change their password.
- **Task depth:** checklist, comments (+ name mentions with a leak-proof recipient filter), dependencies (same project, no cycles, cannot finish while blocked), watchers, review state (assignee requests, Department Admin decides), GitHub links, attachments, progress notifications.
- **Company core** (`20260929000000`): meetings + participants + action items; knowledge base; onboarding progress; `department_records` engine (14 record types); whiteboards (optimistic locking); integrations with server-only secrets; webhook inboxes; task links; **25 department channels auto-provisioned and kept in sync**.
- **UI:** Approvals inbox, Company calendar with meetings, Knowledge base, Onboarding card, task drawer, records lists/forms/boards, Integrations hub, 65 department tools with no placeholders (a test fails otherwise): bug tracker, incidents, domain/SSL watch list, backup log, Security Lab (header analysis, DNS + SPF/DMARC, log analysis, configuration audit, training), whiteboard, webhook tester, script editor, campaign planner, analytics log, reports, files, GitHub repos/PRs/Actions, Figma/Canva launchers. Dashboard numbers are real counts.
- **Edge functions:** `integrations` (GitHub, token never leaves the server), `webhook-inbox` (public, capped, sanitised), `create-worker` / `resolve-worker-login` updated for INVITED.
- **Bugs found by the tests and fixed:** worker role could read all assignments; unreachable `notify_announcement` column; mention query excluded everyone when the assignee was null; plpgsql resolving `new.user_id` at plan time; status guard had to respect `workers.suspend`.
- Baseline now: build OK, lint 0 errors / 9 warnings, **299 UI tests, 148 node tests, 241 SQL checks**.

## Known limits and open items
- **Never run for real:** the `integrations` and `webhook-inbox` Edge Functions (no Deno available) and any live GitHub call. Their logic is unit-tested as pure modules. Run the smoke tests in WORKSPACE_DEPLOYMENT.md.
- Storage bucket (object) policies are not department-scoped; row access is.
- Domain/SSL expiry and backup status are manual logs; marketing analytics are manual entries with a stated source.
- `manager` role is still never created by any migration (see above); decide before relying on managers.
- Not built: global search, Company Pulse, per-project channels, suggested-task templates in the wizard, clarification requests, Department Admins creating workers, audit filters, announcement acknowledgement, presence Away/Busy, email/Telegram/AI integrations.

## Next Recommended Tasks
1. Deploy and run the smoke tests; fix whatever a real GitHub / Deno runtime reveals.
2. Department-scope storage object policies.
3. Global permission-aware search; Company Pulse; per-project channels.
4. Wizard task templates; clarification requests; Department Admins creating workers.
5. Audit filters; announcement acknowledgement; presence Away/Busy.
6. Decide the `manager` role question.
