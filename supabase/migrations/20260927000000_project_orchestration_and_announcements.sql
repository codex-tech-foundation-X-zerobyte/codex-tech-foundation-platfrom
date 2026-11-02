-- Project orchestration (Main Admin -> Project -> Department assignment -> Department Admin -> Tasks -> Workers)
-- and company/department announcements.
--
-- Builds on 20260926000000 (pre-provisioned departments, worker_profiles.department_role). Non-destructive: existing
-- tasks keep working because department scoping applies only to tasks that carry a department_id; legacy tasks (null
-- department) keep the old behaviour.

-- 0. Helpers ---------------------------------------------------------------------------------------------------------
create or replace function public.current_department_id() returns uuid language sql stable security definer set search_path = public as $$
  select department_id from public.worker_profiles where user_id = auth.uid()
$$;

-- Admin of that department AND currently active: a suspended Department Admin loses their powers immediately.
create or replace function public.is_department_admin(p_department uuid) returns boolean language sql stable security definer set search_path = public as $$
  select p_department is not null and exists (
    select 1 from public.worker_profiles
     where user_id = auth.uid() and department_id = p_department and department_role = 'admin' and status = 'active'
  )
$$;
grant execute on function public.current_department_id() to authenticated;
grant execute on function public.is_department_admin(uuid) to authenticated;

-- 1. Project fields the Main Admin sets when creating a project ---------------------------------------------------------
alter table public.projects add column if not exists priority text not null default 'normal';
alter table public.projects drop constraint if exists projects_priority_check;
alter table public.projects add constraint projects_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.projects add column if not exists start_date date;

-- 2. One project, many departments --------------------------------------------------------------------------------------
create table if not exists public.project_departments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  objective     text not null default '',
  deliverables  text[] not null default '{}',
  deadline      date,
  status        text not null default 'assigned' check (status in ('assigned', 'accepted', 'in_review', 'changes_requested', 'completed')),
  assigned_by   uuid references public.profiles(id),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, department_id)
);
create index if not exists project_departments_department_idx on public.project_departments (department_id);
alter table public.project_departments enable row level security;

drop policy if exists "assignments readable by scope" on public.project_departments;
-- NOT has_permission('projects.view') for everyone: the worker role holds that permission by default, which would let every
-- worker read every department's assignments. Managers (operational, company-wide) keep the shortcut.
create policy "assignments readable by scope" on public.project_departments for select using (
  public.current_role() = 'superadmin'
  or (public.current_role() = 'manager' and public.has_permission('projects.view'))
  or department_id = public.current_department_id()
);
drop policy if exists "main admin creates assignments" on public.project_departments;
create policy "main admin creates assignments" on public.project_departments for insert with check (public.current_role() = 'superadmin');
drop policy if exists "main admin removes assignments" on public.project_departments;
create policy "main admin removes assignments" on public.project_departments for delete using (public.current_role() = 'superadmin');
drop policy if exists "department admin works assignment" on public.project_departments;
create policy "department admin works assignment" on public.project_departments for update
  using (public.current_role() = 'superadmin' or public.is_department_admin(department_id))
  with check (public.current_role() = 'superadmin' or public.is_department_admin(department_id));

-- A Department Admin may move an assignment through its lifecycle, never rewrite what the Main Admin asked for.
create or replace function public.guard_assignment_update() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if coalesce(public.current_role()::text, '') = 'superadmin' then return new; end if;
  if (new.project_id, new.department_id, new.objective, new.deliverables, new.deadline, new.assigned_by)
     is distinct from (old.project_id, old.department_id, old.objective, old.deliverables, old.deadline, old.assigned_by) then
    raise exception 'Only a Main Admin can change what was assigned to a department.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'assigned' and new.status not in ('accepted') then
      raise exception 'Accept the assignment before working on it.' using errcode = '23514';
    end if;
    if new.status = 'completed' then
      raise exception 'Only a Main Admin can mark a department assignment completed.' using errcode = '42501';
    end if;
    if new.status = 'accepted' and old.status = 'assigned' then new.accepted_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_assignment_update on public.project_departments;
create trigger guard_assignment_update before update on public.project_departments for each row execute procedure public.guard_assignment_update();

-- Tell the Department Admins when their department is assigned a project (or the Main Admin when there is none).
create or replace function public.notify_assignment() returns trigger language plpgsql security definer set search_path = public as $$
declare v_project text; v_dept text; n int;
begin
  select name into v_project from public.projects where id = new.project_id;
  select name into v_dept from public.departments where id = new.department_id;
  insert into public.notifications (user_id, title, body)
    select wp.user_id, 'New department assignment', coalesce(v_project, 'A project') || ' was assigned to ' || v_dept || '. Review it and break it into tasks.'
      from public.worker_profiles wp
     where wp.department_id = new.department_id and wp.department_role = 'admin' and wp.status = 'active';
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.notifications (user_id, title, body)
      select p.id, 'Assignment has no Department Admin', coalesce(v_project, 'A project') || ' was assigned to ' || v_dept || ', which has no Department Admin yet.'
        from public.profiles p where p.role = 'superadmin';
  end if;
  return new;
end $$;
drop trigger if exists notify_assignment on public.project_departments;
create trigger notify_assignment after insert on public.project_departments for each row execute procedure public.notify_assignment();

