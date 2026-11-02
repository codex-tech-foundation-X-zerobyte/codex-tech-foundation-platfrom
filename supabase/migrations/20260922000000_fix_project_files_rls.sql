-- project_files had exactly one policy: SELECT, scoped to
-- "uploaded_by = auth.uid() OR worker/superadmin" — meaning a client could
-- never see files for their own project unless they personally uploaded
-- them (contradicts the client-deliverables requirement from earlier
-- passes), and there was no INSERT/UPDATE/DELETE policy at all, so no one
-- could ever upload a project file through the normal client. Found while
-- wiring up the project workspace's Files tab.

drop policy if exists "project members read files" on public.project_files;

create policy "project files visible to staff and client" on public.project_files for select using (
  public.current_role() in ('worker', 'superadmin')
  or uploaded_by = auth.uid()
  or exists (
    select 1 from public.projects p
    where p.id = project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid())
  )
);
create policy "staff upload project files" on public.project_files for insert with check (
  public.current_role() in ('worker', 'superadmin') and uploaded_by = auth.uid()
);
create policy "uploader or admin deletes project files" on public.project_files for delete using (
  uploaded_by = auth.uid() or public.current_role() = 'superadmin'
);

-- While here: extend milestone management to managers with projects.update
-- (was worker/superadmin only, same inert-manager-grant pattern found
-- repeatedly in earlier passes).
drop policy if exists "workers manage milestones" on public.project_milestones;
create policy "permission-scoped milestone writes" on public.project_milestones for all using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
);
