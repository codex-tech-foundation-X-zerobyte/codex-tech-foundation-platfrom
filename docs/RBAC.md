# RBAC

## The rule

`profiles.role` = coarse account classification, used for routing (which
workspace shell loads) and as a superuser bypass. **It is not, by itself,
the authorization system.**

`has_permission(key)` / `has_permission_for(user_id, key)` = the actual
authorization check. Defined in `20260912000002_architecture_rebuild.sql`
and `20260914000004_has_permission_for.sql`. Use these in RLS policies.
`has_permission()` uses `auth.uid()` (works inside RLS). `has_permission_for()`
takes an explicit user id (works inside edge functions, which run as
service-role and have no `auth.uid()` context — they verify the caller's
identity themselves via `_shared/auth.ts`'s `authorizeCaller()`).

Both functions return `true` unconditionally if `profiles.role = 'superadmin'`
— superadmin always has every permission, without needing role_permissions
rows. Everyone else's access is determined by `user_roles` → `role_permissions`
→ `permissions`.

`user_roles` is kept in sync with `profiles.role` automatically by the
`sync_user_role()` trigger — every profile has exactly one `user_roles` row
matching its current `role`. Don't write to `user_roles` directly.

## Roles

| Role | Purpose |
|---|---|
| `superadmin` | Full authority. Owner/CEO. The only role that can manage roles, permissions, other superadmins, security config, and system settings — enforced by RLS checking `current_role() = 'superadmin'` directly on those specific tables, NOT via `has_permission()`, so a mis-granted permission key can't accidentally open them up. |
| `manager` | Operational administrator. Narrower permission set than worker in some areas, broader in others — see grants below. Cannot touch role/permission/security/system-settings tables regardless of what's in `role_permissions` (see previous point). |
| `worker` | Internal team member. Broad operational access via `current_role() in ('worker','superadmin')` checks on most operational tables (this was the original schema's design — workers are treated as one trusted internal group, not scoped per-project; see the "documented, not changed" note in `20260913000000_rls_audit_fixes.sql`). |
| `client` | External. Scoped to their own project(s) via `client_projects`/`clients.owner_id`. |

## Manager's actual permission grants

Seeded in `20260914000002_manager_rbac_and_security_fixes.sql`:

```
clients.view, clients.create, clients.update, clients.suspend
projects.view, projects.create, projects.update, projects.assign
tasks.view, tasks.create, tasks.update
workers.view, workers.update
leads.view, leads.manage
applications.view, applications.update
content.view, content.create, content.update
resources.view, resources.create, resources.update
```

Deliberately excluded: `workers.suspend` (worker status changes need the
stricter permission — see `worker_profiles`'s split RLS policies), anything
role/permission/security/settings-related.

## Editing permissions

`/admin/roles` (superadmin-only, hidden from managers via `navForRole()`)
writes directly to `role_permissions`. There's no per-user permission
override — permissions are granted at the role level only. If you need
per-user overrides, that's a schema change (a `user_permissions` table with
its own RLS) — don't bolt it onto `role_permissions`, and document the
decision here when it happens.

## What's NOT permission-gated yet

`project_requests`, `project_files`, and `resources` still use hardcoded
`current_role() in (...)` checks rather than `has_permission()` — this was
already the pattern in the original schema, and this pass only converted the
tables actively needed for manager/content workflows: `tasks`, `clients`,
`worker_profiles`, `applications`, `blog_posts`, `careers`, `case_studies`,
`team_profiles` (the last four were also where a real bug was found — see
`20260915000001_fix_content_rls_gaps.sql`: `blog_posts`/`careers` writes were
superadmin-only, which would have silently broken the worker-facing Blog CMS
for any plain worker account). Converting the rest is future work.
