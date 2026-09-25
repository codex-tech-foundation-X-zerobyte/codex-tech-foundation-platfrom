-- Pass 3: Manager role, granular permission fixes, and Super Admin bootstrap.
-- See /docs/AUTH-RULES.md for the narrative version of everything below.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. MANAGER ROLE — hierarchy is superadmin > manager > worker.
-- Manager is an operational admin: worker/client/project/task management,
-- content and lead/application review. Manager must NOT be able to touch
-- roles, permissions, system_settings, or another manager/superadmin's
-- account — those stay gated to `current_role() = 'superadmin'` explicitly,
-- never to `has_permission()`, so a superadmin can't accidentally grant
-- manager into them via the /admin/roles UI either.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.roles (name, description) values
  ('manager', 'Operational administrator: worker/client/project management, content and lead review. Cannot manage roles, permissions, system settings, or other admins.')
on conflict (name) do nothing;

-- New permission keys the existing seed (20260913000001) didn't have. This
-- consolidates rather than duplicating: content.manage is draft/edit access,
-- distinct from the content.publish that already existed.
insert into public.permissions (key, description) values
  ('content.manage', 'Create and edit blog posts, careers listings, and content pages (draft state)'),
  ('clients.update', 'Edit client accounts and their project assignments'),
  ('applications.review', 'Review job applications, shortlist, and update status'),
  ('tasks.manage', 'Create, edit, assign, and reassign tasks'),
  ('resources.manage', 'Upload, organize, and delete files in the resources library')
on conflict (key) do nothing;

-- Manager gets a real operational permission set — explicitly NOT
-- workers.delete (doesn't exist as a permission; deletion of a worker
-- account is a superadmin-only destructive action performed outside RLS),
-- NOT audit_logs.view (superadmin can grant this later via /admin/roles if
-- they choose to — "unless explicitly granted" per the brief), and nothing
-- touching roles/permissions/system_settings.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in (
    'workers.view', 'workers.create', 'workers.update', 'workers.suspend',
    'projects.view', 'projects.create', 'projects.update', 'projects.publish',
    'clients.view', 'clients.create', 'clients.update',
    'content.view', 'content.manage', 'content.publish',
    'leads.view', 'leads.manage',
    'applications.review',
    'tasks.manage', 'resources.manage'
  )
where r.name = 'manager'
on conflict do nothing;

-- Also backfill the worker role with the new keys it was implicitly already
-- exercising via current_role()-based policies (see fixes below), so the
-- /admin/roles permission grid reflects reality instead of understating
-- what workers can do.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('content.manage', 'applications.review', 'tasks.manage', 'resources.manage')
where r.name = 'worker'
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BUG FIX (found during this audit, not previously flagged in ROADMAP):
-- the worker workspace has live routes for managing blog posts
-- (`/worker/content/blog` → BlogAdminList/BlogEditor), but `blog_posts`,
-- `careers`, and `content_pages` all had `for all using (current_role() =
-- 'superadmin')` as their ONLY write policy. A worker opening the blog
-- editor could load posts (no separate select-all policy needed since they
-- already see published rows, but drafts were invisible) and any write
-- would silently fail RLS. Add has_permission()-gated policies additively —
-- this does not touch or narrow the existing superadmin policy.
-- ─────────────────────────────────────────────────────────────────────────
create policy "content managers view drafts" on public.content_pages for select using (public.has_permission('content.view'));
create policy "content managers write pages" on public.content_pages for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));

create policy "content managers view draft posts" on public.blog_posts for select using (public.has_permission('content.view'));
create policy "content managers write posts" on public.blog_posts for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));

create policy "content managers view draft careers" on public.careers for select using (public.has_permission('content.view'));
create policy "content managers write careers" on public.careers for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));

-- Same gap existed for leads and applications: superadmin-only, so the
-- worker "Leads" nav item and admin "Applications" review UI were both
-- dead ends for anyone who wasn't superadmin.
create policy "permitted users view leads" on public.leads for select using (public.has_permission('leads.view'));
create policy "permitted users manage leads" on public.leads for update using (public.has_permission('leads.manage')) with check (public.has_permission('leads.manage'));

create policy "permitted users view applications" on public.applications for select using (public.has_permission('applications.review'));
create policy "permitted users manage applications" on public.applications for update using (public.has_permission('applications.review')) with check (public.has_permission('applications.review'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Extend the existing worker-or-superadmin operational policies to
-- include manager. These are drop+recreate because Postgres has no
-- `create or replace policy`.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "workers manage projects" on public.projects;
create policy "workers manage projects" on public.projects for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "workers manage tasks" on public.tasks;
create policy "workers manage tasks" on public.tasks for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "workers manage milestones" on public.project_milestones;
create policy "workers manage milestones" on public.project_milestones for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "workers manage case studies" on public.case_studies;
create policy "workers manage case studies" on public.case_studies for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "workers manage team profiles" on public.team_profiles;
create policy "workers manage team profiles" on public.team_profiles for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "admins manage resources" on public.resources;
create policy "admins manage resources" on public.resources for all using (public.current_role() in ('worker', 'manager', 'superadmin')) with check (public.current_role() in ('worker', 'manager', 'superadmin'));

drop policy if exists "admins read clients" on public.clients;
create policy "admins read clients" on public.clients for select using (public.current_role() in ('worker', 'manager', 'superadmin') or owner_id = auth.uid());

create policy "managers write clients" on public.clients for insert to authenticated with check (public.has_permission('clients.create'));
create policy "managers update clients" on public.clients for update to authenticated using (public.has_permission('clients.update')) with check (public.has_permission('clients.update'));

drop policy if exists "project files isolated by project" on storage.objects;
create policy "project files isolated by project" on storage.objects for select to authenticated using (
  bucket_id = 'private-project-files' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'manager', 'superadmin')
  )
);
drop policy if exists "project members upload files" on storage.objects;
create policy "project members upload files" on storage.objects for insert to authenticated with check (
  bucket_id = 'private-project-files' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'manager', 'superadmin')
  )
);

