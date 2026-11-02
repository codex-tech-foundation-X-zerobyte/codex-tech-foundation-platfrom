-- Behavioural tests for 20260927000000_project_orchestration_and_announcements.sql
--   psql "$DATABASE_URL" -f supabase/tests/project_orchestration.test.sql   (all migrations applied; superuser; rolled back)
\set ON_ERROR_STOP on
begin;

-- People ------------------------------------------------------------------------------------------------------------
-- A Main Admin, a Frontend admin + member, a Cybersecurity member, a suspended Content admin, a client.
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000f1','fe-admin@x'),
 ('00000000-0000-0000-0000-0000000000f2','fe-member@x'), ('00000000-0000-0000-0000-0000000000c5','sec-member@x'),
 ('00000000-0000-0000-0000-0000000000d1','content-admin@x'), ('00000000-0000-0000-0000-0000000000e1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000d1');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000e1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-O0000001',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-O0000002',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000c5','CTF-WKR-O0000003',(select id from departments where slug='cybersecurity'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d1','CTF-WKR-O0000004',(select id from departments where slug='content'),'admin','suspended');

insert into projects (id, name, owner_id) values ('11111111-1111-1111-1111-111111111111','Zerobyte Launch','00000000-0000-0000-0000-0000000000a1');
-- A legacy task with no department: must keep behaving as before.
insert into tasks (id, project_id, title) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Legacy task');

create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS %', label; end; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin
  execute 'select count(*) from (' || sql || ') q' into n;
  if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated;
grant execute on all functions in schema tst to authenticated;

-- 1. Only the Main Admin assigns a project to departments ---------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$insert into project_departments (project_id, department_id) values ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='frontend-development'))$$, 'row-level security', 'a Department Admin cannot assign projects');
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into project_departments (project_id, department_id, objective, deliverables, deadline, assigned_by) values
 ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='frontend-development'),'Build the frontend application','{Dashboard,Authentication UI}','2026-10-15','00000000-0000-0000-0000-0000000000a1'),
 ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='cybersecurity'),'Security assessment','{Final audit}','2026-10-20','00000000-0000-0000-0000-0000000000a1'),
 ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='marketing'),'Launch campaign','{}',null,'00000000-0000-0000-0000-0000000000a1');
do $$ begin raise notice 'PASS a Main Admin assigns one project to several departments'; end $$;
select tst.expect_error($$insert into project_departments (project_id, department_id) values ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='frontend-development'))$$, 'duplicate key', 'one project cannot be assigned to the same department twice');
reset role;

-- 2. Notifications: Department Admins are told; with none, the Main Admin is told --------------------------------------------
do $$ begin
  if (select count(*) from notifications where user_id='00000000-0000-0000-0000-0000000000f1' and title='New department assignment') <> 1 then raise exception 'FAIL Frontend admin was not notified'; end if;
  if (select count(*) from notifications where user_id='00000000-0000-0000-0000-0000000000f2') <> 0 then raise exception 'FAIL a plain member was notified of an assignment'; end if;
  if (select count(*) from notifications where user_id='00000000-0000-0000-0000-0000000000a1' and title='Assignment has no Department Admin') <> 2 then raise exception 'FAIL Main Admin should hear about the two departments with no admin'; end if;
  raise notice 'PASS Department Admins are notified of assignments; the Main Admin is told when a department has none';
end $$;

-- 3. Who can see an assignment ----------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from project_departments$$, 1, 'a Frontend member sees only the Frontend assignment');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from project_departments where department_id=(select id from departments where slug='frontend-development')$$, 0, 'a Cybersecurity member cannot see the Frontend assignment');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from project_departments$$, 0, 'a client sees no assignments');
reset role;

-- 4. Working an assignment ---------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ declare n int; begin update project_departments set status='accepted' where department_id=(select id from departments where slug='frontend-development'); get diagnostics n=row_count;
  if n<>0 then raise exception 'FAIL a plain member accepted an assignment'; end if; raise notice 'PASS a plain member cannot accept an assignment'; end $$;
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$update project_departments set objective='Something else' where department_id=(select id from departments where slug='frontend-development')$$, 'Only a Main Admin can change what was assigned', 'a Department Admin cannot rewrite the objective');
select tst.expect_error($$update project_departments set status='in_review' where department_id=(select id from departments where slug='frontend-development')$$, 'Accept the assignment before', 'cannot skip straight past accepting');
update project_departments set status='accepted' where department_id=(select id from departments where slug='frontend-development');
do $$ begin
  if (select accepted_at from project_departments where status='accepted') is null then raise exception 'FAIL accepted_at not stamped'; end if;
  raise notice 'PASS a Department Admin accepts their assignment (timestamped)';
end $$;
select tst.expect_error($$update project_departments set status='completed' where department_id=(select id from departments where slug='frontend-development')$$, 'Only a Main Admin can mark', 'a Department Admin cannot mark their own assignment completed');
reset role;

-- 5. Breaking an accepted assignment into tasks ----------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into tasks (id, project_id, department_id, assignee_id, title, stage) values
 ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000f2','Build Authentication UI','Backlog');
