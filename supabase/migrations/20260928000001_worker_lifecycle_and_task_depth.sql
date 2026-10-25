-- Worker lifecycle (INVITED > ACTIVE > SUSPENSION_PENDING > SUSPENDED > REVIEW > ACTIVE | OFFBOARDED), suspension cases a
-- Department Admin raises and only a Main Admin decides, and the task depth a real team needs (checklists, comments,
-- dependencies, watchers, review state). History is never deleted.

-- 1. A suspended account must actually lose access --------------------------------------------------------------------------------
-- current_role() feeds nearly every policy. A worker (or manager) who is suspended, banned, inactive, under review or
-- offboarded now has NO role, so every `current_role() in (...)` check fails for them and has_permission() is false, even
-- if they still hold a valid session token.
create or replace function public."current_role"() returns app_role language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.worker_profiles w where w.user_id = p.id and w.status in ('suspended', 'banned', 'inactive', 'review', 'offboarded')) then null
    else p.role
  end
  from public.profiles p where p.id = auth.uid()
$$;
create or replace function public.has_permission(permission_key text) returns boolean language sql stable security definer set search_path = public as $$
  select public."current_role"() is not null and public.has_permission_for(auth.uid(), permission_key)
$$;

-- 2. Lifecycle states --------------------------------------------------------------------------------------------------------------------
alter table public.worker_profiles drop constraint if exists worker_profiles_status_check;
alter table public.worker_profiles add constraint worker_profiles_status_check
  check (status in ('invited', 'active', 'suspension_pending', 'suspended', 'review', 'offboarded', 'banned', 'inactive'));

-- Who may change a worker's status: a Main Admin, a trusted server (no end-user session), or another trigger
-- (suspension cases). Also: an invited worker becomes active when they set their own password for the first time.
create or replace function public.guard_worker_status() returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then
    if old.status = 'invited' and old.must_change_password and not new.must_change_password then new.status := 'active'; end if;
    return new;
  end if;
  -- A worker with an open suspension case is managed through that case, so nobody can flip their status behind its back.
  if pg_trigger_depth() = 1 and exists (select 1 from public.suspension_cases c where c.worker_user_id = new.user_id and c.status in ('pending', 'suspended', 'under_review')) then
    raise exception 'This worker has an open suspension case. Decide it from Approvals instead.' using errcode = 'P0001';
  end if;
  if coalesce(public."current_role"()::text, '') = 'superadmin' or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  -- A manager a Main Admin has granted workers.suspend may suspend / restore, but offboarding is a Main Admin decision.
  if public.has_permission('workers.suspend') and new.status <> 'offboarded' and old.status <> 'offboarded' then return new; end if;
  raise exception 'Only a Main Admin can change a worker''s status.' using errcode = '42501';
end $$;
drop trigger if exists guard_worker_status on public.worker_profiles;
create trigger guard_worker_status before update on public.worker_profiles for each row execute procedure public.guard_worker_status();

-- 3. Suspension cases ----------------------------------------------------------------------------------------------------------------------
create table if not exists public.suspension_cases (
  id             uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.profiles(id),
  department_id  uuid references public.departments(id),
  requested_by   uuid not null default auth.uid() references public.profiles(id),
  reason         text not null check (length(btrim(reason)) >= 3),
  evidence       text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'suspended', 'under_review', 'restored', 'offboarded')),
  decided_by     uuid references public.profiles(id),
  decision_note  text not null default '',
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists suspension_cases_one_open on public.suspension_cases (worker_user_id) where status in ('pending', 'suspended', 'under_review');
create index if not exists suspension_cases_status_idx on public.suspension_cases (status, created_at desc);
alter table public.suspension_cases enable row level security;

create table if not exists public.suspension_case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.suspension_cases(id),
  actor_id   uuid references public.profiles(id),
  action     text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.suspension_case_events enable row level security;

