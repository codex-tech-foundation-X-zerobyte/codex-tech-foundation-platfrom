-- Least privilege: what a worker can see now follows their department, not the fact that they are "a worker".
--
-- Until now every worker could read every project, file, milestone, request, client and resource, because the policies
-- trusted `current_role() = 'worker'` AND the worker role holds projects.view / projects.update / clients.view by default.
-- Rule used here: a project is visible to its owner, members, the departments it is assigned to, Main Admins, and managers
-- holding projects.view. A project nobody has assigned to a department yet (legacy, or freshly created) stays visible to
-- workers, so nothing existing disappears; the moment the Main Admin assigns it to departments, only those departments see it.

-- 1. The two questions every policy asks ---------------------------------------------------------------------------------
create or replace function public.can_see_project(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (
       public.current_role() = 'superadmin'
    or (public.current_role() = 'manager' and public.has_permission('projects.view'))
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
    or (public.current_role() = 'worker' and (
          exists (select 1 from public.project_departments pd where pd.project_id = p_project and pd.department_id = public.current_department_id())
          or not exists (select 1 from public.project_departments pd where pd.project_id = p_project)
       ))
  )
$$;

-- May change the project itself (milestones, members, details): owner, member, an admin of an assigned department, or any
-- worker while the project is still unassigned. Narrower than seeing it.
create or replace function public.can_edit_project(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (
       public.current_role() = 'superadmin'
    or (public.current_role() = 'manager' and public.has_permission('projects.update'))
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
    or exists (select 1 from public.project_departments pd where pd.project_id = p_project and public.is_department_admin(pd.department_id))
    or (public.current_role() = 'worker' and not exists (select 1 from public.project_departments pd where pd.project_id = p_project))
  )
$$;
grant execute on function public.can_see_project(uuid), public.can_edit_project(uuid) to authenticated;

-- 2. Projects ----------------------------------------------------------------------------------------------------------------
drop policy if exists "permission-scoped project reads" on public.projects;
create policy "permission-scoped project reads" on public.projects for select using (
  public.can_see_project(id) or client_id = auth.uid() or owner_id = auth.uid()
  or (publication_status = 'published' and public_visibility = true)
);
drop policy if exists "permission-scoped project updates" on public.projects;
create policy "permission-scoped project updates" on public.projects for update
  using (public.can_edit_project(id)) with check (public.can_edit_project(id));

-- 3. Everything that hangs off a project ---------------------------------------------------------------------------------------
alter table public.project_files add column if not exists task_id uuid references public.tasks(id) on delete set null;   -- a file attached to a task
create index if not exists project_files_task_idx on public.project_files (task_id) where task_id is not null;

drop policy if exists "project files visible to staff and client" on public.project_files;
create policy "project files visible to staff and client" on public.project_files for select using (
  public.can_see_project(project_id) or uploaded_by = auth.uid()
  or exists (select 1 from public.projects p where p.id = project_files.project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid()))
);
drop policy if exists "staff upload project files" on public.project_files;
create policy "staff upload project files" on public.project_files for insert with check (uploaded_by = auth.uid() and public.can_see_project(project_id));

drop policy if exists "permission-scoped milestone writes" on public.project_milestones;
create policy "milestones readable with the project" on public.project_milestones for select using (public.can_see_project(project_id));
create policy "permission-scoped milestone writes" on public.project_milestones for insert with check (public.can_edit_project(project_id));
create policy "milestones updated by project editors" on public.project_milestones for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy "milestones deleted by project editors" on public.project_milestones for delete using (public.can_edit_project(project_id));

drop policy if exists "requests readable by author, client and staff" on public.project_requests;
create policy "requests readable by author, client and staff" on public.project_requests for select using (
  requester_id = auth.uid() or public.is_project_client(project_id) or public.can_see_project(project_id)
);
drop policy if exists "clients and staff file requests" on public.project_requests;
create policy "clients and staff file requests" on public.project_requests for insert with check (
  requester_id = auth.uid() and (public.is_project_client(project_id) or public.can_see_project(project_id))
);
drop policy if exists "staff triage requests" on public.project_requests;
create policy "staff triage requests" on public.project_requests for update
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

drop policy if exists "staff and owners read updates" on public.project_updates;
create policy "staff and owners read updates" on public.project_updates for select using (public.can_see_project(project_id));
drop policy if exists "staff publish project updates" on public.project_updates;
create policy "staff publish project updates" on public.project_updates for insert with check (author_id = auth.uid() and public.can_see_project(project_id));

drop policy if exists "permission-scoped member reads" on public.project_members;
create policy "permission-scoped member reads" on public.project_members for select using (user_id = auth.uid() or public.can_see_project(project_id));
drop policy if exists "permission-scoped member writes" on public.project_members;
create policy "permission-scoped member writes" on public.project_members for insert with check (
  public.can_edit_project(project_id) or (public.current_role() = 'manager' and public.has_permission('projects.assign'))
);
drop policy if exists "permission-scoped member deletes" on public.project_members;
create policy "permission-scoped member deletes" on public.project_members for delete using (
  public.can_edit_project(project_id) or (public.current_role() = 'manager' and public.has_permission('projects.assign'))
);

-- 4. Tasks: legacy (no department) tasks now follow their project's visibility -----------------------------------------------
drop policy if exists "permission-scoped task reads" on public.tasks;
create policy "permission-scoped task reads" on public.tasks for select using (
  public.has_permission('tasks.view') or public.current_role() = 'superadmin'
  or (public.current_role() = 'worker' and (
        (department_id is null and public.can_see_project(project_id)) or department_id = public.current_department_id() or assignee_id = auth.uid()))
);
drop policy if exists "permission-scoped task writes" on public.tasks;
create policy "permission-scoped task writes" on public.tasks for insert with check (
  public.has_permission('tasks.create') or public.current_role() = 'superadmin'
  or (public.current_role() = 'worker' and department_id is null and public.can_see_project(project_id))
  or (public.is_department_admin(department_id)
      and exists (select 1 from public.project_departments pd where pd.project_id = tasks.project_id and pd.department_id = tasks.department_id and pd.status <> 'assigned'))
);
drop policy if exists "permission-scoped task updates" on public.tasks;
create policy "permission-scoped task updates" on public.tasks for update
  using (
    public.has_permission('tasks.update') or public.current_role() = 'superadmin'
    or (public.current_role() = 'worker' and department_id is null and public.can_see_project(project_id))
    or public.is_department_admin(department_id) or (department_id is not null and assignee_id = auth.uid()))
  with check (
    public.has_permission('tasks.update') or public.current_role() = 'superadmin'
    or (public.current_role() = 'worker' and department_id is null and public.can_see_project(project_id))
    or public.is_department_admin(department_id) or (department_id is not null and assignee_id = auth.uid()));
drop policy if exists "permission-scoped task deletes" on public.tasks;
create policy "permission-scoped task deletes" on public.tasks for delete using (
  public.current_role() = 'superadmin' or (public.current_role() = 'worker' and department_id is null and public.can_see_project(project_id)) or public.is_department_admin(department_id)
);

-- 5. Clients: a worker sees a client only through a project they can see ---------------------------------------------------------
drop policy if exists "permission-scoped client reads" on public.clients;
create policy "permission-scoped client reads" on public.clients for select using (
  public.current_role() = 'superadmin'
  or (public.current_role() = 'manager' and public.has_permission('clients.view'))
  or owner_id = auth.uid()
  or (public.current_role() = 'worker' and exists (select 1 from public.client_projects cp where cp.client_id = clients.id and public.can_see_project(cp.project_id)))
);
drop policy if exists "members view assigned client projects" on public.client_projects;
create policy "members view assigned client projects" on public.client_projects for select using (
  exists (select 1 from public.client_users cu where cu.client_id = client_projects.client_id and cu.user_id = auth.uid() and cu.status = 'active')
  or public.can_see_project(project_id)
);
drop policy if exists "users view own client record" on public.client_users;
create policy "users view own client record" on public.client_users for select using (
  user_id = auth.uid() or public.current_role() = 'superadmin' or (public.current_role() = 'manager' and public.has_permission('clients.view'))
);

-- 6. Internal resources: company-wide, or private to a department ---------------------------------------------------------------
alter table public.resources add column if not exists department_id uuid references public.departments(id);
drop policy if exists "admins manage resources" on public.resources;
create policy "resources readable by scope" on public.resources for select using (
  public.current_role() = 'superadmin'
  or (public.current_role() = 'manager' and public.has_permission('resources.view'))
  or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id()))
);
create policy "resources added by scope" on public.resources for insert with check (
  public.current_role() = 'superadmin' or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id()))
);
create policy "resources edited by scope" on public.resources for update
  using (public.current_role() = 'superadmin' or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id())))
  with check (public.current_role() = 'superadmin' or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id())));
create policy "resources removed by scope" on public.resources for delete using (
  public.current_role() = 'superadmin' or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id()))
);
