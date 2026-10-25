-- Personal projects: a worker's own space on the Workspace. Visible to the worker, to people they invite, and to Main Admins (who oversee
-- the whole Workspace). It is NOT visible to other workers, managers, clients or the public, and it never appears in department queues.
--
-- Until now a project created by a worker had no department, and "unassigned" projects are visible and editable by every worker. That
-- made a worker's own project everyone's. Workers now create PERSONAL projects; company projects are created by a Main Admin (or a manager
-- holding projects.create) and flow through departments.

alter table public.projects add column if not exists scope text not null default 'company' check (scope in ('company', 'personal'));
create index if not exists projects_personal_owner_idx on public.projects (owner_id) where scope = 'personal';

-- A personal project cannot be a client project or be published to the public site.
alter table public.projects drop constraint if exists projects_personal_stays_private;
alter table public.projects add constraint projects_personal_stays_private
  check (scope = 'company' or (client_id is null and client_account_id is null and publication_status <> 'published' and public_visibility = false));

create or replace function public.is_personal_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select scope = 'personal' from public.projects where id = p_project), false)
$$;

-- Personal projects short-circuit the department/unassigned/manager rules: only owner, invited members and Main Admins.
create or replace function public.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.is_personal_project(p_project) then (
       public.current_role() = 'superadmin'
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
  ) else (
       public.current_role() = 'superadmin'
    or (public.current_role() = 'manager' and public.has_permission('projects.view'))
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
    or (public.current_role() = 'worker' and (
          exists (select 1 from public.project_departments pd where pd.project_id = p_project and pd.department_id = any (public.current_department_ids()))
          or not exists (select 1 from public.project_departments pd where pd.project_id = p_project)
       ))
  ) end
$$;

create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.is_personal_project(p_project) then (
       public.current_role() = 'superadmin'
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
  ) else (
       public.current_role() = 'superadmin'
    or (public.current_role() = 'manager' and public.has_permission('projects.update'))
    or exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
    or exists (select 1 from public.project_departments pd where pd.project_id = p_project and public.is_department_admin(pd.department_id))
    or (public.current_role() = 'worker' and not exists (select 1 from public.project_departments pd where pd.project_id = p_project))
  ) end
$$;

-- Several policies grant access by permission alone (a manager with tasks.view reads every task). A RESTRICTIVE policy is ANDed onto all
-- of them, so a personal project's rows stay private whatever permissions someone holds.
do $$
declare r record;
begin
  for r in select c.table_name from information_schema.columns c join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
            where c.table_schema = 'public' and c.column_name = 'project_id'
              and c.table_name in ('tasks', 'project_files', 'project_milestones', 'project_updates', 'project_members', 'project_departments', 'client_projects', 'project_requests', 'meetings', 'department_records', 'integration_repositories') loop
    execute format('drop policy if exists "personal projects stay personal" on public.%I', r.table_name);
    execute format('create policy "personal projects stay personal" on public.%I as restrictive for all to authenticated using (project_id is null or not public.is_personal_project(project_id) or public.can_see_project(project_id)) with check (project_id is null or not public.is_personal_project(project_id) or public.can_edit_project(project_id))', r.table_name);
  end loop;
end $$;

-- Who may create what, and what may never change.
create or replace function public.guard_project_scope() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(public."current_role"()::text, '');
begin
  if tg_op = 'INSERT' then
    if new.scope = 'personal' then
      if auth.uid() is not null and v_role <> 'superadmin' then new.owner_id := auth.uid(); end if;   -- you can only own your own personal project
      new.owner_id := coalesce(new.owner_id, auth.uid());
      if new.owner_id is null then raise exception 'A personal project needs an owner.' using errcode = '23514'; end if;
    elsif auth.uid() is not null and v_role = 'worker' then
      raise exception 'Workers create personal projects. Company projects are created by a Main Admin and assigned to departments.' using errcode = '42501';
    end if;
  elsif new.scope is distinct from old.scope or (new.scope = 'personal' and new.owner_id is distinct from old.owner_id) then
    -- Turning a personal project into a company one (or reassigning it) is a Main Admin decision, not the owner's.
    if auth.uid() is not null and v_role <> 'superadmin' then
      raise exception 'Only a Main Admin can change a project''s scope or hand a personal project to someone else.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_project_scope on public.projects;
create trigger guard_project_scope before insert or update on public.projects for each row execute function public.guard_project_scope();

create or replace function public.guard_personal_project_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_personal_project(new.project_id) then
    raise exception 'A personal project cannot be assigned to a department. Ask a Main Admin to make it a company project first.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists guard_personal_project_assignment on public.project_departments;
create trigger guard_personal_project_assignment before insert on public.project_departments for each row execute function public.guard_personal_project_assignment();

-- The owner can delete their own personal project (company projects stay Main Admin only).
drop policy if exists "owners delete their personal projects" on public.projects;
create policy "owners delete their personal projects" on public.projects for delete to authenticated using (scope = 'personal' and owner_id = auth.uid());
