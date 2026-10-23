-- Behavioural tests for 20260928000001_worker_lifecycle_and_task_depth.sql (all migrations applied; superuser; rolled back)
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'),
 ('00000000-0000-0000-0000-0000000000f1','fe-admin@x'), ('00000000-0000-0000-0000-0000000000f2','fe-member@x'), ('00000000-0000-0000-0000-0000000000f3','fe-member2@x'),
 ('00000000-0000-0000-0000-0000000000c1','sec-admin@x'), ('00000000-0000-0000-0000-0000000000c5','sec-member@x');
update public.profiles set role='superadmin', display_name='Main Admin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker', display_name='Ike Admin'    where id='00000000-0000-0000-0000-0000000000f1';
update public.profiles set role='worker', display_name='Sam Member'   where id='00000000-0000-0000-0000-0000000000f2';
update public.profiles set role='worker', display_name='Tola Member'  where id='00000000-0000-0000-0000-0000000000f3';
update public.profiles set role='worker', display_name='Sec Admin'    where id='00000000-0000-0000-0000-0000000000c1';
update public.profiles set role='worker', display_name='Sec Member'   where id='00000000-0000-0000-0000-0000000000c5';
insert into worker_profiles (user_id, worker_id, department_id, department_role, status, must_change_password) values
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-L0000001',(select id from departments where slug='frontend-development'),'admin','active',false),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-L0000002',(select id from departments where slug='frontend-development'),'member','active',false),
 ('00000000-0000-0000-0000-0000000000f3','CTF-WKR-L0000003',(select id from departments where slug='frontend-development'),'member','invited',true),
 ('00000000-0000-0000-0000-0000000000c1','CTF-WKR-L0000004',(select id from departments where slug='cybersecurity'),'admin','active',false),
 ('00000000-0000-0000-0000-0000000000c5','CTF-WKR-L0000005',(select id from departments where slug='cybersecurity'),'member','active',false);

insert into projects (id, name, owner_id) values ('10000000-0000-0000-0000-000000000001','Launch','00000000-0000-0000-0000-0000000000a1'), ('10000000-0000-0000-0000-000000000002','Other','00000000-0000-0000-0000-0000000000a1');
insert into project_departments (project_id, department_id, status) values
 ('10000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'accepted'),
 ('10000000-0000-0000-0000-000000000001',(select id from departments where slug='cybersecurity'),'accepted');
insert into tasks (id, project_id, department_id, assignee_id, created_by, title, stage) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f1','Build login','Backlog'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f1','Build dashboard','Backlog'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',(select id from departments where slug='frontend-development'),null,'00000000-0000-0000-0000-0000000000f1','Elsewhere','Backlog');

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
create function tst.as_super() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); end $$;
create function tst.status_of(uid uuid) returns text language sql as $$ select status from public.worker_profiles where user_id = uid $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

-- A. Invited -> active on first password change ---------------------------------------------------------------------------------------------
update worker_profiles set must_change_password = false where user_id = '00000000-0000-0000-0000-0000000000f3';
do $$ begin
  if tst.status_of('00000000-0000-0000-0000-0000000000f3') <> 'active' then raise exception 'FAIL invited worker did not become active'; end if;
  raise notice 'PASS an invited worker becomes active when they set their own password';
end $$;

