-- Behavioural tests for 20261001000000_multi_department_membership.sql (all migrations applied; superuser; rolled back)
\set ON_ERROR_STOP on
begin;

-- Role first, so the sync trigger attaches the permission when the account becomes a manager.
insert into public.roles (name, description) values ('manager','test') on conflict (name) do nothing;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.name='manager' and p.key in ('workers.update','workers.view') on conflict do nothing;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','fullstack@x'),
 ('00000000-0000-0000-0000-0000000000b2','devops-only@x'), ('00000000-0000-0000-0000-0000000000b3','be-admin@x'),
 ('00000000-0000-0000-0000-0000000000a9','mgr@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3');
update public.profiles set role='manager' where id='00000000-0000-0000-0000-0000000000a9';
-- Legacy-style inserts (what the create-worker function does): one department each.
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-M0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-M0000002',(select id from departments where slug='devops'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b3','CTF-WKR-M0000003',(select id from departments where slug='backend-development'),'admin','active');
insert into projects (id, name, owner_id) values
 ('10000000-0000-0000-0000-000000000001','BE project','00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000002','Ops project','00000000-0000-0000-0000-0000000000a1');
insert into project_departments (project_id, department_id) values
 ('10000000-0000-0000-0000-000000000001',(select id from departments where slug='backend-development')),
 ('10000000-0000-0000-0000-000000000002',(select id from departments where slug='devops'));

create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin
  execute 'select count(*) from (' || sql || ') q' into n;
  if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin
  if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

-- 1. Existing workers were backfilled / mirrored as primary memberships ------------------------------------------------------------
select tst.expect_true((select count(*) from worker_departments where is_primary) = 3, 'every worker has exactly one primary membership after legacy inserts');
select tst.expect_true((select department_role from worker_departments where user_id='00000000-0000-0000-0000-0000000000b3') = 'admin', 'a legacy Department Admin insert becomes an admin membership');

-- 2. Only the Main Admin can place people ----------------------------------------------------------------------------------------
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select set_worker_departments('00000000-0000-0000-0000-0000000000b1', '[]'::jsonb)$$, 'only a main admin', 'a worker cannot place themselves in departments');
select tst.expect_error($$insert into worker_departments (user_id, department_id) values ('00000000-0000-0000-0000-0000000000b1',(select id from departments where slug='cybersecurity'))$$, 'only a main admin', 'a worker cannot insert a membership directly');
select tst.as_user('00000000-0000-0000-0000-0000000000a9');
select tst.expect_error($$select set_worker_departments('00000000-0000-0000-0000-0000000000b1', '[]'::jsonb)$$, 'only a main admin', 'a manager with workers.update cannot place workers in departments');
select tst.expect_error($$update worker_profiles set department_role='admin' where user_id='00000000-0000-0000-0000-0000000000b1'$$, 'main admin', 'the old department_role guard still holds');

-- 3. The Main Admin gives the full-stack worker three departments -----------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_worker_departments('00000000-0000-0000-0000-0000000000b1', jsonb_build_array(
  jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'role','member','primary',true),
  jsonb_build_object('department_id',(select id from departments where slug='backend-development'),'role','member'),
  jsonb_build_object('department_id',(select id from departments where slug='devops'),'role','admin')));
select tst.expect_true((select count(*) from worker_departments where user_id='00000000-0000-0000-0000-0000000000b1') = 3, 'a worker can belong to three departments');
select tst.expect_true((select department_id from worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') = (select id from departments where slug='frontend-development'), 'the primary department is mirrored onto worker_profiles');
select tst.expect_error($$select set_worker_departments('00000000-0000-0000-0000-0000000000b1', jsonb_build_array(jsonb_build_object('department_id',(select id from departments where slug='devops')), jsonb_build_object('department_id',(select id from departments where slug='devops'))))$$, 'only be listed once', 'the same department cannot be listed twice');
select tst.expect_error($$select set_worker_departments('00000000-0000-0000-0000-0000000000b1', jsonb_build_array(jsonb_build_object('department_id',gen_random_uuid())))$$, 'unknown department', 'unknown departments are rejected');
select tst.expect_error($$select set_worker_departments('00000000-0000-0000-0000-0000000000a9', '[]'::jsonb)$$, 'not a worker', 'only workers can be placed');

-- 4. Access follows ALL memberships ----------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from projects where name in ('BE project','Ops project')$$, 2, 'the full-stack worker sees projects of both their secondary departments');
select tst.expect_true(is_department_member((select id from departments where slug='backend-development')), 'is_department_member is true for a secondary department');
select tst.expect_true(is_department_admin((select id from departments where slug='devops')), 'they administer devops (a secondary department)...');
select tst.expect_true(not is_department_admin((select id from departments where slug='frontend-development')), '...but not frontend: admin is per department');
select tst.expect_true(not is_department_member((select id from departments where slug='cybersecurity')), 'and are not in cybersecurity');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from projects where name in ('BE project','Ops project')$$, 1, 'a devops-only worker still sees only the devops project');

