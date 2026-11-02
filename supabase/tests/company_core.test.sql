-- Behavioural tests for 20260929000000_company_core.sql (all migrations applied; superuser; rolled back)
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000f1','fe-admin@x'), ('00000000-0000-0000-0000-0000000000f2','fe@x'),
 ('00000000-0000-0000-0000-0000000000f3','fe2@x'), ('00000000-0000-0000-0000-0000000000c5','sec@x'), ('00000000-0000-0000-0000-0000000000e1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000c5');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000e1';
insert into worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-K0000001',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-K0000002',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f3','CTF-WKR-K0000003',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000c5','CTF-WKR-K0000004',(select id from departments where slug='cybersecurity'),'member','active');
insert into projects (id, name, owner_id) values ('10000000-0000-0000-0000-000000000001','Launch','00000000-0000-0000-0000-0000000000a1');
insert into project_departments (project_id, department_id, status) values ('10000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'accepted');
insert into tasks (id, project_id, department_id, assignee_id, title, stage) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000f2','Build login','Backlog');

create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.as_super() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then if sqlerrm like 'FAIL %' then raise; end if; if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if; raise notice 'PASS %', label; end; end $$;
create function tst.expect_zero_rows(sql text, label text) returns void language plpgsql as $$ declare n int; begin execute sql; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL % (changed % rows)', label, n; end if; raise notice 'PASS %', label; end $$;
create function tst.member_of(uid uuid) returns int language sql as $$ select count(*)::int from public.chat_channel_members m join public.chat_channels c on c.id = m.channel_id where m.user_id = uid and c.department_id is not null $$;
create function tst.secret_unreadable() returns void language plpgsql as $$ declare n int; begin
  begin select count(*) into n from public.integration_secrets; if n <> 0 then raise exception 'FAIL a browser session read % integration secret(s)', n; end if;
  exception when insufficient_privilege then null; end;
  raise notice 'PASS not even a Main Admin''s browser session can read an integration secret'; end $$;
grant execute on function tst.secret_unreadable() to authenticated;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

-- A. Department channels ---------------------------------------------------------------------------------------------------------------------------
do $$ begin
  if (select count(*) from chat_channels where department_id is not null) <> 31 then raise exception 'FAIL expected 31 department channels (25 for the original eight departments, 6 for Finance and Customer Service)'; end if;
  if tst.member_of('00000000-0000-0000-0000-0000000000f2') <> 3 then raise exception 'FAIL Frontend worker should be in the 3 Frontend channels, got %', tst.member_of('00000000-0000-0000-0000-0000000000f2'); end if;
  if tst.member_of('00000000-0000-0000-0000-0000000000c5') <> 4 then raise exception 'FAIL Cybersecurity worker should be in 4 channels'; end if;
  raise notice 'PASS department channels exist and each worker is in exactly their department''s channels';
end $$;
update worker_profiles set department_id = (select id from departments where slug='marketing') where user_id = '00000000-0000-0000-0000-0000000000f3';
do $$ begin if tst.member_of('00000000-0000-0000-0000-0000000000f3') <> 3 or exists (select 1 from chat_channel_members m join chat_channels c on c.id=m.channel_id where m.user_id='00000000-0000-0000-0000-0000000000f3' and c.name like 'Frontend%') then raise exception 'FAIL channels did not follow the move'; end if;
  raise notice 'PASS moving a worker moves their channel membership'; end $$;
update worker_profiles set department_id = (select id from departments where slug='frontend-development') where user_id = '00000000-0000-0000-0000-0000000000f3';
select tst.as_super();
update worker_profiles set status = 'suspended' where user_id = '00000000-0000-0000-0000-0000000000f3';
do $$ begin if tst.member_of('00000000-0000-0000-0000-0000000000f3') <> 0 then raise exception 'FAIL suspended worker kept channel access'; end if; raise notice 'PASS a suspended worker leaves every department channel'; end $$;
update worker_profiles set status = 'active' where user_id = '00000000-0000-0000-0000-0000000000f3';
do $$ begin if tst.member_of('00000000-0000-0000-0000-0000000000a1') <> 31 then raise exception 'FAIL Main Admin should be in all 31 channels, got %', tst.member_of('00000000-0000-0000-0000-0000000000a1'); end if; raise notice 'PASS the Main Admin is in every department channel'; end $$;

-- B. Meetings -------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into meetings (id, title, department_id, starts_at, ends_at, agenda) values ('60000000-0000-0000-0000-000000000001','Frontend stand-up',(select id from departments where slug='frontend-development'),'2026-11-02 10:00+00','2026-11-02 10:30+00','Blockers');
insert into meetings (id, title, starts_at, ends_at) values ('60000000-0000-0000-0000-000000000002','Private 1:1','2026-11-02 11:00+00','2026-11-02 11:30+00');
insert into meeting_participants (meeting_id, user_id) values ('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c5');
select tst.expect_error($$insert into meetings (title, starts_at, ends_at) values ('Backwards','2026-11-02 12:00+00','2026-11-02 11:00+00')$$, 'check', 'a meeting cannot end before it starts');
select tst.expect_error($$insert into meetings (title, department_id, starts_at, ends_at) values ('Other dept',(select id from departments where slug='cybersecurity'),'2026-11-02 12:00+00','2026-11-02 13:00+00')$$, 'row-level security', 'a worker cannot schedule a meeting for another department');
insert into meeting_action_items (meeting_id, body, assignee_id) values ('60000000-0000-0000-0000-000000000001','Fix flaky test','00000000-0000-0000-0000-0000000000f2');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from meetings$$, 1, 'a department colleague sees the department meeting but not a private one');
update meeting_action_items set done = true where body = 'Fix flaky test';
do $$ begin raise notice 'PASS an assignee can tick off their action item'; end $$;
select tst.expect_zero_rows($$update meetings set title = 'hijack'$$, 'a colleague cannot edit the meeting');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from meetings$$, 1, 'an invited participant from another department sees only the meeting they were invited to');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from meetings$$, 0, 'a client sees no meetings');
reset role;
do $$ begin
  if (select count(*) from notifications where title = 'Meeting invitation' and user_id = '00000000-0000-0000-0000-0000000000c5') <> 1 then raise exception 'FAIL invitee not notified'; end if;
  if (select count(*) from notifications where title = 'Action item from Frontend stand-up' and user_id = '00000000-0000-0000-0000-0000000000f2') <> 1 then raise exception 'FAIL action-item assignee not notified'; end if;
  if (select done_at from meeting_action_items limit 1) is null then raise exception 'FAIL done_at not stamped'; end if;
  raise notice 'PASS invitees and action-item assignees are notified, and completion is stamped';
