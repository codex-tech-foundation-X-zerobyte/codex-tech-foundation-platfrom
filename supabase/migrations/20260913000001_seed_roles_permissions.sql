-- Seed data for the roles/permissions system introduced in the V2 architecture
-- migration. Structural configuration, not business data — mirrors the existing
-- `app_role` enum plus a sensible default permission set grouped by resource.

insert into public.roles (name, description) values
  ('worker', 'Internal team member with operational access.'),
  ('superadmin', 'Full administrative access.'),
  ('client', 'External client with access scoped to their own projects.')
on conflict (name) do nothing;

insert into public.permissions (key, description) values
  ('workers.view', 'View worker accounts and profiles'),
  ('workers.create', 'Create new worker accounts'),
  ('workers.update', 'Edit worker profiles'),
  ('workers.suspend', 'Suspend or reactivate worker accounts'),
  ('projects.view', 'View projects'),
  ('projects.create', 'Create new projects'),
  ('projects.update', 'Edit project details'),
  ('projects.publish', 'Publish or unpublish projects to the public site'),
  ('clients.view', 'View client accounts'),
  ('clients.create', 'Create new client accounts'),
  ('content.view', 'View blog posts, case studies, and careers'),
  ('content.publish', 'Publish or unpublish content'),
  ('leads.view', 'View submitted leads'),
  ('leads.manage', 'Update lead status and convert leads'),
  ('audit_logs.view', 'View the audit log')
on conflict (key) do nothing;

-- Give the built-in "superadmin" role every seeded permission by default —
-- this is a starting point for the admin to adjust, not a hardcoded rule
-- (has_permission() also independently grants superadmin full access via
-- profiles.role, so this seed mainly makes the permissions UI show something
-- meaningful on first load).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p where r.name = 'superadmin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('workers.view', 'projects.view', 'projects.create', 'projects.update', 'clients.view', 'content.view', 'leads.view', 'leads.manage')
where r.name = 'worker'
on conflict do nothing;