do $$ begin raise notice 'PASS a Department Admin creates a department task for a member of their department'; end $$;
select tst.expect_error($$insert into tasks (project_id, department_id, assignee_id, title) values ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000c5','Wrong person')$$, 'someone in that department', 'department tasks cannot be assigned outside the department');
select tst.expect_error($$insert into tasks (project_id, department_id, title) values ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='cybersecurity'),'Not my department')$$, 'row-level security', 'a Department Admin cannot create tasks in another department');
reset role;

-- A department whose assignment is not yet accepted cannot be tasked, even by its own admin.
set local session_replication_role = replica;   -- fixture setup only: skip the Main-Admin-only guard trigger
update worker_profiles set department_role='admin' where user_id='00000000-0000-0000-0000-0000000000c5';
set local session_replication_role = origin;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_error($$insert into tasks (project_id, department_id, title) values ('11111111-1111-1111-1111-111111111111',(select id from departments where slug='cybersecurity'),'Too early')$$, 'row-level security', 'tasks need an accepted assignment first');
reset role;
set local session_replication_role = replica;
update worker_profiles set department_role='member' where user_id='00000000-0000-0000-0000-0000000000c5';
set local session_replication_role = origin;

-- 6. Visibility: department tasks are scoped, legacy tasks are not --------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from tasks$$, 2, 'a Frontend member sees the Frontend task and the legacy task');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from tasks where department_id is not null$$, 0, 'a Cybersecurity member cannot see Frontend tasks');
select tst.expect_count($$select 1 from tasks where department_id is null$$, 1, 'legacy (no department) tasks stay visible to every worker');
reset role;

-- 7. An assignee moves their task but cannot rewrite or reassign it --------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
update tasks set stage='In development', status='in_progress' where id='33333333-3333-3333-3333-333333333333';
do $$ begin
  if (select stage from tasks where id='33333333-3333-3333-3333-333333333333') <> 'In development' then raise exception 'FAIL assignee could not move own task'; end if;
  raise notice 'PASS an assignee moves their own task through its stages';
end $$;
select tst.expect_error($$update tasks set title='Renamed' where id='33333333-3333-3333-3333-333333333333'$$, 'only a Department Admin can edit', 'an assignee cannot rewrite their task');
select tst.expect_error($$update tasks set assignee_id='00000000-0000-0000-0000-0000000000f1' where id='33333333-3333-3333-3333-333333333333'$$, 'only a Department Admin can edit', 'an assignee cannot hand their task to someone else');
select tst.expect_error($$update tasks set department_id=null where id='33333333-3333-3333-3333-333333333333'$$, 'cannot be turned into a company-wide', 'a department task cannot be pulled out of its department');
reset role;

-- 8. A suspended Department Admin loses their powers ------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
do $$ begin if public.is_department_admin((select id from departments where slug='content')) then raise exception 'FAIL suspended admin still counts as admin'; end if;
  raise notice 'PASS a suspended Department Admin is no longer an admin'; end $$;
select tst.expect_error($$insert into announcements (department_id, title) values ((select id from departments where slug='content'),'From a suspended admin')$$, 'row-level security', 'a suspended Department Admin cannot post');
reset role;

-- 9. Announcements ------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into announcements (department_id, title, body) values ((select id from departments where slug='frontend-development'),'Frontend stand-up moved','10:30 from Monday');
do $$ begin raise notice 'PASS a Department Admin posts to their own department'; end $$;
select tst.expect_error($$insert into announcements (title) values ('Company-wide from a Department Admin')$$, 'row-level security', 'a Department Admin cannot post company-wide');
select tst.expect_error($$insert into announcements (department_id, title) values ((select id from departments where slug='cybersecurity'),'Other department')$$, 'row-level security', 'a Department Admin cannot post to another department');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_error($$insert into announcements (department_id, title) values ((select id from departments where slug='frontend-development'),'From a member')$$, 'row-level security', 'a plain member cannot post');
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into announcements (title, body, pinned) values ('Welcome to Codex Workspace','Everything lives here now.', true);
do $$ begin raise notice 'PASS the Main Admin posts company-wide'; end $$;
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from announcements$$, 2, 'a Frontend member reads company and Frontend announcements');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from announcements$$, 1, 'a Cybersecurity member reads only the company announcement');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from announcements$$, 0, 'a client reads no announcements');
reset role;

do $$ begin
  -- Company-wide: every ACTIVE internal account except the author (suspended d1 excluded; Main Admin is the author).
  if (select count(*) from notifications where title='Company announcement') <> 3 then raise exception 'FAIL company announcement fan-out: %', (select count(*) from notifications where title='Company announcement'); end if;
  -- Department: the Frontend member (author f1 excluded) and the Main Admin.
  if (select count(*) from notifications where title='Department announcement') <> 2 then raise exception 'FAIL department announcement fan-out: %', (select count(*) from notifications where title='Department announcement'); end if;
  raise notice 'PASS announcements notify the right people and skip the author and suspended accounts';
end $$;

rollback;