end $$;

-- C. Knowledge base --------------------------------------------------------------------------------------------------------------------------------------
insert into knowledge_documents (title, category, department_id, body, author_id) values
 ('Code of conduct', 'Policies', null, 'Be kind.', '00000000-0000-0000-0000-0000000000a1'),
 ('Incident runbook', 'Security', (select id from departments where slug='cybersecurity'), 'Step 1', '00000000-0000-0000-0000-0000000000a1');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from knowledge_documents$$, 1, 'a worker reads company documents but not another department''s');
select tst.expect_error($$insert into knowledge_documents (title, category, body) values ('Mine','Company','x')$$, 'row-level security', 'a plain worker cannot publish documents');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into knowledge_documents (title, category, department_id, body) values ('Frontend standards','Development',(select id from departments where slug='frontend-development'),'Use TypeScript');
select tst.expect_error($$insert into knowledge_documents (title, category, body) values ('Company-wide from a dept admin','Company','x')$$, 'row-level security', 'a Department Admin cannot publish company-wide documents');
select tst.expect_error($$insert into knowledge_documents (title, category, department_id, body) values ('Elsewhere','Security',(select id from departments where slug='cybersecurity'),'x')$$, 'row-level security', 'a Department Admin cannot publish into another department');
select tst.expect_error($$insert into knowledge_documents (title, category, body, department_id) values ('Bad','Nonsense','x',(select id from departments where slug='frontend-development'))$$, 'check', 'categories are the company''s fixed list');
reset role;

-- D. Onboarding -----------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
insert into onboarding_progress (user_id, item_key) values ('00000000-0000-0000-0000-0000000000f2','company.read-handbook');
select tst.expect_error($$insert into onboarding_progress (user_id, item_key) values ('00000000-0000-0000-0000-0000000000f3','company.read-handbook')$$, 'row-level security', 'nobody can tick onboarding items for someone else');
select tst.as_user('00000000-0000-0000-0000-0000000000f3');
select tst.expect_count($$select 1 from onboarding_progress$$, 0, 'a colleague cannot read someone else''s onboarding');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_count($$select 1 from onboarding_progress$$, 1, 'a Department Admin can see their department member''s onboarding');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from onboarding_progress$$, 0, 'another department''s worker cannot');
reset role;

