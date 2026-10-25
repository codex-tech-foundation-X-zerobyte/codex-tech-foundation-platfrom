-- Found while wiring up the case-study CMS: blog_posts and careers writes
-- were superadmin-only (`current_role() = 'superadmin'`), which meant the
-- worker-facing Blog CMS built in an earlier pass (/worker/content/blog)
-- would fail an RLS check for any plain 'worker' account — only a
-- superadmin could actually save a post through it. case_studies and
-- team_profiles allowed 'worker' but not 'manager' despite manager having
-- been granted content.create/content.update permissions in the RBAC seed —
-- those grants were inert for these four tables. Fixing all four
-- consistently: worker OR superadmin (unchanged trust model) OR a manager
-- with the specific content permission for that action.

drop policy if exists "admins manage posts" on public.blog_posts;
create policy "content-permission blog reads" on public.blog_posts for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.view')
);
create policy "content-permission blog writes" on public.blog_posts for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.create')
);
create policy "content-permission blog updates" on public.blog_posts for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update') or public.has_permission('content.publish')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update') or public.has_permission('content.publish')
);
create policy "content-permission blog deletes" on public.blog_posts for delete using (
  public.current_role() = 'superadmin'
);

drop policy if exists "admins manage careers" on public.careers;
create policy "content-permission careers reads" on public.careers for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.view')
);
create policy "content-permission careers writes" on public.careers for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.create')
);
create policy "content-permission careers updates" on public.careers for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
);
create policy "content-permission careers deletes" on public.careers for delete using (
  public.current_role() = 'superadmin'
);

drop policy if exists "workers manage case studies" on public.case_studies;
create policy "content-permission case study writes" on public.case_studies for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.create')
);
create policy "content-permission case study updates" on public.case_studies for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
);
create policy "content-permission case study deletes" on public.case_studies for delete using (
  public.current_role() = 'superadmin'
);
-- Note: case_studies' own SELECT policy for staff (not the "published are
-- public" one) doesn't currently exist at all — draft case studies are only
-- visible to their creator... actually not even that. Add one so drafts are
-- visible to staff, matching blog_posts' equivalent above.
create policy "content-permission case study staff reads" on public.case_studies for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.view')
);

drop policy if exists "workers manage team profiles" on public.team_profiles;
create policy "content-permission team writes" on public.team_profiles for insert with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.create')
);
create policy "content-permission team updates" on public.team_profiles for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.update')
);
create policy "content-permission team deletes" on public.team_profiles for delete using (
  public.current_role() = 'superadmin'
);
create policy "content-permission team staff reads" on public.team_profiles for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('content.view')
);