drop policy if exists "cases readable by main admin, requester and department admin" on public.suspension_cases;
create policy "cases readable by main admin, requester and department admin" on public.suspension_cases for select using (
  public."current_role"() = 'superadmin' or requested_by = auth.uid() or public.is_department_admin(department_id)
);
drop policy if exists "cases raised by authority" on public.suspension_cases;
create policy "cases raised by authority" on public.suspension_cases for insert with check (
  requested_by = auth.uid() and (public."current_role"() = 'superadmin' or public.is_department_admin(department_id))
);
drop policy if exists "cases decided by main admin" on public.suspension_cases;
create policy "cases decided by main admin" on public.suspension_cases for update using (public."current_role"() = 'superadmin') with check (public."current_role"() = 'superadmin');
-- No delete policy on purpose: cases and their events are the record.

drop policy if exists "case events readable with the case" on public.suspension_case_events;
create policy "case events readable with the case" on public.suspension_case_events for select using (exists (select 1 from public.suspension_cases c where c.id = case_id));

create or replace function public.validate_suspension_case() returns trigger language plpgsql security definer set search_path = public as $$
declare w public.worker_profiles%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into w from public.worker_profiles where user_id = new.worker_user_id;
    if not found then raise exception 'That person is not a worker.' using errcode = '23514'; end if;
    if new.worker_user_id = auth.uid() then raise exception 'You cannot raise a suspension case against yourself.' using errcode = '42501'; end if;
    new.department_id := w.department_id;   -- the case belongs to the worker's department, whatever the client sent
    if public."current_role"() <> 'superadmin' then
      if w.department_role = 'admin' then raise exception 'Only a Main Admin can raise a case against a Department Admin.' using errcode = '42501'; end if;
      if not public.is_department_admin(w.department_id) then raise exception 'You can only raise cases for workers in your own department.' using errcode = '42501'; end if;
    end if;
    if w.status not in ('invited', 'active') then raise exception 'This worker is already %.', replace(w.status, '_', ' ') using errcode = '23514'; end if;
    new.status := 'pending'; new.decided_by := null; new.decided_at := null; new.decision_note := '';
    return new;
  end if;
  -- UPDATE: only a decision may change; the facts of the case may not.
  if (new.worker_user_id, new.requested_by, new.reason, new.evidence, new.department_id) is distinct from (old.worker_user_id, old.requested_by, old.reason, old.evidence, old.department_id) then
    raise exception 'The facts of a case cannot be edited, only decided.' using errcode = '42501';
  end if;
  if old.status in ('restored', 'offboarded') then raise exception 'This case is closed.' using errcode = '23514'; end if;
  if new.status = 'pending' then raise exception 'A case cannot go back to pending.' using errcode = '23514'; end if;
  new.decided_by := auth.uid(); new.decided_at := now(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists validate_suspension_case on public.suspension_cases;
create trigger validate_suspension_case before insert or update on public.suspension_cases for each row execute procedure public.validate_suspension_case();

create or replace function public.apply_suspension_case() returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text; v_name text; v_action text;
begin
  select display_name into v_name from public.profiles where id = new.worker_user_id;
  if tg_op = 'INSERT' then
    update public.worker_profiles set status = 'suspension_pending' where user_id = new.worker_user_id;
    insert into public.suspension_case_events (case_id, actor_id, action, note) values (new.id, new.requested_by, 'requested', new.reason);
    insert into public.notifications (user_id, title, body)
      select p.id, 'Suspension review needed', coalesce(v_name, 'A worker') || ': ' || new.reason from public.profiles p where p.role = 'superadmin' and p.id <> new.requested_by;
    return new;
  end if;
  v_status := case new.status when 'restored' then 'active' when 'suspended' then 'suspended' when 'under_review' then 'review' when 'offboarded' then 'offboarded' end;
  v_action := case new.status when 'restored' then 'restored' when 'suspended' then 'suspension continued' when 'under_review' then 'moved to review' when 'offboarded' then 'offboarded' end;
  update public.worker_profiles set status = v_status where user_id = new.worker_user_id;
  insert into public.suspension_case_events (case_id, actor_id, action, note) values (new.id, new.decided_by, v_action, new.decision_note);
  if new.requested_by is distinct from new.decided_by then
    insert into public.notifications (user_id, title, body) values (new.requested_by, 'Suspension decision', coalesce(v_name, 'The worker') || ': ' || v_action || '.');
  end if;
  return new;
end $$;
drop trigger if exists apply_suspension_case_ins on public.suspension_cases;
create trigger apply_suspension_case_ins after insert on public.suspension_cases for each row execute procedure public.apply_suspension_case();
drop trigger if exists apply_suspension_case_upd on public.suspension_cases;
create trigger apply_suspension_case_upd after update of status on public.suspension_cases for each row when (old.status is distinct from new.status) execute procedure public.apply_suspension_case();

-- 4. Task depth ---------------------------------------------------------------------------------------------------------------------------------
alter table public.tasks add column if not exists created_by uuid references public.profiles(id) default auth.uid();
alter table public.tasks add column if not exists review_state text not null default 'none';
alter table public.tasks drop constraint if exists tasks_review_state_check;
alter table public.tasks add constraint tasks_review_state_check check (review_state in ('none', 'requested', 'approved', 'changes_requested'));

-- May the caller work on (check off, depend, watch...) this task? Assignee, the department's admin, a Main Admin, or any worker on a visible legacy task.
create or replace function public.can_work_task(p_task uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t where t.id = p_task and (
         public."current_role"() = 'superadmin'
      or t.assignee_id = auth.uid()
      or public.is_department_admin(t.department_id)
      or (t.department_id is null and public."current_role"() = 'worker' and public.can_see_project(t.project_id))
    )
  )
$$;
grant execute on function public.can_work_task(uuid) to authenticated;

-- Assignees may ask for review, department admins decide it.
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
    v_privileged := coalesce(public."current_role"()::text, '') = 'superadmin' or public.has_permission('tasks.update') or public.is_department_admin(old.department_id);
    if not v_privileged then
      if (new.project_id, new.department_id, new.title, new.description, new.priority, new.due_date, new.assignee_id)
          is distinct from (old.project_id, old.department_id, old.title, old.description, old.priority, old.due_date, old.assignee_id) then
        raise exception 'You can move your task through its stages, but only a Department Admin can edit or reassign it.' using errcode = '42501';
      end if;
      if new.review_state is distinct from old.review_state and new.review_state <> 'requested' then
        raise exception 'Only a Department Admin can approve a task or ask for changes.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create table if not exists public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 300),
  done       boolean not null default false,
  position   int not null default 0,
  done_by    uuid references public.profiles(id),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists task_checklist_task_idx on public.task_checklist_items (task_id, position);
alter table public.task_checklist_items enable row level security;
create policy "checklist readable with the task" on public.task_checklist_items for select using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "checklist edited by people working the task" on public.task_checklist_items for insert with check (public.can_work_task(task_id));
create policy "checklist ticked by people working the task" on public.task_checklist_items for update using (public.can_work_task(task_id)) with check (public.can_work_task(task_id));
create policy "checklist trimmed by people working the task" on public.task_checklist_items for delete using (public.can_work_task(task_id));
create or replace function public.stamp_checklist_item() returns trigger language plpgsql as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_by := auth.uid(); new.done_at := now();
  elsif not new.done then new.done_by := null; new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists stamp_checklist_item on public.task_checklist_items;
create trigger stamp_checklist_item before insert or update on public.task_checklist_items for each row execute procedure public.stamp_checklist_item();

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles(id),
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;
create policy "comments readable with the task" on public.task_comments for select using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "comments written by people who can see the task" on public.task_comments for insert with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id));
-- No update/delete policy: a discussion is part of the task's history.