-- E. Department records ---------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
insert into department_records (id, department_id, kind, title, stage, fields) values ('70000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'bug','Login button misaligned','Reported','{"severity":"low"}');
select tst.expect_error($$insert into department_records (department_id, kind, title, stage) values ((select id from departments where slug='cybersecurity'),'bug','Sneaky','Reported')$$, 'row-level security', 'a worker cannot file records in another department');
select tst.expect_error($$insert into department_records (department_id, kind, title, stage, assignee_id) values ((select id from departments where slug='frontend-development'),'bug','Misassigned','Reported','00000000-0000-0000-0000-0000000000c5')$$, 'someone in that department', 'records can only be assigned within the department');
update department_records set stage = 'Triaged' where id = '70000000-0000-0000-0000-000000000001';
select tst.expect_error($$update department_records set kind = 'incident' where id = '70000000-0000-0000-0000-000000000001'$$, 'cannot change department, kind or author', 'a record cannot change kind');
select tst.as_user('00000000-0000-0000-0000-0000000000f3');
select tst.expect_count($$select 1 from department_records$$, 1, 'a colleague can read the department''s records');
select tst.expect_zero_rows($$update department_records set stage = 'Verified'$$, 'a colleague who neither filed nor owns a record cannot move it');
select tst.expect_zero_rows($$delete from department_records$$, 'a plain member cannot delete records');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from department_records$$, 0, 'another department cannot read the records');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
update department_records set stage = 'Fixed', assignee_id = '00000000-0000-0000-0000-0000000000f3' where id = '70000000-0000-0000-0000-000000000001';
do $$ begin raise notice 'PASS a Department Admin moves and assigns any record'; end $$;
reset role;
do $$ begin if (select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000f3' and title = 'Assigned to you') <> 1 then raise exception 'FAIL assignee not notified'; end if; raise notice 'PASS a newly assigned person is notified'; end $$;

-- F. Whiteboards -----------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
insert into whiteboards (id, department_id, title) values ('80000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'Login flow');
update whiteboards set data = '{"shapes":[{"id":"a"}]}', version = 2 where id = '80000000-0000-0000-0000-000000000001' and version = 1;
select tst.expect_error($$update whiteboards set data = '{"shapes":[]}', version = 2 where id = '80000000-0000-0000-0000-000000000001'$$, 'changed while you were editing', 'a stale save is refused rather than silently overwriting someone else');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from whiteboards$$, 0, 'another department cannot see the whiteboard');
reset role;

-- G. Integrations ---------------------------------------------------------------------------------------------------------------------------------------
select tst.as_super();
insert into integration_secrets (provider, secret) values ('github', 'ghp_example_not_real');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.secret_unreadable();
select tst.expect_error($$insert into integration_secrets (provider, secret) values ('figma','x')$$, 'permission denied', 'a browser session cannot write secrets either');
update integrations set status = 'connected', config = '{"url":"https://www.figma.com/files/team/1"}' where provider = 'figma';
do $$ begin raise notice 'PASS a Main Admin can configure a non-secret integration setting'; end $$;
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from integrations$$, 4, 'workers can see integration status');
select tst.expect_zero_rows($$update integrations set status = 'connected' where provider = 'github'$$, 'workers cannot change an integration');
reset role;
select tst.as_super();
insert into integration_repositories (full_name, department_id) values ('codex/web', (select id from departments where slug='frontend-development')), ('codex/infra', (select id from departments where slug='devops'));
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from integration_repositories$$, 1, 'a worker sees only repositories linked to their department');
select tst.expect_error($$insert into integration_repositories (full_name) values ('x/y')$$, 'row-level security', 'only a Main Admin links repositories');
reset role;

-- H. Task links -----------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
insert into task_links (task_id, kind, url, label) values ('30000000-0000-0000-0000-000000000001','pull_request','https://github.com/codex/web/pull/42','Auth UI');
select tst.expect_error($$insert into task_links (task_id, kind, url) values ('30000000-0000-0000-0000-000000000001','other','javascript:alert(1)')$$, 'check', 'only https links can be attached');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from task_links$$, 0, 'another department cannot see task links');
reset role;

-- I. Webhook inboxes ------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
insert into webhook_inboxes (id, department_id, name) values ('90000000-0000-0000-0000-000000000001',(select id from departments where slug='frontend-development'),'Stripe test');
select tst.expect_error($$insert into webhook_requests (inbox_id, method) values ('90000000-0000-0000-0000-000000000001','POST')$$, 'row-level security', 'a browser session cannot forge captured requests');
reset role;
select tst.as_super();
insert into webhook_requests (inbox_id, method, body) select '90000000-0000-0000-0000-000000000001', 'POST', 'n' || g from generate_series(1, 205) g;
do $$ begin if (select count(*) from webhook_requests) <> 200 then raise exception 'FAIL expected the inbox trimmed to 200, got %', (select count(*) from webhook_requests); end if; raise notice 'PASS an inbox keeps only its latest 200 requests'; end $$;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from webhook_requests$$, 200, 'department members see their inbox''s captured requests');
select tst.as_user('00000000-0000-0000-0000-0000000000c5');
select tst.expect_count($$select 1 from webhook_requests$$, 0, 'another department cannot see them');
reset role;

rollback;
