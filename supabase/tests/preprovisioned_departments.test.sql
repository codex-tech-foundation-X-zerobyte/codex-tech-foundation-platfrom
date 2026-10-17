-- Behavioural tests for migration 20260926000000_preprovisioned_departments.sql
-- Run against a database that has ALL migrations applied, as a superuser (it uses SET ROLE + a rolled-back transaction):
--   psql "$DATABASE_URL" -f supabase/tests/preprovisioned_departments.test.sql
-- Each check prints NOTICE: PASS ...; any failure raises an exception. Nothing is committed.

\set ON_ERROR_STOP on
begin;

-- A manager can hold workers.update (a superadmin can grant it in /admin/roles). RLS then lets that manager edit worker rows,
-- so the department_role trigger, not RLS, is what must stop them promoting themselves. Role first, so the sync trigger attaches it.
insert into public.roles (name, description) values ('manager', 'test') on conflict (name) do nothing;
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p where r.name = 'manager' and p.key = 'workers.update' on conflict do nothing;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x'), ('00000000-0000-0000-0000-0000000000b1','worker1@x'),
 ('00000000-0000-0000-0000-0000000000b2','manager1@x'), ('00000000-0000-0000-0000-0000000000c1','client1@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker'     where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set role='manager'    where id='00000000-0000-0000-0000-0000000000b2';
update public.profiles set role='client'     where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-T0000001',(select id from public.departments where slug='frontend-development')),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-T0000002',(select id from public.departments where slug='devops'));
insert into public.departments (name) values ('Custom scratch dept');
create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS %', label;
  end;
end $$;
grant usage on schema tst to authenticated, anon;

-- 1. The eight Codex departments exist, seeded, with their slugs -------------------------------------------------------
do $$ declare n int; begin
  select count(*) into n from public.departments where is_system and slug in
    ('frontend-development','backend-development','devops','cybersecurity','ui-ux-design','graphics-creative','content','marketing');
  if n <> 8 then raise exception 'FAIL expected 8 seeded departments, found %', n; end if;
  raise notice 'PASS the 8 Codex departments are pre-provisioned';
end $$;

-- 2. System departments cannot be deleted or re-identified, even by a superadmin -------------------------------------
select tst.expect_error($$delete from public.departments where slug='cybersecurity'$$, 'cannot be deleted', 'system department cannot be deleted');
select tst.expect_error($$update public.departments set slug='x' where slug='cybersecurity'$$, 'identity cannot be changed', 'system department cannot be re-slugged');
delete from public.departments where name = 'Custom scratch dept';
do $$ begin raise notice 'PASS a non-system department can still be removed'; end $$;

-- 3. Reading departments: internal accounts yes, clients and anonymous no ----------------------------------------------
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (select count(*) from public.departments) <> 8 then raise exception 'FAIL worker should read all departments'; end if;
  raise notice 'PASS a worker can read departments';
end $$;
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  if (select count(*) from public.departments) <> 0 then raise exception 'FAIL a client must not read departments'; end if;
  raise notice 'PASS a client cannot read departments';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform count(*) from public.departments; raise notice 'PASS anonymous sees nothing (RLS or no grant)';
  exception when insufficient_privilege then raise notice 'PASS anonymous has no access'; end;
end $$;
reset role;

-- 4. Workers cannot write departments ----------------------------------------------------------------------------------
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
do $$ declare n int; begin
  update public.departments set name = 'Hacked' where slug = 'content';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL a worker changed a department'; end if;
  raise notice 'PASS a worker cannot rename a department';
end $$;
reset role;

-- 5. Department Admin: only a Main Admin assigns it ---------------------------------------------------------------------
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000b2');   -- manager (holds workers.update)
do $$ begin
  if not public.has_permission_for('00000000-0000-0000-0000-0000000000b2', 'workers.update') then raise exception 'FAIL fixture: manager should hold workers.update'; end if;
  raise notice 'PASS fixture: the manager holds workers.update';
end $$;
select tst.expect_error($$update public.worker_profiles set department_role='admin' where user_id='00000000-0000-0000-0000-0000000000b2'$$, 'Only a Main Admin', 'a manager with workers.update cannot make themselves Department Admin');
reset role;

set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000a1');   -- superadmin
update public.worker_profiles set department_role='admin' where user_id='00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if (select department_role from public.worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') <> 'admin' then raise exception 'FAIL superadmin could not assign a Department Admin'; end if;
  raise notice 'PASS a Main Admin can assign a Department Admin';
end $$;
reset role;

-- 6. Moving an admin to another department ends their admin role there ------------------------------------------------
update public.worker_profiles set department_id = (select id from public.departments where slug='backend-development') where user_id='00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if (select department_role from public.worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') <> 'member' then raise exception 'FAIL moved admin kept admin role'; end if;
  raise notice 'PASS moving a Department Admin demotes them to member';
end $$;

-- 7. An admin needs a department; roles are validated -------------------------------------------------------------------
select tst.expect_error($$update public.worker_profiles set department_id=null, department_role='admin' where user_id='00000000-0000-0000-0000-0000000000b1'$$, 'must belong to a department', 'a Department Admin must have a department');
select tst.expect_error($$update public.worker_profiles set department_role='owner' where user_id='00000000-0000-0000-0000-0000000000b1'$$, 'department_role_check', 'department_role is validated');

rollback;
