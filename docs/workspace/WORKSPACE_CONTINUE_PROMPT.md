# Continue Prompt (paste into a new Claude session with the repo ZIP attached)

You are continuing development of **Codex Tech Foundation Workspace**.

Before changing any code:
1. Read `/docs/workspace/WORKSPACE_ARCHITECTURE_CORRECTION.md` FIRST (departments are pre-provisioned and template-driven; the Main Admin never builds departments), then `/docs/workspace/WORKSPACE_MASTER_PROMPT.md` (the wider vision).
2. Read `/docs/workspace/WORKSPACE_PROGRESS.md` (current state, gap analysis, next tasks).
3. Read `/docs/workspace/WORKSPACE_ARCHITECTURE.md`.
4. Skim `/docs/RBAC.md`, `/docs/REALTIME.md`, and the latest files in `supabase/migrations/`.
5. Inspect the real repository (routes in `src/App.tsx`, `src/layouts/navConfig.tsx`, `src/lib/services/`, migrations) and verify what is implemented. Do not assume earlier chat context exists; the docs are the project memory.

Then:
- Run `npm ci`, `npm run build`, `npm run lint`, `npm test` and confirm the baseline recorded in the progress file. Fix regressions first.
- Identify what is complete, partial, broken, and next. Do not rebuild working features. Preserve existing functionality (chat, calls, presence, notifications, CMS, security monitor, RBAC).
- Work in the order of spec §62 phases, incrementally. Phase C (department membership, scoped RLS, lifecycle, approvals) comes before project orchestration.
- Enforce authorization in RLS / Edge Functions, never only in the UI. Add SQL tests in `supabase/tests/` and DOM tests in `tests/dom/` for new behavior. New migrations must sort after the latest existing one.
- No fake data: unavailable integrations/metrics must show a clear "not connected" state.
- After meaningful work: update `WORKSPACE_PROGRESS.md` (completed / in progress / bugs / DB changes / next tasks) and `WORKSPACE_ARCHITECTURE.md` if architecture changed; record decisions; run build, lint and tests.
- Keep the vision intact: one company, shared core, department workspaces, least-privilege permissions, desktop-first, calm professional UI.

Also read `/docs/workspace/WORKSPACE_DEPLOYMENT.md` (deploy order, smoke tests, what changes for existing users) and `/docs/workspace/WORKSPACE_ORGANIZATION_ASSESSMENT.md`. Run `supabase/tests/local/run.sh` for the SQL suites (it rebuilds PostgreSQL 16 from every migration). Local SQL testing notes: install postgresql (`apt-get update && apt-get install -y postgresql`), start the cluster, create the Supabase stubs (roles anon/authenticated/service_role, `auth.users`, `auth.uid()`, `storage.buckets/objects`, a `supabase_realtime` publication, table/function grants like Supabase's defaults), apply every file in `supabase/migrations/` in order with `ON_ERROR_STOP=1`, then run each `supabase/tests/*.test.sql`. Do this before shipping any migration. UI can be checked with Playwright against `vite` using mocked Supabase REST responses (honour `eq` filters; `maybeSingle()` expects a filtered array).
