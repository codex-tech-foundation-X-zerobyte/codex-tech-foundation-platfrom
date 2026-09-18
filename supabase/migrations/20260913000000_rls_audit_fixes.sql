-- RLS audit follow-up. Findings and fixes below — see ROADMAP.md "RLS audit findings"
-- for the narrative version. Every change here is additive or narrows an existing
-- over-broad policy; nothing here removes a legitimate access path.

-- ─────────────────────────────────────────────────────────────────────────
-- FINDING 1 (high): the `project-assets` bucket's policies only checked
-- bucket_id, not which project a file belongs to — any authenticated user,
-- including a client on a different project, could read or upload into any
-- file in this bucket. `private-project-files` (added later) already scopes
-- correctly by folder prefix; bring `project-assets` in line with that
-- pattern instead of leaving two buckets with inconsistent trust models.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "project assets authenticated read" on storage.objects;
drop policy if exists "project assets authenticated upload" on storage.objects;

create policy "project assets scoped by project" on storage.objects for select to authenticated using (
  bucket_id = 'project-assets' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'superadmin')
  )
);
create policy "project assets scoped upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'project-assets' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'superadmin')
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- FINDING 2 (high): several tables from the V2 architecture migration have
-- RLS enabled with a SELECT policy only — no INSERT/UPDATE/DELETE policy
-- exists at all, which means "deny by default" applies even to superadmin
-- through the normal client. Concretely, this silently broke the admin
-- worker-suspend action and blocks any future CMS/permissions UI. Add
-- explicit superadmin-managed policies using the same current_role() check
-- already used elsewhere (blog_posts, careers, content_pages), rather than
-- has_permission(), since role_permissions has no seed data yet and would
-- lock superadmin out too.
-- ─────────────────────────────────────────────────────────────────────────
create policy "admins manage roles" on public.roles for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage permissions" on public.permissions for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage role_permissions" on public.role_permissions for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage user_roles" on public.user_roles for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage departments" on public.departments for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage worker_profiles" on public.worker_profiles for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage client_users" on public.client_users for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage client_projects" on public.client_projects for insert with check (public.current_role() = 'superadmin');
create policy "admins update client_projects" on public.client_projects for update using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins delete client_projects" on public.client_projects for delete using (public.current_role() = 'superadmin');
create policy "workers manage milestones" on public.project_milestones for all using (public.current_role() in ('worker', 'superadmin')) with check (public.current_role() in ('worker', 'superadmin'));
create policy "workers manage case studies" on public.case_studies for all using (public.current_role() in ('worker', 'superadmin')) with check (public.current_role() in ('worker', 'superadmin'));
create policy "workers manage team profiles" on public.team_profiles for all using (public.current_role() in ('worker', 'superadmin')) with check (public.current_role() in ('worker', 'superadmin'));
create policy "admins manage system_settings" on public.system_settings for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');

-- ─────────────────────────────────────────────────────────────────────────
-- FINDING 3 (medium): `profiles` had a SELECT policy only. Nobody — not even
-- users editing their own display name — could update a profile row through
-- the normal client. Add self-update (excluding role, which must not be
-- self-assignable) and an explicit admin override.
-- ─────────────────────────────────────────────────────────────────────────
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy "admins update any profile" on public.profiles for update using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');

-- ─────────────────────────────────────────────────────────────────────────
-- FINDING 4 (low, documented not fixed): `notifications` intentionally has
-- no INSERT policy for ordinary users. Notifications are created by the
-- system (edge functions / triggers using the service role) on behalf of
-- another user; allowing any authenticated user to insert a notification
-- addressed to any other user_id would be a spoofing vector. Leave as-is —
-- noted here so a future reviewer doesn't "fix" this into a hole.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- FINDING 5 (low, documented not fixed): `tasks`, `project_requests`,
-- `project_files`, `resources`, and `clients` all grant any worker or
-- superadmin broad read/write access rather than scoping to assigned
-- project membership. This matches the existing pattern used throughout
-- both prior migrations (workers are treated as a single trusted internal
-- group) and was a deliberate design choice already in the schema before
-- this pass — flagged here for the team to confirm is still the intended
-- model as the org grows, not changed unilaterally.
-- ─────────────────────────────────────────────────────────────────────────
