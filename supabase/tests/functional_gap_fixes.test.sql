-- Behavioural RLS tests for migration 20260923000000_functional_gap_fixes.sql
-- Run against a database that has ALL migrations applied, as a superuser (it uses SET ROLE + a rolled-back transaction):
--   psql "$DATABASE_URL" -f supabase/tests/functional_gap_fixes.test.sql
-- Each check prints NOTICE: PASS ...; any failure raises an exception. Nothing is committed.

\set ON_ERROR_STOP on
begin;
-- ---------- fixtures (superuser bypasses RLS) ----------
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x'), ('00000000-0000-0000-0000-0000000000b1','worker1@x'), ('00000000-0000-0000-0000-0000000000b2','worker2@x'),
 ('00000000-0000-0000-0000-0000000000c1','client1@x'), ('00000000-0000-0000-0000-0000000000c2','client2@x');
update public.profiles set role='superadmin', display_name='Admin'   where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker',     display_name='Worker One' where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set role='worker',     display_name='Worker Two' where id='00000000-0000-0000-0000-0000000000b2';
update public.profiles set role='client',     display_name='Client One' where id='00000000-0000-0000-0000-0000000000c1';
update public.profiles set role='client',     display_name='Client Two' where id='00000000-0000-0000-0000-0000000000c2';
insert into public.clients (id, organization) values ('10000000-0000-0000-0000-00000000000a','Acme'),('10000000-0000-0000-0000-00000000000b','Globex');
insert into public.client_users (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-0000000000c2','10000000-0000-0000-0000-00000000000b');
insert into public.projects (id, name, owner_id, client_account_id) values
 ('20000000-0000-0000-0000-000000000001','Acme site','00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000a'),
 ('20000000-0000-0000-0000-000000000002','Globex app','00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b'),
 ('20000000-0000-0000-0000-000000000003','Acme via link only','00000000-0000-0000-0000-0000000000b1',null);
insert into public.client_projects (client_id, project_id) values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000003');
insert into public.project_updates (project_id, title, body, published_at) values
 ('20000000-0000-0000-0000-000000000001','Published update','x', now()),
 ('20000000-0000-0000-0000-000000000001','DRAFT update','x', null);
insert into public.project_milestones (project_id, title) values ('20000000-0000-0000-0000-000000000001','Kickoff'),('20000000-0000-0000-0000-000000000002','Globex kickoff');
insert into public.calls (id, caller_id, callee_id, type) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','voice');

create schema tst;
create function tst.as_user(u text) returns void language plpgsql as $$ begin
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u, true); end $$;
create function tst.as_super() returns void language plpgsql as $$ begin
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function tst.check(name text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
grant usage on schema tst to authenticated;

\set c1 '00000000-0000-0000-0000-0000000000c1'
\set c2 '00000000-0000-0000-0000-0000000000c2'
\set w1 '00000000-0000-0000-0000-0000000000b1'
\set w2 '00000000-0000-0000-0000-0000000000b2'

-- ---------- 1. client sees exactly their projects ----------
select tst.as_user(:'c1');
select tst.check('client1 sees own account project + link-only project (2 rows)', (select count(*) from public.projects) = 2);
select tst.check('client1 does NOT see Globex project', (select count(*) from public.projects where name='Globex app') = 0);
select tst.check('my_client_projects() returns 2', (select count(*) from public.my_client_projects()) = 2);
-- ---------- 3/4. milestones + updates ----------
select tst.check('client1 sees own milestone only', (select count(*) from public.project_milestones) = 1);
select tst.check('client1 sees ONLY published update (no draft)', (select count(*) from public.project_updates) = 1 and (select title from public.project_updates) = 'Published update');
select tst.as_super(); select tst.as_user(:'w1');
select tst.check('worker sees both updates incl. draft', (select count(*) from public.project_updates) = 2);

-- ---------- 2. requests ----------
select tst.as_super(); select tst.as_user(:'c1');
insert into public.project_requests (project_id, title, body, kind, priority, status) values ('20000000-0000-0000-0000-000000000001','Add pricing page','please','change','high','approved');
select tst.check('client request inserted; requester_id auto-set', (select requester_id::text from public.project_requests where title='Add pricing page') = :'c1');
select tst.check('client cannot self-approve: status forced to open', (select status from public.project_requests where title='Add pricing page') = 'open');
select tst.check('client can read own request', (select count(*) from public.project_requests) = 1);
do $$ begin
  begin insert into public.project_requests (project_id, title, body) values ('20000000-0000-0000-0000-000000000002','sneaky','x'); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege or check_violation then raise notice 'PASS  client1 cannot file a request on Globexs project'; when others then
    if sqlerrm like '%row-level security%' then raise notice 'PASS  client1 cannot file a request on Globexs project'; else raise; end if; end; end $$;
do $$ declare n int; begin
  update public.project_requests set status='approved' where title='Add pricing page'; get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  client cannot update request status (0 rows)'; else raise exception 'FAIL client updated status'; end if; end $$;
select tst.as_super(); select tst.as_user(:'c2');
select tst.check('client2 cannot see client1 request', (select count(*) from public.project_requests) = 0);
select tst.as_super(); select tst.as_user(:'w1');
select tst.check('worker sees the request', (select count(*) from public.project_requests) = 1);
update public.project_requests set status='in_review';
select tst.check('worker can triage (status -> in_review)', (select status from public.project_requests) = 'in_review');
do $$ begin
  update public.project_requests set project_id='20000000-0000-0000-0000-000000000002';
  if (select project_id from public.project_requests)::text = '20000000-0000-0000-0000-000000000001' then raise notice 'PASS  project_id is immutable'; else raise exception 'FAIL project_id changed'; end if; end $$;

-- ---------- 5. staff directory ----------
select tst.as_super(); select tst.as_user(:'w1');
select tst.check('worker can read other staff names (>=3 staff rows)', (select count(*) from public.profiles) >= 3);
select tst.check('worker cannot read client profiles', (select count(*) from public.profiles where role='client') = 0);
select tst.as_super(); select tst.as_user(:'c1');
select tst.check('client only sees own profile', (select count(*) from public.profiles) = 1);

-- ---------- 6. calls guard ----------
select tst.as_super(); select tst.as_user(:'w1');   -- caller
do $$ begin
  begin update public.calls set callee_id = '00000000-0000-0000-0000-0000000000c1'; raise exception 'NOT BLOCKED';
  exception when others then if sqlerrm like '%immutable%' or sqlerrm like '%cannot be changed%' then raise notice 'PASS  cannot rewrite callee_id'; else raise; end if; end; end $$;
do $$ begin
  begin update public.calls set status='accepted'; raise exception 'NOT BLOCKED';
  exception when others then if sqlerrm like '%Only the person being called%' then raise notice 'PASS  caller cannot accept own call'; else raise; end if; end; end $$;
select tst.as_super(); select tst.as_user(:'w2');   -- callee
update public.calls set status='accepted', answered_at=now();
select tst.check('callee can accept', (select status from public.calls) = 'accepted');
update public.calls set status='ended', ended_at=now();
select tst.check('either side can end an accepted call', (select status from public.calls) = 'ended');
update public.calls set status='ringing';
select tst.check('finished call cannot be reopened (status stays ended)', (select status from public.calls) = 'ended');
rollback;