-- B. Suspension requests ----------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');   -- Frontend admin
select tst.expect_error($$insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000c5','x is bad')$$, 'only raise cases for workers in your own department', 'a Department Admin cannot raise a case against another department''s worker');
select tst.expect_error($$insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f1','self')$$, 'against yourself', 'a Department Admin cannot raise a case against themselves');
select tst.expect_error($$insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f2','ab')$$, 'check', 'a case needs a real reason');
insert into suspension_cases (worker_user_id, reason, evidence) values ('00000000-0000-0000-0000-0000000000f2','Repeated missed deadlines','Three late deliveries in October');
do $$ begin
  if tst.status_of('00000000-0000-0000-0000-0000000000f2') <> 'suspension_pending' then raise exception 'FAIL worker not pending'; end if;
  if (select count(*) from suspension_case_events) <> 1 then raise exception 'FAIL no event recorded'; end if;
  raise notice 'PASS a Department Admin raises a case; the worker goes to SUSPENSION_PENDING and the request is recorded';
end $$;
select tst.expect_error($$insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f2','again please')$$, 'already', 'a worker cannot have two open cases');
select tst.expect_zero_rows($$update suspension_cases set status = 'suspended'$$, 'a Department Admin cannot decide a case');
select tst.expect_count($$select 1 from suspension_cases$$, 1, 'the requesting Department Admin can read the case');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');   -- another department's admin
select tst.expect_count($$select 1 from suspension_cases$$, 0, 'another department''s admin cannot see the case');
reset role;
do $$ begin
  if (select count(*) from notifications where title = 'Suspension review needed' and user_id = '00000000-0000-0000-0000-0000000000a1') <> 1 then raise exception 'FAIL Main Admin not notified'; end if;
  raise notice 'PASS the Main Admin is notified of the request';
end $$;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_error($$insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f1','a Frontend admin from the outside')$$, 'Only a Main Admin can raise a case against a Department Admin', 'only a Main Admin can raise a case against a Department Admin');
reset role;

-- C. The pending worker still has access; the decision changes that -----------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
do $$ begin if public."current_role"() is distinct from 'worker' then raise exception 'FAIL a pending worker lost access before a decision'; end if; raise notice 'PASS a worker with a pending case keeps access until a Main Admin decides'; end $$;
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');   -- Main Admin: continue suspension
update suspension_cases set status = 'suspended', decision_note = 'Two weeks' where worker_user_id = '00000000-0000-0000-0000-0000000000f2';
reset role;
do $$ begin
  if tst.status_of('00000000-0000-0000-0000-0000000000f2') <> 'suspended' then raise exception 'FAIL not suspended'; end if;
  if (select count(*) from notifications where title = 'Suspension decision' and user_id = '00000000-0000-0000-0000-0000000000f1') <> 1 then raise exception 'FAIL requester not told'; end if;
  raise notice 'PASS the Main Admin continues the suspension and the requester is told';
end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');   -- the suspended worker
do $$ begin
  if public."current_role"() is not null then raise exception 'FAIL suspended worker still has a role'; end if;
  if public.has_permission('projects.view') then raise exception 'FAIL suspended worker still has permissions'; end if;
  raise notice 'PASS a suspended worker has no role and no permissions, even with a valid session';
end $$;
select tst.expect_count($$select 1 from projects$$, 0, 'a suspended worker cannot read projects');
select tst.expect_count($$select 1 from tasks$$, 0, 'a suspended worker cannot read tasks, not even their own');
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
update suspension_cases set status = 'under_review' where worker_user_id = '00000000-0000-0000-0000-0000000000f2';
reset role;
do $$ begin if tst.status_of('00000000-0000-0000-0000-0000000000f2') <> 'review' then raise exception 'FAIL not in review'; end if; raise notice 'PASS a suspended worker can be moved to REVIEW'; end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$update suspension_cases set reason = 'rewritten history'$$, 'facts of a case cannot be edited', 'the facts of a case cannot be rewritten');
update suspension_cases set status = 'restored', decision_note = 'Cleared' where worker_user_id = '00000000-0000-0000-0000-0000000000f2';
reset role;
do $$ begin
  if tst.status_of('00000000-0000-0000-0000-0000000000f2') <> 'active' then raise exception 'FAIL not restored'; end if;
  if (select count(*) from suspension_case_events) <> 4 then raise exception 'FAIL expected 4 events, got %', (select count(*) from suspension_case_events); end if;
  raise notice 'PASS REVIEW -> ACTIVE restores access and the whole history is kept';
end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$update suspension_cases set status = 'offboarded'$$, 'case is closed', 'a closed case cannot be reopened');
select tst.expect_zero_rows($$delete from suspension_cases$$, 'cases cannot be deleted, even by the Main Admin');
reset role;

-- C2. While a case is open, the status cannot be changed around it -------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f3', 'Policy breach under review');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$update worker_profiles set status = 'active' where user_id = '00000000-0000-0000-0000-0000000000f3'$$, 'open suspension case', 'not even a Main Admin can reactivate a worker behind an open case');
update suspension_cases set status = 'restored', decision_note = 'Fine' where worker_user_id = '00000000-0000-0000-0000-0000000000f3';
update worker_profiles set status = 'inactive' where user_id = '00000000-0000-0000-0000-0000000000f3';
do $$ begin raise notice 'PASS once the case is closed, the status can be managed directly again'; end $$;
reset role;
select tst.as_super();
update worker_profiles set status = 'active' where user_id = '00000000-0000-0000-0000-0000000000f3';

-- D. Offboarding keeps the record ---------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into suspension_cases (worker_user_id, reason) values ('00000000-0000-0000-0000-0000000000f2','Second serious incident');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
update suspension_cases set status = 'offboarded', decision_note = 'Contract ended' where worker_user_id = '00000000-0000-0000-0000-0000000000f2' and status = 'pending';
reset role;
do $$ begin
  if tst.status_of('00000000-0000-0000-0000-0000000000f2') <> 'offboarded' then raise exception 'FAIL not offboarded'; end if;
  if (select count(*) from tasks where assignee_id = '00000000-0000-0000-0000-0000000000f2') <> 2 then raise exception 'FAIL offboarding erased task history'; end if;
  raise notice 'PASS an offboarded worker is kept on the record: tasks, cases and events remain';
end $$;

-- E. Who may change a status directly ---------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_zero_rows($$update worker_profiles set status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000000c5'$$, 'a Department Admin cannot suspend directly (no row access)');
reset role;
do $$ begin
  begin
    set local role authenticated; perform tst.as_user('00000000-0000-0000-0000-0000000000a1');
    update worker_profiles set status = 'inactive' where user_id = '00000000-0000-0000-0000-0000000000c5';
    raise notice 'PASS a Main Admin can still change a status directly';
  end;
end $$;
reset role;

-- A manager granted workers.suspend may suspend, but never offboard.
insert into public.roles (name, description) values ('manager', 'test') on conflict (name) do nothing;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.name = 'manager' and p.key in ('workers.view', 'workers.suspend', 'workers.update') on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9','mgr@x');
update public.profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000a9';
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a9');
update worker_profiles set status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000000c5';
do $$ begin if tst.status_of('00000000-0000-0000-0000-0000000000c5') <> 'suspended' then raise exception 'FAIL manager with workers.suspend could not suspend'; end if; raise notice 'PASS a manager with workers.suspend can still suspend'; end $$;
select tst.expect_error($$update worker_profiles set status = 'offboarded' where user_id = '00000000-0000-0000-0000-0000000000c5'$$, 'Only a Main Admin', 'a manager with workers.suspend cannot offboard');
reset role;

-- F. Checklists --------------------------------------------------------------------------------------------------------------------------------------
select tst.as_super();   -- leave the last session user behind before touching fixtures as the superuser
update worker_profiles set status = 'active' where user_id in ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000c5');   -- fixture
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');   -- assignee
insert into task_checklist_items (task_id, body, position) values ('30000000-0000-0000-0000-000000000001','Login form',1), ('30000000-0000-0000-0000-000000000001','Validation',2);
update task_checklist_items set done = true where body = 'Login form';
do $$ begin
  if (select done_by from task_checklist_items where body = 'Login form') is distinct from '00000000-0000-0000-0000-0000000000f2'::uuid then raise exception 'FAIL done_by not stamped'; end if;
  raise notice 'PASS an assignee builds and ticks a checklist (who and when are stamped)';
end $$;
select tst.as_user('00000000-0000-0000-0000-0000000000f3');   -- department colleague, not assignee
select tst.expect_count($$select 1 from task_checklist_items$$, 2, 'a department colleague can read the checklist');
select tst.expect_zero_rows($$update task_checklist_items set done = true where body = 'Validation'$$, 'a colleague who is not the assignee cannot tick it');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');   -- other department
select tst.expect_count($$select 1 from task_checklist_items$$, 0, 'another department cannot see the checklist');
reset role;

-- G. Comments, mentions, watchers --------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f3');
insert into task_watchers (task_id, user_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f3');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_error($$insert into task_watchers (task_id, user_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c5')$$, 'row-level security', 'nobody can watch a task they cannot see');
select tst.expect_error($$insert into task_comments (task_id, body) values ('30000000-0000-0000-0000-000000000001','peeking')$$, 'row-level security', 'nobody can comment on a task they cannot see');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');   -- the creator comments, mentioning Sec Member (other department) and the watcher
insert into task_comments (task_id, body) values ('30000000-0000-0000-0000-000000000001','Looks good @Sec Member @Tola Member please review');
reset role;
do $$ begin
  if (select count(*) from notifications where title = 'Comment on Build login' and user_id = '00000000-0000-0000-0000-0000000000f2') <> 1 then raise exception 'FAIL assignee not told of comment'; end if;
  if (select count(*) from notifications where title = 'Comment on Build login' and user_id = '00000000-0000-0000-0000-0000000000f3') <> 1 then raise exception 'FAIL watcher not told of comment'; end if;
  if (select count(*) from notifications where title like 'You were mentioned%' and user_id = '00000000-0000-0000-0000-0000000000c5') <> 0 then raise exception 'FAIL mention leaked task title to another department'; end if;
  raise notice 'PASS comments notify the assignee and watchers, and a mention never leaks a task to someone who cannot see it';
end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_zero_rows($$delete from task_comments$$, 'comments cannot be deleted');
reset role;

-- H. Dependencies --------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into task_dependencies (task_id, depends_on_task_id) values ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');   -- dashboard waits on login
select tst.expect_error($$insert into task_dependencies (task_id, depends_on_task_id) values ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')$$, 'circular', 'a circular dependency is refused');
select tst.expect_error($$insert into task_dependencies (task_id, depends_on_task_id) values ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003')$$, 'same project', 'a dependency must be in the same project');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_error($$update tasks set status = 'done', stage = 'Deployed' where id = '30000000-0000-0000-0000-000000000002'$$, 'Finish "Build login" first', 'a task cannot be finished while its dependency is open');
update tasks set status = 'done', stage = 'Deployed' where id = '30000000-0000-0000-0000-000000000001';
update tasks set status = 'done', stage = 'Deployed' where id = '30000000-0000-0000-0000-000000000002';
do $$ begin raise notice 'PASS once the dependency is done, the dependent task can be finished'; end $$;
reset role;

-- I. Review state ---------------------------------------------------------------------------------------------------------------------------------------
select tst.as_super();
update tasks set status = 'in_progress', stage = 'QA', review_state = 'none' where id = '30000000-0000-0000-0000-000000000001';   -- fixture reset
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
update tasks set review_state = 'requested' where id = '30000000-0000-0000-0000-000000000001';
select tst.expect_error($$update tasks set review_state = 'approved' where id = '30000000-0000-0000-0000-000000000001'$$, 'Only a Department Admin can approve', 'an assignee cannot approve their own work');
reset role;
do $$ begin
  if (select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000f1' and title = 'Build login' and body like '%ready for review%') <> 1 then raise exception 'FAIL Department Admin not asked to review'; end if;
  raise notice 'PASS asking for review notifies the Department Admin';
end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
update tasks set review_state = 'changes_requested' where id = '30000000-0000-0000-0000-000000000001';
update tasks set review_state = 'approved' where id = '30000000-0000-0000-0000-000000000001';
do $$ begin raise notice 'PASS a Department Admin can ask for changes and approve'; end $$;
reset role;

rollback;
