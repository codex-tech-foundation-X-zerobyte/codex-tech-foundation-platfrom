-- Multi-department membership.
-- Until now a worker belonged to exactly ONE department (worker_profiles.department_id). A full-stack person (frontend + backend + devops)
-- could not be placed in all of them. This adds worker_departments (many rows per worker, each with its own member/admin role) and makes
-- every access rule membership-aware.
--
-- Compatibility: worker_profiles.department_id / department_role stay, as the worker's PRIMARY department. Triggers keep the two in step in
-- both directions, so the create-worker edge function and older code keep working unchanged.

create table if not exists public.worker_departments (
  user_id         uuid not null references public.worker_profiles (user_id) on delete cascade,
  department_id   uuid not null references public.departments (id) on delete cascade,
  department_role text not null default 'member' check (department_role in ('member', 'admin')),
  is_primary      boolean not null default false,
  added_by        uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (user_id, department_id)
);
create unique index if not exists worker_departments_one_primary on public.worker_departments (user_id) where is_primary;
create index if not exists worker_departments_department_idx on public.worker_departments (department_id);

-- Backfill: every worker's current department becomes their primary membership.
insert into public.worker_departments (user_id, department_id, department_role, is_primary)
select user_id, department_id, department_role, true from public.worker_profiles where department_id is not null
on conflict do nothing;

-- ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.current_department_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(department_id), '{}'::uuid[]) from public.worker_departments where user_id = auth.uid()
$$;

