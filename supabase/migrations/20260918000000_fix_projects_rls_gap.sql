-- Found while building the create-project flow (Fix Pass 1, item 1/2):
-- `projects` only had "workers manage projects" (worker/superadmin), so
-- manager's projects.create/projects.update/projects.assign grants
-- (seeded in 20260914000002) had nothing to attach to.

drop policy if exists "workers manage projects" on public.projects;

create policy "permission-scoped project reads" on public.projects for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.view')
  or client_id = auth.uid() or owner_id = auth.uid()
  or (publication_status = 'published' and public_visibility = true)
);
create policy "permission-scoped project creates" on public.projects for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.create')
);
create policy "permission-scoped project updates" on public.projects for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
);
create policy "admins delete projects" on public.projects for delete using (public.current_role() = 'superadmin');

-- project_members: allow a manager with projects.assign to add/remove
-- members, not just worker/superadmin. The original "memberships visible to
-- members" SELECT policy (self + superadmin) stays — this only replaces the
-- implicit all-purpose access "workers manage projects" used to also give
-- project_members via project ownership; explicit here.
drop policy if exists "memberships visible to members" on public.project_members;
create policy "permission-scoped member reads" on public.project_members for select using (
  public.current_role() in ('worker', 'superadmin') or user_id = auth.uid()
);
create policy "permission-scoped member writes" on public.project_members for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.assign')
);
create policy "permission-scoped member deletes" on public.project_members for delete using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.assign')
);