-- 3. Department tasks ----------------------------------------------------------------------------------------------------
alter table public.tasks add column if not exists department_id uuid references public.departments(id);
alter table public.tasks add column if not exists stage text;   -- the department's own workflow stage (see src/workspaces/definitions.ts)
create index if not exists tasks_department_idx on public.tasks (department_id) where department_id is not null;

-- Department scoping applies only to tasks that carry a department. Legacy tasks behave exactly as before.
drop policy if exists "permission-scoped task reads" on public.tasks;
create policy "permission-scoped task reads" on public.tasks for select using (
  public.has_permission('tasks.view') or public.current_role() = 'superadmin'
  or (public.current_role() = 'worker' and (department_id is null or department_id = public.current_department_id() or assignee_id = auth.uid()))
);

drop policy if exists "permission-scoped task writes" on public.tasks;
create policy "permission-scoped task writes" on public.tasks for insert with check (
  public.has_permission('tasks.create') or public.current_role() = 'superadmin'
  or (public.current_role() = 'worker' and department_id is null)
  or (
    public.is_department_admin(department_id)
    -- Break a project into tasks only after accepting its assignment.
    and exists (select 1 from public.project_departments pd where pd.project_id = tasks.project_id and pd.department_id = tasks.department_id and pd.status <> 'assigned')
  )
);

drop policy if exists "permission-scoped task updates" on public.tasks;
create policy "permission-scoped task updates" on public.tasks for update
  using (
    public.has_permission('tasks.update') or public.current_role() = 'superadmin'
    or (public.current_role() = 'worker' and department_id is null)
    or public.is_department_admin(department_id) or (department_id is not null and assignee_id = auth.uid())
  )
  with check (
    public.has_permission('tasks.update') or public.current_role() = 'superadmin'
    or (public.current_role() = 'worker' and department_id is null)
    or public.is_department_admin(department_id) or (department_id is not null and assignee_id = auth.uid())
  );

drop policy if exists "permission-scoped task deletes" on public.tasks;
create policy "permission-scoped task deletes" on public.tasks for delete using (
  public.current_role() = 'superadmin' or (public.current_role() = 'worker' and department_id is null) or public.is_department_admin(department_id)
);

-- Department tasks go to people in that department; an assignee may move their own task but not rewrite or reassign it.
create or replace function public.guard_department_task() returns trigger language plpgsql as $$
declare v_privileged boolean;
begin
  if new.department_id is null then
    if tg_op = 'UPDATE' and old.department_id is not null then
      raise exception 'A department task cannot be turned into a company-wide task.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.assignee_id is not null and not exists (select 1 from public.worker_profiles where user_id = new.assignee_id and department_id = new.department_id) then
    raise exception 'Assign department tasks to someone in that department.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_privileged := coalesce(public.current_role()::text, '') = 'superadmin' or public.has_permission('tasks.update') or public.is_department_admin(old.department_id);
    if not v_privileged and (new.project_id, new.department_id, new.title, new.description, new.priority, new.due_date, new.assignee_id)
        is distinct from (old.project_id, old.department_id, old.title, old.description, old.priority, old.due_date, old.assignee_id) then
      raise exception 'You can move your task through its stages, but only a Department Admin can edit or reassign it.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_department_task on public.tasks;
create trigger guard_department_task before insert or update on public.tasks for each row execute procedure public.guard_department_task();

-- 4. Announcements -------------------------------------------------------------------------------------------------------
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id),      -- null = the whole company
  title         text not null check (length(btrim(title)) between 1 and 140),
  body          text not null default '' check (length(body) <= 5000),
  pinned        boolean not null default false,
  author_id     uuid not null references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
alter table public.announcements enable row level security;

drop policy if exists "announcements readable by scope" on public.announcements;
create policy "announcements readable by scope" on public.announcements for select using (
  public.current_role() in ('worker', 'manager', 'superadmin')
  and (department_id is null or public.current_role() in ('manager', 'superadmin') or department_id = public.current_department_id())
);
drop policy if exists "announcements posted by authority" on public.announcements;
create policy "announcements posted by authority" on public.announcements for insert with check (
  author_id = auth.uid() and (public.current_role() = 'superadmin' or (department_id is not null and public.is_department_admin(department_id)))
);
drop policy if exists "announcements edited by author or main admin" on public.announcements;
create policy "announcements edited by author or main admin" on public.announcements for update
  using (public.current_role() = 'superadmin' or author_id = auth.uid()) with check (public.current_role() = 'superadmin' or (author_id = auth.uid() and department_id is not null and public.is_department_admin(department_id)));
drop policy if exists "announcements removed by author or main admin" on public.announcements;
create policy "announcements removed by author or main admin" on public.announcements for delete using (public.current_role() = 'superadmin' or author_id = auth.uid());

create or replace function public.notify_announcement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Main Admins always; everyone else only while their worker account is active (status lives on worker_profiles).
  insert into public.notifications (user_id, title, body)
    select p.id, case when new.department_id is null then 'Company announcement' else 'Department announcement' end, new.title
      from public.profiles p
      left join public.worker_profiles wp on wp.user_id = p.id
     where p.id <> new.author_id
       and (
         p.role = 'superadmin'
         or (p.role in ('worker', 'manager') and wp.status = 'active' and (new.department_id is null or wp.department_id = new.department_id))
       );
  return new;
end $$;
drop trigger if exists notify_announcement on public.announcements;
create trigger notify_announcement after insert on public.announcements for each row execute procedure public.notify_announcement();