create or replace function public.is_department_member(p_department uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_department is not null and exists (select 1 from public.worker_departments where user_id = auth.uid() and department_id = p_department)
$$;

create or replace function public.is_department_admin(p_department uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_department is not null and exists (
    select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
     where wd.user_id = auth.uid() and wd.department_id = p_department and wd.department_role = 'admin' and wp.status = 'active'
  )
$$;

-- ── access control on the membership table ─────────────────────────────────────────────────────────────────────────────
alter table public.worker_departments enable row level security;
drop policy if exists "internal accounts read memberships" on public.worker_departments;
create policy "internal accounts read memberships" on public.worker_departments for select to authenticated
  using (public."current_role"() in ('worker', 'manager', 'superadmin'));
drop policy if exists "main admin manages memberships" on public.worker_departments;
create policy "main admin manages memberships" on public.worker_departments for all to authenticated
  using (public."current_role"() = 'superadmin') with check (public."current_role"() = 'superadmin');
grant select, insert, update, delete on public.worker_departments to authenticated;

-- Only a Main Admin changes who is in which department or who administers it (RLS covers the API; this covers every other path).
-- The internal sync from worker_profiles raises the 'ctf.membership_sync' flag, and trusted server contexts (no JWT) pass too.
create or replace function public.guard_worker_departments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('ctf.membership_sync', true) = 'on' or auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(public."current_role"()::text, '') <> 'superadmin' then
    raise exception 'Only a Main Admin can change department membership or assign Department Admins.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_worker_departments on public.worker_departments;
create trigger guard_worker_departments before insert or update or delete on public.worker_departments
  for each row execute function public.guard_worker_departments();

drop trigger if exists audit_worker_department_added on public.worker_departments;
create trigger audit_worker_department_added after insert on public.worker_departments for each row execute function public.audit_row_change('worker.department_added');
drop trigger if exists audit_worker_department_removed on public.worker_departments;
create trigger audit_worker_department_removed after delete on public.worker_departments for each row execute function public.audit_row_change('worker.department_removed');
drop trigger if exists audit_worker_department_changed on public.worker_departments;
create trigger audit_worker_department_changed after update on public.worker_departments for each row
  when (old.department_role is distinct from new.department_role or old.is_primary is distinct from new.is_primary)
  execute function public.audit_row_change('worker.department_changed');

-- ── keeping worker_profiles (primary department) and worker_departments in step ──────────────────────────────────────────
-- A: someone wrote worker_profiles directly (the create-worker function, or older code): turn that into a membership change.
create or replace function public.sync_membership_from_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- we were fired by our own mirror below
  perform set_config('ctf.membership_sync', 'on', true);
  if new.department_id is null then
    delete from public.worker_departments where user_id = new.user_id and is_primary;
    -- keep the worker placed if they still belong somewhere else
    update public.worker_departments set is_primary = true
     where user_id = new.user_id and department_id = (select department_id from public.worker_departments where user_id = new.user_id order by created_at limit 1);
    update public.worker_profiles wp set department_id = wd.department_id, department_role = wd.department_role
      from public.worker_departments wd where wp.user_id = new.user_id and wd.user_id = new.user_id and wd.is_primary;
  else
    if tg_op = 'UPDATE' and old.department_id is not null and old.department_id <> new.department_id then
      delete from public.worker_departments where user_id = new.user_id and department_id = old.department_id;   -- a "move" ends the old membership, as before
    end if;
    update public.worker_departments set is_primary = false where user_id = new.user_id and department_id <> new.department_id and is_primary;
    insert into public.worker_departments (user_id, department_id, department_role, is_primary)
      values (new.user_id, new.department_id, new.department_role, true)
      on conflict (user_id, department_id) do update set department_role = excluded.department_role, is_primary = true;
  end if;
  perform set_config('ctf.membership_sync', 'off', true);
  return null;
end $$;
drop trigger if exists sync_membership_from_profile on public.worker_profiles;
create trigger sync_membership_from_profile after insert or update of department_id, department_role on public.worker_profiles
  for each row execute function public.sync_membership_from_profile();

-- B: memberships changed: make sure exactly one is primary and mirror it onto worker_profiles.
create or replace function public.sync_profile_from_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid := coalesce(new.user_id, old.user_id);
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform set_config('ctf.membership_sync', 'on', true);
  if not exists (select 1 from public.worker_departments where user_id = v_user and is_primary) then
    update public.worker_departments set is_primary = true
     where user_id = v_user and department_id = (select department_id from public.worker_departments where user_id = v_user order by created_at limit 1);
  end if;
  update public.worker_profiles wp
     set department_id = (select department_id from public.worker_departments where user_id = v_user and is_primary),
         department_role = coalesce((select department_role from public.worker_departments where user_id = v_user and is_primary), 'member')
   where wp.user_id = v_user;
  perform set_config('ctf.membership_sync', 'off', true);
  return null;
end $$;
drop trigger if exists sync_profile_from_membership on public.worker_departments;
create trigger sync_profile_from_membership after insert or update or delete on public.worker_departments
  for each row execute function public.sync_profile_from_membership();

-- The worker_profiles guard assumed one department: an admin there needs a department, and moving ends the admin role. Both still hold for
-- direct writes; the mirror above is allowed to set the role because it runs in membership-sync mode.
create or replace function public.guard_department_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('ctf.membership_sync', true) = 'on' then return new; end if;
  if new.department_role is distinct from old.department_role and coalesce(public.current_role()::text, '') <> 'superadmin' then
    raise exception 'Only a Main Admin can assign or remove Department Admins.' using errcode = '42501';
  end if;
  if new.department_role = 'admin' and new.department_id is null then
    raise exception 'A Department Admin must belong to a department.' using errcode = '23514';
  end if;
  if new.department_id is distinct from old.department_id and new.department_role is not distinct from old.department_role and old.department_role = 'admin' then
    new.department_role := 'member';
  end if;
  return new;
end $$;

-- ── one atomic call for the admin screen: "this worker belongs to these departments, with these roles, and this one is primary" ──
create or replace function public.set_worker_departments(p_user uuid, p_departments jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb; v_dept uuid; v_role text; v_primary uuid; v_keep uuid[] := '{}'; v_count int := 0;
begin
  if coalesce(public."current_role"()::text, '') <> 'superadmin' then
    raise exception 'Only a Main Admin can place workers in departments.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.worker_profiles where user_id = p_user) then raise exception 'That person is not a worker.' using errcode = '23514'; end if;
  if jsonb_typeof(p_departments) <> 'array' then raise exception 'Departments must be a list.' using errcode = '22023'; end if;

  for v_item in select * from jsonb_array_elements(p_departments) loop
    v_dept := (v_item ->> 'department_id')::uuid;
    v_role := coalesce(v_item ->> 'role', 'member');
    if v_role not in ('member', 'admin') then raise exception 'Role must be member or admin.' using errcode = '22023'; end if;
    if not exists (select 1 from public.departments where id = v_dept) then raise exception 'Unknown department.' using errcode = '23503'; end if;
    if v_dept = any (v_keep) then raise exception 'A department can only be listed once.' using errcode = '22023'; end if;
    v_keep := v_keep || v_dept; v_count := v_count + 1;
    if coalesce((v_item ->> 'primary')::boolean, false) then v_primary := v_dept; end if;
  end loop;
  if v_count > 0 and v_primary is null then v_primary := v_keep[1]; end if;

  perform set_config('ctf.membership_sync', 'on', true);
  delete from public.worker_departments where user_id = p_user and not (department_id = any (v_keep));
  update public.worker_departments set is_primary = false where user_id = p_user;
  for v_item in select * from jsonb_array_elements(p_departments) loop
    v_dept := (v_item ->> 'department_id')::uuid;
    insert into public.worker_departments (user_id, department_id, department_role, is_primary, added_by)
      values (p_user, v_dept, coalesce(v_item ->> 'role', 'member'), v_dept = v_primary, auth.uid())
      on conflict (user_id, department_id) do update set department_role = excluded.department_role, is_primary = excluded.is_primary;
  end loop;
  perform set_config('ctf.membership_sync', 'off', true);
  -- (the statement-level mirror trigger already ran per row; run it once more for the empty-list case)
  update public.worker_profiles set department_id = (select department_id from public.worker_departments where user_id = p_user and is_primary),
         department_role = coalesce((select department_role from public.worker_departments where user_id = p_user and is_primary), 'member')
   where user_id = p_user;
end $$;
revoke all on function public.set_worker_departments(uuid, jsonb) from public;
grant execute on function public.set_worker_departments(uuid, jsonb) to authenticated;

-- ── make every existing rule membership-aware ─────────────────────────────────────────────────────────────────────────
-- 1. Policies and functions that compared a row's department to THE worker's department (department_id = current_department_id())
--    now ask "is it one of the worker's departments". Done by rewriting what is actually installed, so no policy is missed.
do $$
declare r record; v_qual text; v_chk text; v_def text; v_new text; v_fixed int := 0; v_failed text := '';
  v_pat1 constant text := '=\s*(public\.)?current_department_id\(\)';
  v_pat2 constant text := '(public\.)?current_department_id\(\)\s*=\s*([A-Za-z_][A-Za-z0-9_\.]*)';
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where coalesce(qual, '') || coalesce(with_check, '') ~ 'current_department_id\(\)' loop
    v_qual := case when r.qual is null then null
      else regexp_replace(regexp_replace(r.qual, v_pat1, '= ANY (public.current_department_ids())', 'g'), v_pat2, '\2 = ANY (public.current_department_ids())', 'g') end;
    v_chk := case when r.with_check is null then null
      else regexp_replace(regexp_replace(r.with_check, v_pat1, '= ANY (public.current_department_ids())', 'g'), v_pat2, '\2 = ANY (public.current_department_ids())', 'g') end;
    begin
      execute format('alter policy %I on %I.%I %s %s', r.policyname, r.schemaname, r.tablename,
        case when v_qual is null then '' else 'using (' || v_qual || ')' end,
        case when v_chk is null then '' else 'with check (' || v_chk || ')' end);
      v_fixed := v_fixed + 1;
    exception when others then v_failed := v_failed || r.schemaname || '.' || r.tablename || ':' || r.policyname || ' (' || sqlerrm || '); ';
    end;
  end loop;
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'current_department_id\(\)' and p.proname <> 'current_department_id' loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(regexp_replace(v_def, v_pat1, '= ANY (public.current_department_ids())', 'g'), v_pat2, '\2 = ANY (public.current_department_ids())', 'g');
    if v_new <> v_def then execute v_new; v_fixed := v_fixed + 1; end if;
  end loop;
  if v_failed <> '' then raise warning 'multi-department: could not rewrite: %', v_failed; end if;
  raise notice 'multi-department: rewrote % policies/functions', v_fixed;
end $$;

-- 2. "assignee must be in the department" checks look at memberships, not just the primary department.
do $$
declare v_def text; v_name text;
begin
  foreach v_name in array array['guard_department_task', 'guard_department_record'] loop
    v_def := pg_get_functiondef(('public.' || v_name)::regproc);
    v_def := replace(v_def, 'from public.worker_profiles where user_id = new.assignee_id and department_id = new.department_id',
                            'from public.worker_departments where user_id = new.assignee_id and department_id = new.department_id');
    execute v_def;
  end loop;
end $$;

-- 3. Suspension cases: the case belongs to the department the raiser administers; any Department Admin role makes someone "a Department Admin".
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.validate_suspension_case'::regproc);
  v_def := replace(v_def, 'new.department_id := w.department_id;',
    'new.department_id := coalesce((select wd.department_id from public.worker_departments wd where wd.user_id = new.worker_user_id and public.is_department_admin(wd.department_id) limit 1), w.department_id);');
  v_def := replace(v_def, 'if w.department_role = ''admin'' then',
    'if exists (select 1 from public.worker_departments wd where wd.user_id = new.worker_user_id and wd.department_role = ''admin'') then');
  v_def := replace(v_def, 'if not public.is_department_admin(w.department_id) then',
    'if not exists (select 1 from public.worker_departments wd where wd.user_id = new.worker_user_id and public.is_department_admin(wd.department_id)) then');
  execute v_def;
end $$;

-- 4. Notifications go to everyone in the department, not only those whose PRIMARY department it is.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.notify_announcement'::regproc);
  v_def := replace(v_def, 'wp.department_id = new.department_id)', 'exists (select 1 from public.worker_departments wd where wd.user_id = p.id and wd.department_id = new.department_id))');
  execute v_def;

  v_def := pg_get_functiondef('public.notify_assignment'::regproc);
  v_def := replace(v_def, E'from public.worker_profiles wp\n     where wp.department_id = new.department_id and wp.department_role = ''admin'' and wp.status = ''active''',
    E'from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id\n     where wd.department_id = new.department_id and wd.department_role = ''admin'' and wp.status = ''active''');
  execute v_def;

  v_def := pg_get_functiondef('public.notify_task_comment'::regproc);
  v_def := replace(v_def, 'wp.department_id = t.department_id)', 'exists (select 1 from public.worker_departments wd where wd.user_id = p.id and wd.department_id = t.department_id))');
  execute v_def;

  v_def := pg_get_functiondef('public.notify_task_progress'::regproc);
  v_def := replace(v_def, 'select user_id from public.worker_profiles where new.review_state = ''requested'' and department_id = new.department_id and department_role = ''admin'' and status = ''active''',
    'select wd.user_id from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id where new.review_state = ''requested'' and wd.department_id = new.department_id and wd.department_role = ''admin'' and wp.status = ''active''');
  execute v_def;
end $$;

-- 5. Department chat channels: a person is in the channel of EVERY department they belong to.
create or replace function public.sync_department_channels(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role app_role; v_depts uuid[]; v_ok boolean;
begin
  select role into v_role from public.profiles where id = p_user;
  select coalesce(status in ('invited', 'active', 'suspension_pending'), false) into v_ok from public.worker_profiles where user_id = p_user;
  select coalesce(array_agg(department_id), '{}'::uuid[]) into v_depts from public.worker_departments where user_id = p_user;
  delete from public.chat_channel_members m using public.chat_channels c
   where m.user_id = p_user and c.id = m.channel_id and c.department_id is not null
     and not (v_role = 'superadmin' or (coalesce(v_ok, false) and c.department_id = any (v_depts)));
  insert into public.chat_channel_members (channel_id, user_id)
    select c.id, p_user from public.chat_channels c
     where c.department_id is not null and (v_role = 'superadmin' or (coalesce(v_ok, false) and c.department_id = any (v_depts)))
    on conflict do nothing;
end $$;
create or replace function public.trg_sync_department_channels_wd() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.sync_department_channels(coalesce(new.user_id, old.user_id)); return null; end $$;
drop trigger if exists sync_channels_membership on public.worker_departments;
create trigger sync_channels_membership after insert or update or delete on public.worker_departments
  for each row execute function public.trg_sync_department_channels_wd();

-- 6. Onboarding progress: any of the worker's departments' admins can see it.
drop policy if exists "onboarding visible to self, Main Admin and department admin" on public.onboarding_progress;
drop policy if exists "onboarding visible to self, Main Admin and department admin" on public.onboarding_progress;
create policy "onboarding visible to self, Main Admin and department admin" on public.onboarding_progress for select to authenticated
  using (user_id = auth.uid() or public."current_role"() = 'superadmin'
         or exists (select 1 from public.worker_departments wd where wd.user_id = onboarding_progress.user_id and public.is_department_admin(wd.department_id)));
