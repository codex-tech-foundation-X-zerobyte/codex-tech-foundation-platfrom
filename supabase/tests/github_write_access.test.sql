-- Behavioural tests for 20261007000000_github_write_access.sql
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','be@x'), ('00000000-0000-0000-0000-0000000000b2','beadmin@x'),
 ('00000000-0000-0000-0000-0000000000f1','fe@x'), ('00000000-0000-0000-0000-0000000000f2','feadmin@x'), ('00000000-0000-0000-0000-0000000000c1','client@x'),
 ('00000000-0000-0000-0000-0000000000d1','projowner@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000d1');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-W0000001',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-W0000002',(select id from departments where slug='backend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-W0000003',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-W0000004',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000d1','CTF-WKR-W0000005',(select id from departments where slug='devops'),'member','active');
insert into public.projects (id, name, owner_id) values ('00000000-0000-0000-0000-00000000aa01','Side project','00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-00000000aa02','Client-owned project','00000000-0000-0000-0000-0000000000c1');

\ir ../migrations/20261007000000_github_write_access.sql
create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.as_service() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', 'service_role', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then if sqlerrm like 'FAIL %' then raise; end if; if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if; raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated, service_role, anon; grant execute on all functions in schema tst to authenticated, service_role, anon;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.integration_repositories (full_name, department_id) values ('codex/api', (select id from departments where slug='backend-development')), ('codex/web', (select id from departments where slug='frontend-development'));
insert into public.integration_repositories (full_name, project_id) values ('codex/side', '00000000-0000-0000-0000-00000000aa01'), ('codex/clientrepo', '00000000-0000-0000-0000-00000000aa02');
reset role;

-- 1. Everything is OFF by default, for everyone including the Main Admin -----------------------------------------------------------------------
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_true(not github_can('codex/api','comment') and not github_can('codex/api','issue'), 'with no policy, even the Main Admin cannot write');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(not github_can('codex/api','comment'), 'a Backend member cannot write by default');

-- 2. Only the Main Admin sets the policy, and only validly --------------------------------------------------------------------------------------
select tst.expect_error($$select set_github_repo_policy('codex/api','members','members')$$, 'Only the Main Admin', 'a worker cannot change write access');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$select set_github_repo_policy('codex/api','members','members')$$, 'Only the Main Admin', 'not even a department admin can');
select tst.expect_count($$select 1 from public.github_repo_policy$$, 0, 'the policy table is invisible to a department admin');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$select set_github_repo_policy('codex/api','everyone','off')$$, 'Unknown access level', 'an unknown level is refused');
select tst.expect_error($$select set_github_repo_policy('codex/ghost','members','off')$$, 'not linked', 'an unlinked repository is refused');

-- 3. admins level -------------------------------------------------------------------------------------------------------------------------------
select set_github_repo_policy('codex/api','admins','off');
select tst.expect_true(github_can('codex/api','comment'), 'admins level: the Main Admin may comment');
select tst.expect_true(not github_can('codex/api','issue'), 'but issue creation is a separate switch and still off');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_true(github_can('codex/api','comment'), 'admins level: the repository department admin may comment');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(not github_can('codex/api','comment'), 'admins level: an ordinary member may not');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_true(not github_can('codex/api','comment'), 'admins level: another department''s admin may not (and cannot even see the repo)');

-- 4. members level ------------------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_github_repo_policy('codex/api','members','members');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(github_can('codex/api','comment') and github_can('codex/api','issue'), 'members level: a Backend member may comment and open issues');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_true(not github_can('codex/api','comment'), 'members level: a Frontend member still cannot (the repository is not theirs)');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_true(not github_can('codex/api','comment'), 'a client can never write');
select tst.expect_true(not github_can('codex/api','nonsense'), 'an unknown capability is refused');
select tst.expect_true(not github_can('codex/ghost','comment'), 'an unlinked repository is refused');
select tst.expect_true(github_capabilities('codex/api') = '{"comment": false, "issue": false}'::jsonb, 'capabilities report false for a client');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(github_capabilities('codex/api') = '{"comment": true, "issue": true}'::jsonb, 'capabilities report true for the Backend member');

-- 5. The kill switch ----------------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_github_repo_policy('codex/api','off','off');
select tst.expect_true(not github_can('codex/api','comment'), 'turning a repository off stops the Main Admin too');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true(not github_can('codex/api','comment'), 'and everyone else');

-- 6. A project-linked repository: its owner is its "admin" ----------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_github_repo_policy('codex/side','admins','off');
select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_true(github_can('codex/side','comment'), 'the project owner may comment on the project repository');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_true(not github_can('codex/side','comment'), 'an unrelated department admin may not');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_true((select count(*) from public.audit_logs where action='github.policy') >= 4, 'each policy change is audited');
reset role;

