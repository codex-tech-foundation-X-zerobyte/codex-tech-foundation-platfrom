-- Behavioural tests for 20260928000000_department_scoped_visibility.sql (all migrations applied; superuser; rolled back)
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000f2','fe@x'),
 ('00000000-0000-0000-0000-0000000000c5','sec@x'),  ('00000000-0000-0000-0000-0000000000f1','fe-admin@x'),
 ('00000000-0000-0000-0000-0000000000a9','mgr@x'),  ('00000000-0000-0000-0000-0000000000e1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000f1');
update public.profiles set role='manager' where id='00000000-0000-0000-0000-0000000000a9';
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000e1';
insert into worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-V0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-V0000002',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000c5','CTF-WKR-V0000003',(select id from departments where slug='cybersecurity'),'member','active');

-- P1 unassigned (legacy), P2 Frontend only, P3 Cybersecurity only, P4 owned by the Frontend member, assigned to Cybersecurity
insert into projects (id, name, owner_id) values
 ('10000000-0000-0000-0000-000000000001','P1 legacy','00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000002','P2 frontend','00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000003','P3 security','00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-000000000004','P4 own','00000000-0000-0000-0000-0000000000f2');
insert into project_departments (project_id, department_id) values
 ('10000000-0000-0000-0000-000000000002',(select id from departments where slug='frontend-development')),
 ('10000000-0000-0000-0000-000000000003',(select id from departments where slug='cybersecurity')),
 ('10000000-0000-0000-0000-000000000004',(select id from departments where slug='cybersecurity'));
insert into project_files (id, project_id, uploaded_by, name, storage_path) values
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','fe.pdf','x/fe.pdf'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','sec.pdf','x/sec.pdf');
insert into project_milestones (project_id, title) values ('10000000-0000-0000-0000-000000000003','Pen-test report');
insert into tasks (id, project_id, title) values ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Legacy-style task on a security project');
insert into clients (id, organization, owner_id) values
 ('40000000-0000-0000-0000-000000000002','Client of P2','00000000-0000-0000-0000-0000000000a1'),
 ('40000000-0000-0000-0000-000000000003','Client of P3','00000000-0000-0000-0000-0000000000a1'),
 ('40000000-0000-0000-0000-000000000009','Unlinked client','00000000-0000-0000-0000-0000000000a1');
insert into client_projects (client_id, project_id) values ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002'),('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003');
insert into resources (id, title, category, owner_id, department_id) values
 ('50000000-0000-0000-0000-000000000001','Company handbook','policy','00000000-0000-0000-0000-0000000000a1',null),
 ('50000000-0000-0000-0000-000000000002','Frontend standards','docs','00000000-0000-0000-0000-0000000000a1',(select id from departments where slug='frontend-development')),
 ('50000000-0000-0000-0000-000000000003','Incident runbook','docs','00000000-0000-0000-0000-0000000000a1',(select id from departments where slug='cybersecurity'));

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
create function tst.expect_zero_rows(sql text, label text) returns void language plpgsql as $$ declare n int; begin
  execute sql; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL % (changed % rows)', label, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

-- Projects --------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');   -- Frontend member
select tst.expect_count($$select 1 from projects where name like 'P%'$$, 3, 'a Frontend member sees the legacy project, their department''s project and the one they own');
select tst.expect_count($$select 1 from projects where name = 'P3 security'$$, 0, 'a Frontend member cannot see a Cybersecurity project');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');   -- Cybersecurity member
select tst.expect_count($$select 1 from projects where name like 'P%'$$, 3, 'a Cybersecurity member sees legacy, P3 and P4 (assigned to them) but not P2');
select tst.expect_count($$select 1 from projects where name = 'P2 frontend'$$, 0, 'a Cybersecurity member cannot see a Frontend project');
reset role;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from projects where name like 'P%'$$, 4, 'the Main Admin sees every project');
select tst.as_user('00000000-0000-0000-0000-0000000000a9');   -- manager without projects.view (no manager role grants on a fresh database)
select tst.expect_count($$select 1 from projects where name like 'P%'$$, 0, 'a manager with no project permission sees none');
reset role;

-- Editing -------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_zero_rows($$update projects set name = 'hijack' where name = 'P3 security'$$, 'a worker cannot edit a project outside their department');
select tst.expect_zero_rows($$update projects set status = 'completed' where name = 'P2 frontend'$$, 'a plain department member cannot edit a department project (only owner, members and the department admin can)');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');   -- Frontend admin
update projects set description = 'edited by the department admin' where name = 'P2 frontend';
do $$ begin raise notice 'PASS a Department Admin can edit a project assigned to their department'; end $$;
select tst.expect_zero_rows($$update projects set description = 'x' where name = 'P3 security'$$, 'a Department Admin cannot edit another department''s project');
reset role;

-- Files, milestones, tasks ---------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from project_files$$, 1, 'a Frontend member sees only the Frontend project''s file');
select tst.expect_error($$insert into project_files (project_id, uploaded_by, name, storage_path) values ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000f2','leak.pdf','x/leak.pdf')$$, 'row-level security', 'a worker cannot upload a file into a project they cannot see');
select tst.expect_count($$select 1 from project_milestones$$, 0, 'milestones of another department''s project are hidden');
select tst.expect_count($$select 1 from tasks where id = '30000000-0000-0000-0000-000000000003'$$, 0, 'a task of a hidden project is hidden even without a department');
reset role;

-- Clients ------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from clients$$, 1, 'a worker sees only clients linked to projects they can see');
select tst.expect_count($$select 1 from clients where organization = 'Unlinked client'$$, 0, 'an unlinked client is not visible to workers');
select tst.expect_count($$select 1 from client_users$$, 0, 'a worker cannot read client account mappings');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from clients$$, 3, 'the Main Admin sees every client');
reset role;

-- Resources ----------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from resources$$, 2, 'a Frontend member sees company-wide and Frontend resources only');
select tst.expect_error($$insert into resources (title, category, owner_id, department_id) values ('Sneaky','docs','00000000-0000-0000-0000-0000000000f2',(select id from departments where slug='cybersecurity'))$$, 'row-level security', 'a worker cannot add resources to another department');
insert into resources (title, category, owner_id, department_id) values ('Frontend checklist','docs','00000000-0000-0000-0000-0000000000f2',(select id from departments where slug='frontend-development'));
do $$ begin raise notice 'PASS a worker can add a resource to their own department'; end $$;
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');   -- client
select tst.expect_count($$select 1 from resources$$, 0, 'a client sees no internal resources');
reset role;
rollback;