-- 5. Department admin rights cross over correctly ---------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
reset role; insert into tasks (id, project_id, title, department_id) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Ops task',(select id from departments where slug='devops'));
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(can_work_task('30000000-0000-0000-0000-000000000001'), 'a department admin of a SECONDARY department can manage its tasks');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
reset role;
update tasks set assignee_id='00000000-0000-0000-0000-0000000000b1' where id='30000000-0000-0000-0000-000000000001';
do $$ begin raise notice 'PASS a task in a secondary department can be assigned to a multi-department worker'; end $$;
select tst.expect_error($$update tasks set assignee_id='00000000-0000-0000-0000-0000000000a9' where id='30000000-0000-0000-0000-000000000001'$$, 'someone in that department', 'but not to someone outside it');
select tst.expect_error($$update tasks set assignee_id='00000000-0000-0000-0000-0000000000b3' where id='30000000-0000-0000-0000-000000000001'$$, 'someone in that department', 'nor to a member of another department only');

-- 6. Chat channels: in the channel of every department -----------------------------------------------------------------------------
select tst.expect_true((select count(*) from chat_channel_members m join chat_channels c on c.id=m.channel_id
   where m.user_id='00000000-0000-0000-0000-0000000000b1' and c.department_id is not null)
   = (select count(*) from chat_channels where department_id in (select id from departments where slug in ('frontend-development','backend-development','devops'))), 'the worker is in every channel of all three departments');

-- 7. Removing memberships ---------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_worker_departments('00000000-0000-0000-0000-0000000000b1', jsonb_build_array(
  jsonb_build_object('department_id',(select id from departments where slug='backend-development'),'role','member')));
select tst.expect_true((select department_id from worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') = (select id from departments where slug='backend-development'), 'removing the primary promotes a remaining department');
select tst.expect_true((select department_role from worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') = 'member', 'and the mirrored role follows it (admin of devops does not leak)');
reset role;
select tst.expect_true((select count(*) from chat_channel_members m join chat_channels c on c.id=m.channel_id
   where m.user_id='00000000-0000-0000-0000-0000000000b1' and c.department_id is not null)
   = (select count(*) from chat_channels where department_id = (select id from departments where slug='backend-development')), 'leaving departments removes their channels');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from projects where name = 'Ops project'$$, 0, 'and their access to the left department''s projects');
select tst.expect_true(not is_department_admin((select id from departments where slug='devops')), 'and their admin rights there');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_worker_departments('00000000-0000-0000-0000-0000000000b1', '[]'::jsonb);
select tst.expect_true((select department_id from worker_profiles where user_id='00000000-0000-0000-0000-0000000000b1') is null, 'an empty list leaves the worker unassigned');
select tst.expect_true((select count(*) from worker_departments where user_id='00000000-0000-0000-0000-0000000000b1') = 0, '...with no memberships');

-- 8. Legacy writes still behave like a "move" ------------------------------------------------------------------------------------
reset role;
update worker_profiles set department_id=(select id from departments where slug='cybersecurity') where user_id='00000000-0000-0000-0000-0000000000b2';
select tst.expect_true((select array_agg(d.slug) from worker_departments wd join departments d on d.id=wd.department_id where wd.user_id='00000000-0000-0000-0000-0000000000b2') = array['cybersecurity'], 'a direct department_id change moves the worker (old membership ends)');

-- 9. Auditing --------------------------------------------------------------------------------------------------------------------
select tst.expect_true((select count(*) from audit_logs where action in ('worker.department_added','worker.department_removed')) > 0, 'membership changes are audited');

rollback;
