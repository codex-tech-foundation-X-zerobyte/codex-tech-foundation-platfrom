-- Behavioural tests for 20261001000001_personal_projects.sql and 20261001000002_presentation_board.sql (all migrations applied; rolled back)
\set ON_ERROR_STOP on
begin;

insert into public.roles (name, description) values ('manager','test') on conflict (name) do nothing;
insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p
  where r.name='manager' and p.key in ('projects.view','tasks.view') on conflict do nothing;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','w1@x'), ('00000000-0000-0000-0000-0000000000b2','w2@x'),
 ('00000000-0000-0000-0000-0000000000b3','w3@x'), ('00000000-0000-0000-0000-0000000000a9','mgr@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3');
update public.profiles set role='manager' where id='00000000-0000-0000-0000-0000000000a9';
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
update public.profiles set display_name='Wale' where id='00000000-0000-0000-0000-0000000000b1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-P0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-P0000002',(select id from departments where slug='devops'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b3','CTF-WKR-P0000003',(select id from departments where slug='backend-development'),'member','active');
-- w1 is full-stack: frontend (primary) + backend
insert into public.worker_departments (user_id, department_id, department_role) values ('00000000-0000-0000-0000-0000000000b1',(select id from departments where slug='backend-development'),'member');

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
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin
  if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated; grant usage on schema storage to authenticated;

-- ══ PERSONAL PROJECTS ════════════════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into projects (id, name, scope, owner_id) values ('10000000-0000-0000-0000-0000000000a1','My side project','personal','00000000-0000-0000-0000-0000000000b2');
select tst.expect_true((select owner_id from projects where id='10000000-0000-0000-0000-0000000000a1') = '00000000-0000-0000-0000-0000000000b1', 'a worker can create a personal project, and always owns it (an owner they claim for someone else is ignored)');
select tst.expect_error($$insert into projects (name) values ('Sneaky company project')$$, 'personal projects', 'a worker cannot create a company project');
select tst.expect_error($$insert into projects (name, scope, client_id) values ('X','personal','00000000-0000-0000-0000-0000000000c1')$$, 'personal_stays_private', 'a personal project cannot be a client project');
insert into tasks (id, project_id, title) values ('30000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','Plan it');
do $$ begin raise notice 'PASS the owner can add tasks to their personal project'; end $$;
select tst.expect_error($$update projects set scope='company' where id='10000000-0000-0000-0000-0000000000a1'$$, 'main admin', 'the owner cannot turn it into a company project');
select tst.expect_error($$update projects set publication_status='published', public_visibility=true where id='10000000-0000-0000-0000-0000000000a1'$$, 'personal_stays_private', 'nor publish it to the public site');

select tst.as_user('00000000-0000-0000-0000-0000000000b2');   -- another worker
select tst.expect_count($$select 1 from projects where scope='personal'$$, 0, 'another worker cannot see it');
select tst.expect_count($$select 1 from tasks where project_id='10000000-0000-0000-0000-0000000000a1'$$, 0, 'nor its tasks');
select tst.expect_zero_rows($$update projects set name='hijacked' where id='10000000-0000-0000-0000-0000000000a1'$$, 'nor edit it');
select tst.expect_zero_rows($$delete from projects where id='10000000-0000-0000-0000-0000000000a1'$$, 'nor delete it');
select tst.as_user('00000000-0000-0000-0000-0000000000a9');   -- manager holding projects.view and tasks.view
select tst.expect_count($$select 1 from projects where scope='personal'$$, 0, 'a manager with projects.view still cannot see it');
select tst.expect_count($$select 1 from tasks where project_id='10000000-0000-0000-0000-0000000000a1'$$, 0, 'nor its tasks, despite tasks.view');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from projects where scope='personal'$$, 1, 'a Main Admin can see it (they oversee the Workspace)');
select tst.expect_error($$insert into project_departments (project_id, department_id) values ('10000000-0000-0000-0000-0000000000a1',(select id from departments where slug='devops'))$$, 'personal project', 'a personal project cannot be assigned to a department');

-- invite a collaborator
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into project_members (project_id, user_id) values ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b3');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_count($$select 1 from projects where scope='personal'$$, 1, 'an invited collaborator can see it');
select tst.expect_count($$select 1 from tasks where project_id='10000000-0000-0000-0000-0000000000a1'$$, 1, 'and its tasks');

-- company projects behave as before
reset role; select set_config('request.jwt.claim.sub', '', true);   -- a trusted server context, not a signed-in worker
insert into projects (id, name, owner_id) values ('10000000-0000-0000-0000-0000000000c1','Legacy company project','00000000-0000-0000-0000-0000000000a1');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from projects where name='Legacy company project'$$, 1, 'company projects are unaffected: an unassigned one is still visible to workers');
-- main admin promotes it
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
update projects set scope='company' where id='10000000-0000-0000-0000-0000000000a1';
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from projects where id='10000000-0000-0000-0000-0000000000a1'$$, 1, 'after a Main Admin makes it a company project it follows company rules');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
update projects set scope='personal' where id='10000000-0000-0000-0000-0000000000a1';
-- owner deletes
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
delete from projects where id='10000000-0000-0000-0000-0000000000a1';
select tst.expect_count($$select 1 from projects where id='10000000-0000-0000-0000-0000000000a1'$$, 0, 'the owner can delete their own personal project');
reset role;

-- ══ PRESENTATIONS ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into presentation_sessions (id, department_id, presenter_id, title, kind, state) values
 ('70000000-0000-0000-0000-000000000001',(select id from departments where slug='backend-development'),'00000000-0000-0000-0000-0000000000b1','API walkthrough','console','{"lines":[]}');
