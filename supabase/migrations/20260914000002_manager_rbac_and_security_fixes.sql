-- ═══════════════════════════════════════════════════════════════════════
-- CRITICAL: leads and applications both had `for insert with check (true)`
-- policies, meaning anyone with the public anon key could insert directly
-- via the REST API, completely bypassing submit-lead/submit-job-application's
-- validation and (see rate-limiting migration) rate limiting. Confirmed by
-- reading the actual policy text, not assumed. Both edge functions already
-- use the service-role key, which bypasses RLS entirely — so removing these
-- policies does not break legitimate submissions, it only closes the direct
-- bypass path.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "public may submit leads" on public.leads;
drop policy if exists "public may submit applications" on public.applications;

-- ═══════════════════════════════════════════════════════════════════════
-- Manager role: permission keys + default grants.
-- Manager permissions are DELIBERATELY narrower than the seeded worker set
-- and exclude anything role/permission/security-related — see the "hard
-- exclusions" block at the bottom of this section.
-- ═══════════════════════════════════════════════════════════════════════
insert into public.permissions (key, description) values
  ('clients.update', 'Edit client accounts'),
  ('clients.suspend', 'Suspend or reactivate client accounts'),
  ('projects.assign', 'Assign workers to projects'),
  ('tasks.view', 'View tasks'),
  ('tasks.create', 'Create tasks'),
  ('tasks.update', 'Edit and reassign tasks'),
  ('applications.view', 'View job applications'),
  ('applications.update', 'Update application status and notes'),
  ('resources.view', 'View internal resources'),
  ('resources.create', 'Upload internal resources'),
  ('resources.update', 'Edit or remove internal resources'),
  ('content.create', 'Create draft content'),
  ('content.update', 'Edit content')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in (
    'clients.view', 'clients.create', 'clients.update', 'clients.suspend',
    'projects.view', 'projects.create', 'projects.update', 'projects.assign',
    'tasks.view', 'tasks.create', 'tasks.update',
    'workers.view', 'workers.update',
    'leads.view', 'leads.manage',
    'applications.view', 'applications.update',
    'content.view', 'content.create', 'content.update',
    'resources.view', 'resources.create', 'resources.update'
  )
where r.name = 'manager'
on conflict do nothing;

-- Hard exclusion, enforced structurally rather than just by omission from the
-- grant above: even if a superadmin later adds one of these permission keys
-- to the manager role by mistake through the /admin/roles UI, RLS on the
-- tables below still checks current_role() = 'superadmin' directly, not
-- has_permission(). See the policy updates further down and in
-- 20260913000000_rls_audit_fixes.sql (roles/permissions/role_permissions/
-- user_roles/system_settings policies) — none of them were changed to accept
-- has_permission(), so a manager grant on those keys would have no effect.

-- ═══════════════════════════════════════════════════════════════════════
-- Keep user_roles in sync with profiles.role automatically. has_permission()
-- (defined in architecture_rebuild.sql) checks user_roles/role_permissions —
-- but nothing populated user_roles when a profile's role was set, meaning
-- has_permission() silently returned false for every non-superadmin user.
-- Fix at the source: a trigger keeps user_roles in sync with profiles.role
-- any time it's set, so provisioning code never has to remember to do this
-- itself in two places.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.sync_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_roles where user_id = new.id;
  insert into public.user_roles (user_id, role_id)
    select new.id, r.id from public.roles r where r.name = new.role::text
    on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_role_set on public.profiles;
create trigger on_profile_role_set
  after insert or update of role on public.profiles
  for each row execute procedure public.sync_user_role();

-- Backfill: the trigger only fires going forward. Populate user_roles for
-- every profile that already exists so has_permission() works immediately
-- for accounts created before this migration.
insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p join public.roles r on r.name = p.role::text
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- Extend RLS on the tables managers need access to, using has_permission()
-- instead of a hardcoded role list. has_permission() already grants
-- superadmin unconditional access (see its definition), so this is additive:
-- worker and superadmin access is unchanged, manager access now depends on
-- their actual granted permissions above.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "workers manage tasks" on public.tasks;
create policy "permission-scoped task reads" on public.tasks for select using (
  public.has_permission('tasks.view') or public.current_role() in ('worker', 'superadmin')
);
create policy "permission-scoped task writes" on public.tasks for insert with check (
  public.has_permission('tasks.create') or public.current_role() in ('worker', 'superadmin')
);
create policy "permission-scoped task updates" on public.tasks for update using (
  public.has_permission('tasks.update') or public.current_role() in ('worker', 'superadmin')
) with check (
  public.has_permission('tasks.update') or public.current_role() in ('worker', 'superadmin')
);
create policy "permission-scoped task deletes" on public.tasks for delete using (
  public.current_role() in ('worker', 'superadmin')
);

drop policy if exists "admins read clients" on public.clients;
create policy "permission-scoped client reads" on public.clients for select using (
  public.has_permission('clients.view') or public.current_role() in ('worker', 'superadmin') or owner_id = auth.uid()
);
create policy "permission-scoped client creates" on public.clients for insert with check (
  public.has_permission('clients.create') or public.current_role() = 'superadmin'
);
create policy "permission-scoped client updates" on public.clients for update using (
  public.has_permission('clients.update') or public.has_permission('clients.suspend') or public.current_role() = 'superadmin'
) with check (
  public.has_permission('clients.update') or public.has_permission('clients.suspend') or public.current_role() = 'superadmin'
);

create policy "permission-scoped application reads" on public.applications for select using (
  public.has_permission('applications.view') or public.current_role() = 'superadmin'
);
create policy "permission-scoped application updates" on public.applications for update using (
  public.has_permission('applications.update') or public.current_role() = 'superadmin'
) with check (
  public.has_permission('applications.update') or public.current_role() = 'superadmin'
);

-- Managers can update worker profiles (per spec: workers.update) but not
-- suspend/ban (workers.suspend is intentionally not in the manager grant
-- above) — split the previously single "admins manage worker_profiles"
-- policy so status changes require the stricter permission.
drop policy if exists "admins manage worker_profiles" on public.worker_profiles;
create policy "permission-scoped worker reads" on public.worker_profiles for select using (
  public.has_permission('workers.view') or public.current_role() in ('worker', 'superadmin') or user_id = auth.uid()
);
create policy "permission-scoped worker creates" on public.worker_profiles for insert with check (
  public.current_role() = 'superadmin'
);
create policy "permission-scoped worker field updates" on public.worker_profiles for update using (
  public.has_permission('workers.update') or public.current_role() = 'superadmin'
) with check (
  -- status changes (suspend/ban/reactivate) require the stricter permission;
  -- everything else only requires workers.update. Checked here rather than
  -- in application code because that's the only place it can't be bypassed.
  (status = (select status from public.worker_profiles wp where wp.user_id = worker_profiles.user_id) or public.has_permission('workers.suspend') or public.current_role() = 'superadmin')
  and (public.has_permission('workers.update') or public.current_role() = 'superadmin')
);
create policy "admins delete worker_profiles" on public.worker_profiles for delete using (public.current_role() = 'superadmin');

-- client_users.status only had active/suspended/closed — extend to the full
-- vocabulary used elsewhere (worker_profiles.status) so client accounts and
-- worker accounts are suspended/banned through the same status model.
alter table public.client_users drop constraint if exists client_users_status_check;
alter table public.client_users add constraint client_users_status_check
  check (status in ('active', 'suspended', 'banned', 'inactive', 'closed'));
