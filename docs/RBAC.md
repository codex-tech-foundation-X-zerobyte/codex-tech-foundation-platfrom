# RBAC — Roles & Permissions

There is **one** authorization system, made of two layers that are meant to
work together, not compete:

1. `profiles.role` (`app_role` enum: `worker | manager | superadmin | client`)
   — coarse account classification. Used for: routing (`ProtectedRoute`),
   and RLS policies where the whole class of account should behave
   identically (`current_role() in ('worker','manager','superadmin')`).
2. `roles` / `permissions` / `role_permissions` / `user_roles` +
   `has_permission(key)` — fine-grained, independently grantable. Used for
   RLS policies where one role might reasonably be exempted (e.g. a manager
   who shouldn't create clients, or a worker granted an extra permission
   without becoming a manager).

**Rule of thumb for new policies**: if every account of a given
`profiles.role` should always have the access, use `current_role()`. If the
access should be adjustable per-role without a schema change (i.e. a
superadmin might want to grant or revoke it later via `/admin/roles`), use
`has_permission()`.

`has_permission()` always returns `true` for `profiles.role = 'superadmin'`
regardless of seed data — superadmin is never locked out by an empty
`role_permissions` table.

## Role hierarchy

```
superadmin
    │  full access to everything; the only role that can manage
    │  roles/permissions/system_settings, ban another admin, or
    │  create a manager account
    ▼
manager
    │  operational admin: workers, clients, projects, tasks, content,
    │  leads, applications, resources. Cannot touch roles/permissions/
    │  system_settings/audit_logs (unless a superadmin explicitly grants
    │  audit_logs.view via /admin/roles), cannot suspend/edit another
    │  manager or superadmin, cannot create a manager account.
    ▼
worker
    │  same operational surface as manager minus workers.create/suspend
    │  and clients.create/update by default (adjustable via /admin/roles)
    ▼
client
       scoped entirely to their own project(s) via client_users/client_projects
```

## Current permission keys

| Key | Worker (default) | Manager (default) | Notes |
|---|---|---|---|
| `workers.view` | ✓ | ✓ | |
| `workers.create` | | ✓ | superadmin can grant to worker via /admin/roles |
| `workers.update` | | ✓ | scoped to target `profiles.role = 'worker'` — can't touch a manager/superadmin row even if granted |
| `workers.suspend` | | ✓ | same scoping as above |
| `projects.view` | ✓ | ✓ | |
| `projects.create` | ✓ | ✓ | |
| `projects.update` | ✓ | ✓ | |
| `projects.publish` | | ✓ | |
| `clients.view` | ✓ | ✓ | |
| `clients.create` | | ✓ | |
| `clients.update` | | ✓ | |
| `content.view` | ✓ | ✓ | see draft-visibility fix below |
| `content.manage` | ✓ | ✓ | create/edit blog, careers, content_pages |
| `content.publish` | | ✓ | |
| `leads.view` | ✓ | ✓ | |
| `leads.manage` | ✓ | ✓ | |
| `applications.review` | ✓ | ✓ | |
| `tasks.manage` | ✓ | ✓ | |
| `resources.manage` | ✓ | ✓ | |
| `audit_logs.view` | | | superadmin only by default; grant deliberately, per role, via /admin/roles |

Manager is **not** simply "worker + more" — it deliberately excludes
`workers.delete`-equivalent destructive actions (there is no
`workers.delete` permission; deleting a worker account is not implemented
anywhere and would be a superadmin-only, non-RLS operation if built) and
anything touching `roles`/`permissions`/`role_permissions`/`user_roles`/
`system_settings`, which stay gated to `current_role() = 'superadmin'`
explicitly in every policy — never to `has_permission()` — specifically so
a superadmin cannot accidentally hand manager that access through the
`/admin/roles` grant UI.

## Bug fixed in this pass: worker CMS access was silently broken

`blog_posts`, `careers`, `content_pages`, `leads`, and `applications` all had
exactly one RLS policy each: `for all using (current_role() = 'superadmin')`.
The worker workspace has had a live "Content → Blog" route since Pass 1
(`BlogAdminList`/`BlogEditor`) — any worker opening it could see published
posts (via the separate public-select policy) but any create/edit/delete
would fail RLS silently, and drafts were invisible entirely. Fixed by adding
additive `has_permission('content.manage')` / `has_permission('content.view')`
policies (and the equivalent for `leads.manage`/`leads.view` and
`applications.review`) — the original superadmin-only policy is untouched,
this only adds access, it narrows nothing.

## Adding a new permission

1. Add the key + description to the `permissions` table via a migration
   (see `20260914000001_manager_role_rbac.sql` for the pattern).
2. Decide which roles get it by default; insert into `role_permissions`.
3. Write the RLS policy using `has_permission('your.key')`.
4. Update the table above.
5. If it's UI-relevant, it appears automatically in `/admin/roles`
   (`AdminRoles.tsx`) — no separate UI work needed for the grant/revoke grid itself.