create table if not exists public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  primary key (task_id, user_id)
);
alter table public.task_watchers enable row level security;
create policy "watchers readable with the task" on public.task_watchers for select using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "watch a task you can see" on public.task_watchers for insert with check (
  (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id)) or public.can_work_task(task_id) and public.is_department_admin((select department_id from public.tasks where id = task_id))
);
create policy "stop watching" on public.task_watchers for delete using (user_id = auth.uid() or public."current_role"() = 'superadmin');

create table if not exists public.task_dependencies (
  task_id            uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
alter table public.task_dependencies enable row level security;
create policy "dependencies readable with the task" on public.task_dependencies for select using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "dependencies set by people working the task" on public.task_dependencies for insert with check (public.can_work_task(task_id) and exists (select 1 from public.tasks t where t.id = depends_on_task_id));
create policy "dependencies removed by people working the task" on public.task_dependencies for delete using (public.can_work_task(task_id));

create or replace function public.validate_task_dependency() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select project_id from public.tasks where id = new.task_id) is distinct from (select project_id from public.tasks where id = new.depends_on_task_id) then
    raise exception 'A task can only depend on a task in the same project.' using errcode = '23514';
  end if;
  -- No cycles: the task we depend on must not (transitively) depend on this task.
  if exists (
    with recursive chain(id) as (
      select new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    ) select 1 from chain where id = new.task_id
  ) then raise exception 'That would create a circular dependency.' using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists validate_task_dependency on public.task_dependencies;
