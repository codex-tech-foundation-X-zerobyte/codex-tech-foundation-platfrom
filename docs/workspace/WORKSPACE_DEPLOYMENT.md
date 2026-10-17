# Deploying the Workspace changes

Apply in this order. Every migration is idempotent and non-destructive.

## 1. Database migrations (in order)
```
20260926000000_preprovisioned_departments.sql        the 8 Codex departments, department_role
20260927000000_project_orchestration_and_announcements.sql   project_departments, department tasks, announcements
20260928000000_department_scoped_visibility.sql      projects / files / clients / resources scoped by department
20260928000001_worker_lifecycle_and_task_depth.sql   lifecycle states, suspension cases, checklists, comments, dependencies
20260929000000_company_core.sql                      meetings, knowledge base, onboarding, records, whiteboards, integrations, webhooks, channels
```
Before running `20260928000000` on production, read **What changes for existing users** below.

## 2. Edge functions
```
supabase functions deploy create-worker resolve-worker-login   # now create workers as INVITED and let invited workers sign in
supabase functions deploy integrations                         # GitHub hub (JWT verified)
supabase functions deploy webhook-inbox --no-verify-jwt        # PUBLIC on purpose: senders have no Supabase session
```
`integrations` needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (all present in the Edge runtime by default).

## 3. Connect GitHub
Sign in as a Main Admin, open **Integrations**, create a *fine-grained, read-only* token (Metadata, Contents, Issues, Pull requests, Actions, Deployments), paste it, then link each repository to its department. Workers only ever see repositories linked to their department.

## 4. Smoke tests to run once (they could not be run where this was built)
1. Create a webhook inbox (Backend → Webhook tester) and `curl -X POST` its URL; the request should appear within a second.
2. Connect GitHub, link one repo, open Repository browser as a worker in that department, then as a worker in another department (should show nothing).
3. Raise a suspension case as a Department Admin, decide it as a Main Admin; confirm the worker is signed out on their next page load and cannot sign in.
4. Create a worker and confirm they land as *Invited*, sign in with the temporary password, change it, and become *Active*.

## What changes for existing users (read before applying)
- **Workers lose sight of other departments' projects, files, clients and resources** once a project is assigned to departments. Projects nobody has assigned yet stay visible to all workers, so nothing disappears until the Main Admin assigns them.
- **Suspended, banned, inactive, under-review and offboarded accounts have no access at all**, even with a valid session (`current_role()` now returns null for them).
- `manager` accounts are unchanged: the migrations still do not create a `manager` role (see WORKSPACE_PROGRESS.md, known issue).
- Storage bucket policies are **not** department-scoped yet. Row access is, so people cannot list other departments' files, but the object paths themselves are still protected only by role.

## Local database testing
`supabase/tests/local/run.sh` rebuilds a throwaway PostgreSQL 16 from every migration and runs every `supabase/tests/*.test.sql`.