drop policy if exists "project assets scoped by project" on storage.objects;
create policy "project assets scoped by project" on storage.objects for select to authenticated using (
  bucket_id = 'project-assets' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'manager', 'superadmin')
  )
);
drop policy if exists "project assets scoped upload" on storage.objects;
create policy "project assets scoped upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'project-assets' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'manager', 'superadmin')
  )
);

drop policy if exists "workers read resources storage" on storage.objects;
create policy "workers read resources storage" on storage.objects for select to authenticated using (
  bucket_id = 'resources' and public.current_role() in ('worker', 'manager', 'superadmin')
);
drop policy if exists "workers upload resources storage" on storage.objects;
create policy "workers upload resources storage" on storage.objects for insert to authenticated with check (
  bucket_id = 'resources' and public.current_role() in ('worker', 'manager', 'superadmin')
);
drop policy if exists "workers delete resources storage" on storage.objects;
create policy "workers delete resources storage" on storage.objects for delete to authenticated using (
  bucket_id = 'resources' and public.current_role() in ('worker', 'manager', 'superadmin')
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. worker_profiles: managers may manage WORKER rows only — never a peer
-- manager's or a superadmin's row. Scoped by joining back to profiles.role
-- rather than trusting the caller, so this can't be escalated by editing
-- worker_profiles first.
-- ─────────────────────────────────────────────────────────────────────────
create policy "managers manage worker rows" on public.worker_profiles for all using (
  (public.has_permission('workers.update') or public.has_permission('workers.suspend'))
  and exists (select 1 from public.profiles p where p.id = worker_profiles.user_id and p.role = 'worker')
) with check (
  (public.has_permission('workers.update') or public.has_permission('workers.suspend'))
  and exists (select 1 from public.profiles p where p.id = worker_profiles.user_id and p.role = 'worker')
);

create policy "managers update worker profile rows" on public.profiles for update using (
  public.has_permission('workers.update') and role = 'worker'
) with check (
  public.has_permission('workers.update') and role = 'worker'
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. SUPER ADMIN BOOTSTRAP
-- Workflow (see /docs/AUTH-RULES.md):
--   1. Create the first Auth user manually in Supabase Dashboard → Authentication → Users.
--   2. Copy that user's UUID.
--   3. Run: select public.bootstrap_super_admin('paste-uuid-here', 'Founder Name');
--      — either from the SQL Editor (runs as the postgres role, which bypasses
--      grants) or from a trusted server-side script using the service role key.
--   4. That user can now log in and is recognized as superadmin.
-- Idempotent: safe to run again for the same UUID, and will not create a
-- second profile/role/user_roles row.
-- Deliberately NOT callable by ordinary users: REVOKE below removes execute
-- from `anon` and `authenticated`, so it cannot be invoked through the
-- exposed PostgREST RPC endpoint by a logged-in client, no matter what role
-- they hold. `auth.role()` is not used as the gate here because it reads
-- from a request JWT that doesn't exist when this is run from the SQL
-- Editor or a service-role connection — the intended bootstrap path — so
-- gating on it would lock out the very workflow this function exists for.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.bootstrap_super_admin(target_user_id uuid, target_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  superadmin_role_id uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'No auth.users row for %. Create the user in Supabase Dashboard → Authentication → Users first.', target_user_id;
  end if;

  insert into public.profiles (id, display_name, role)
  values (target_user_id, coalesce(target_display_name, ''), 'superadmin')
  on conflict (id) do update set role = 'superadmin';

  select id into superadmin_role_id from public.roles where name = 'superadmin';
  if superadmin_role_id is null then
    insert into public.roles (name, description) values ('superadmin', 'Full administrative access.')
    returning id into superadmin_role_id;
  end if;

  insert into public.user_roles (user_id, role_id) values (target_user_id, superadmin_role_id)
  on conflict do nothing;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, success, metadata)
  values (target_user_id, 'bootstrap_super_admin', 'profiles', target_user_id, 'critical', true, jsonb_build_object('note', 'Super Admin bootstrapped via SQL function'));
end;
$$;

revoke all on function public.bootstrap_super_admin(uuid, text) from public;
revoke all on function public.bootstrap_super_admin(uuid, text) from anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid, text) to service_role, postgres;