create trigger validate_task_dependency before insert on public.task_dependencies for each row execute procedure public.validate_task_dependency();

-- A task cannot be finished while something it depends on is not.
create or replace function public.block_done_with_open_dependencies() returns trigger language plpgsql security definer set search_path = public as $$
declare v_blocker text;
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    select t.title into v_blocker from public.task_dependencies d join public.tasks t on t.id = d.depends_on_task_id where d.task_id = new.id and t.status <> 'done' limit 1;
    if v_blocker is not null then raise exception 'Finish "%" first.', v_blocker using errcode = '23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists block_done_with_open_dependencies on public.tasks;
create trigger block_done_with_open_dependencies before update of status on public.tasks for each row execute procedure public.block_done_with_open_dependencies();

-- Tell the people who care: comments and mentions, stage/review changes.
create or replace function public.notify_task_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; v_author text;
begin
  select * into t from public.tasks where id = new.task_id;
  select display_name into v_author from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, title, body)
    select distinct u.id, 'Comment on ' || t.title, coalesce(v_author, 'Someone') || ': ' || left(new.body, 140)
      from (
        select t.assignee_id as id union select t.created_by union select user_id from public.task_watchers where task_id = t.id
      ) u where u.id is not null and u.id <> new.author_id;
  -- @Name mentions: only people who could legitimately see the task (assignee, same department, Main Admins).
  insert into public.notifications (user_id, title, body)
    select p.id, 'You were mentioned on ' || t.title, coalesce(v_author, 'Someone') || ': ' || left(new.body, 140)
      from public.profiles p left join public.worker_profiles wp on wp.user_id = p.id
     where p.id <> new.author_id and position('@' || p.display_name in new.body) > 0 and length(coalesce(p.display_name, '')) > 1
       and (p.role = 'superadmin' or p.id = t.assignee_id or (t.department_id is not null and wp.department_id = t.department_id))
       and p.id is distinct from t.assignee_id and p.id is distinct from t.created_by
       and p.id not in (select user_id from public.task_watchers where task_id = t.id);   -- those already got the comment notification
  return new;
end $$;
drop trigger if exists notify_task_comment on public.task_comments;
create trigger notify_task_comment after insert on public.task_comments for each row execute procedure public.notify_task_comment();

create or replace function public.notify_task_progress() returns trigger language plpgsql security definer set search_path = public as $$
declare v_what text;
begin
  v_what := case
    when new.review_state is distinct from old.review_state then case new.review_state when 'requested' then 'is ready for review' when 'approved' then 'was approved' when 'changes_requested' then 'needs changes' else null end
    when new.stage is distinct from old.stage and new.stage is not null then 'moved to ' || new.stage
    else null end;
  if v_what is null then return new; end if;
  insert into public.notifications (user_id, title, body)
    select distinct u.id, new.title, 'This task ' || v_what || '.'
      from (select new.assignee_id as id union select new.created_by union select user_id from public.task_watchers where task_id = new.id
            union select user_id from public.worker_profiles where new.review_state = 'requested' and department_id = new.department_id and department_role = 'admin' and status = 'active') u
     where u.id is not null and u.id is distinct from auth.uid();
  return new;
end $$;
drop trigger if exists notify_task_progress on public.tasks;
create trigger notify_task_progress after update of stage, review_state on public.tasks for each row execute procedure public.notify_task_progress();