select tst.expect_true((select status from presentation_sessions where id='70000000-0000-0000-0000-000000000001') = 'live', 'a multi-department worker can present to a SECONDARY department');
select tst.expect_error($$insert into presentation_sessions (department_id, presenter_id, title, kind) values ((select id from departments where slug='devops'),'00000000-0000-0000-0000-0000000000b1','Not mine','browser')$$, 'row-level security', 'but not to a department they are not in');
select tst.expect_error($$insert into presentation_sessions (department_id, presenter_id, title, kind) values ((select id from departments where slug='backend-development'),'00000000-0000-0000-0000-0000000000b3','Impersonation','browser')$$, 'row-level security', 'nor as somebody else');
select tst.expect_error($$insert into presentation_sessions (department_id, presenter_id, title, kind) values ((select id from departments where slug='backend-development'),'00000000-0000-0000-0000-0000000000b1','x','hologram')$$, 'check constraint', 'only known stage types are accepted');

select tst.as_user('00000000-0000-0000-0000-0000000000b3');   -- backend colleague
select tst.expect_count($$select 1 from presentation_sessions where status='live'$$, 1, 'a department colleague sees the live presentation');
select tst.expect_zero_rows($$update presentation_sessions set state='{"lines":["hijack"]}' where id='70000000-0000-0000-0000-000000000001'$$, 'a colleague cannot change what is on stage (RLS: no matching row)');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');   -- devops only
select tst.expect_count($$select 1 from presentation_sessions$$, 0, 'someone in another department does not see it');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from presentation_sessions$$, 0, 'a client does not see it');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from presentation_sessions$$, 1, 'a Main Admin sees it');
select tst.expect_error($$update presentation_sessions set state='{"lines":["admin edit"]}' where id='70000000-0000-0000-0000-000000000001'$$, 'only the presenter', 'a Main Admin cannot take over the stage...');
update presentation_sessions set status='ended' where id='70000000-0000-0000-0000-000000000001';
select tst.expect_true((select ended_at is not null from presentation_sessions where id='70000000-0000-0000-0000-000000000001'), '...but can end it');
select tst.expect_error($$update presentation_sessions set status='live' where id='70000000-0000-0000-0000-000000000001'$$, 'cannot be restarted', 'an ended presentation cannot be restarted');

-- presenter controls
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into presentation_sessions (id, department_id, presenter_id, title, kind, state) values
 ('70000000-0000-0000-0000-000000000002',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000b1','Landing page demo','browser','{"url":"https://example.com"}');
update presentation_sessions set state='{"url":"https://example.com/next"}' where id='70000000-0000-0000-0000-000000000002';
select tst.expect_true((select state_version from presentation_sessions where id='70000000-0000-0000-0000-000000000002') = 1, 'each change to the stage bumps the version');
select tst.expect_error($$update presentation_sessions set kind='slides' where id='70000000-0000-0000-0000-000000000002'$$, 'cannot change', 'the stage type cannot change mid-session');
select tst.expect_error($$update presentation_sessions set state=jsonb_build_object('x', repeat('a', 300000)) where id='70000000-0000-0000-0000-000000000002'$$, 'check constraint', 'stage state is capped in size');
insert into presentation_sessions (id, department_id, presenter_id, title, kind) values
 ('70000000-0000-0000-0000-000000000003',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000b1','Second thing','slides');
select tst.expect_true((select status from presentation_sessions where id='70000000-0000-0000-0000-000000000002') = 'ended', 'starting a new presentation ends your previous live one');

-- company-wide
insert into presentation_sessions (id, presenter_id, title, kind, visibility) values ('70000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000b1','All-hands demo','cinema','company');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from presentation_sessions where title='All-hands demo'$$, 1, 'a company-wide presentation reaches every department');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from presentation_sessions where title='All-hands demo'$$, 0, 'but never clients');
select tst.expect_error($$insert into presentation_sessions (presenter_id, title, kind, visibility) values ('00000000-0000-0000-0000-0000000000c1','client tries','slides','company')$$, 'row-level security', 'and clients cannot present');

-- notifications
reset role;
select tst.expect_true((select array_agg(user_id order by user_id) from notifications where body='API walkthrough' and title='Wale is presenting')
   = array['00000000-0000-0000-0000-0000000000a1'::uuid,'00000000-0000-0000-0000-0000000000b3'::uuid],
   'going live notifies the Main Admin and the backend colleague, but not the presenter and not another department');

-- files
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into storage.objects (bucket_id, name, owner) values ('presentations','70000000-0000-0000-0000-000000000004/demo.mp4','00000000-0000-0000-0000-0000000000b1');
do $$ begin raise notice 'PASS the presenter can upload a file for their session'; end $$;
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$insert into storage.objects (bucket_id, name, owner) values ('presentations','70000000-0000-0000-0000-000000000004/evil.mp4','00000000-0000-0000-0000-0000000000b2')$$, 'row-level security', 'someone else cannot upload into a session they do not present');
select tst.expect_count($$select 1 from storage.objects where bucket_id='presentations'$$, 1, 'the audience of a company-wide presentation can read its files');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from storage.objects where bucket_id='presentations'$$, 0, 'a client cannot read presentation files');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_count($$select 1 from storage.objects where bucket_id='presentations'$$, 1, 'company-wide files are readable by every department...');
reset role;
insert into storage.objects (bucket_id, name, owner) values ('presentations','70000000-0000-0000-0000-000000000003/slide.png','00000000-0000-0000-0000-0000000000b1');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from storage.objects where bucket_id='presentations' and name like '70000000-0000-0000-0000-000000000003/%'$$, 0, '...but a department-only session''s files are not readable by other departments');

rollback;