-- 6b. Defence in depth: a client who CAN see a repository (they own a linked project) still can never write, at any level.
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select set_github_repo_policy('codex/clientrepo','members','members');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from public.integration_repositories where full_name='codex/clientrepo'$$, 1, 'the client can see the repository they own the project of');
select tst.expect_true(not github_can('codex/clientrepo','comment') and not github_can('codex/clientrepo','issue'), 'yet a client still cannot comment or open issues, even at the members level');
reset role;

-- 7. begin / finish: replay, rate limit, denial, audit ------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select begin_github_action('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b1','codex/api','comment',5)$$, 'permission denied', 'a browser session cannot begin an action itself');
select tst.expect_error($$select finish_github_action('11111111-1111-1111-1111-111111111111','success','', null)$$, 'permission denied', 'nor finish one');
select tst.expect_error($$insert into public.github_actions (request_id, actor_id, repo_full_name, action) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','codex/api','comment')$$, 'permission denied', 'nor write the audit table');
reset role;
set local role service_role; select tst.as_service();
select tst.expect_true(begin_github_action('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b1','codex/api','comment',5) = 'ok', 'a first request begins');
select tst.expect_true(begin_github_action('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b1','codex/api','comment',5) = 'duplicate', 'the same request id is a duplicate (double click or retry)');
select tst.expect_true(finish_github_action('11111111-1111-1111-1111-111111111111','success','', 'https://github.com/codex/api/issues/5#c1'), 'it finishes once');
select tst.expect_true(not finish_github_action('11111111-1111-1111-1111-111111111111','failed','late',null), 'a finished action cannot be rewritten');
select tst.expect_true((select outcome from public.github_actions where request_id='11111111-1111-1111-1111-111111111111') = 'success', 'the outcome stays success');
select tst.expect_count($$select 1 from public.audit_logs where action='github.comment'$$, 1, 'success is also written to the workspace audit log, once');
select tst.expect_error($$select finish_github_action('11111111-1111-1111-1111-111111111111','maybe','',null)$$, 'Bad outcome', 'an invalid outcome is refused');
select tst.expect_true(begin_github_action('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','codex/api','create_issue',null,true) = 'denied', 'a denied attempt is logged');
select tst.expect_true((select outcome from public.github_actions where request_id='22222222-2222-2222-2222-222222222222') = 'denied', 'as denied');
select tst.expect_true(begin_github_action('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','codex/api','create_issue',null,true) = 'denied', 'repeating a denial is harmless');
select tst.expect_error($$select begin_github_action(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','codex/api','merge',1)$$, 'violates check constraint', 'an action type the database does not know is refused');
-- Rate limit: 19 more real requests are fine (the first one counts), the 21st is refused; denials never count.
do $$ declare i int; r text; begin
  for i in 1..19 loop r := begin_github_action(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','codex/api','comment',i); if r <> 'ok' then raise exception 'FAIL request % was %', i, r; end if; end loop;
  r := begin_github_action(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','codex/api','comment',99);
  if r <> 'rate_limited' then raise exception 'FAIL the 21st request in ten minutes was %', r; end if;
  raise notice 'PASS the 21st request in ten minutes is rate limited';
  r := begin_github_action(gen_random_uuid(),'00000000-0000-0000-0000-0000000000f1','codex/web','comment',1);
  if r <> 'ok' then raise exception 'FAIL the limit is per person, got %', r; end if;
  raise notice 'PASS the limit is per person';
end $$;
-- A request that never got an answer is closed as failed, not left pending.
select tst.expect_true((select count(*) from public.github_actions where outcome='pending') >= 1, 'unfinished requests are pending');
update public.github_actions set created_at = now() - interval '30 minutes' where outcome = 'pending';
select tst.expect_true(expire_github_actions() >= 1, 'stale pending requests are expired');
select tst.expect_count($$select 1 from public.github_actions where outcome='pending'$$, 0, 'none remain pending');
reset role;

-- 8. Who can read the audit trail ---------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_true((select count(*) from public.github_actions) > 20, 'the Main Admin sees every action');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_true((select count(*) from public.github_actions where actor_id <> '00000000-0000-0000-0000-0000000000b1') = 0 and (select count(*) from public.github_actions) > 0, 'a worker sees only their own actions');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_count($$select 1 from public.github_actions where actor_id = '00000000-0000-0000-0000-0000000000b1'$$, 0, 'a department admin does not see other people''s actions');
reset role;

-- 9. Unlinking a repository removes its policy --------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
delete from public.integration_repositories where full_name = 'codex/side';
select tst.expect_count($$select 1 from public.github_repo_policy where repo_full_name='codex/side'$$, 0, 'unlinking removes the write policy, so relinking starts from off');
reset role;
rollback;
