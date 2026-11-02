-- Behavioural tests for 20261006000000_github_app_and_activity.sql
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','be@x'), ('00000000-0000-0000-0000-0000000000f1','fe@x'), ('00000000-0000-0000-0000-0000000000f2','feadmin@x'), ('00000000-0000-0000-0000-0000000000b2','beadmin@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b2');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-G0000001',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-G0000002',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-G0000003',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-G0000004',(select id from departments where slug='backend-development'),'admin','active');

-- Re-apply the migration: the local harness re-grants EXECUTE on every function afterwards, real Supabase does not.
\ir ../migrations/20261006000000_github_app_and_activity.sql
create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.as_service() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', 'service_role', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then if sqlerrm like 'FAIL %' then raise; end if; if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if; raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated, service_role, anon; grant execute on all functions in schema tst to authenticated, service_role, anon;

-- Link two repositories as the Main Admin: one to Backend, one to Frontend.
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.integration_repositories (full_name, department_id) values
 ('codex/api', (select id from departments where slug='backend-development')),
 ('codex/web', (select id from departments where slug='frontend-development'));
reset role;

-- 1. Nobody but the service role can record deliveries or touch installations -----------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$select record_github_delivery('d-aaaaaaaa','push','', 'codex/api','recorded','', 'push','x','a',null,'pushed',now())$$, 'permission denied', 'even the Main Admin session cannot record a delivery directly');
select tst.expect_error($$select upsert_github_installation(1,'codex','Organization','all','created')$$, 'permission denied', 'a browser session cannot forge an installation');
select tst.expect_error($$select prune_github_data(30)$$, 'permission denied', 'a browser session cannot prune');
select tst.expect_error($$insert into public.github_activity (delivery_id, repo_full_name, kind, title, occurred_at) values ('x1x1x1x1','codex/api','push','t',now())$$, 'permission denied', 'a browser session cannot write the feed');
select tst.expect_error($$select * from public.github_webhook_deliveries$$, 'permission denied', 'the delivery log is unreadable from a browser');
reset role; set local role anon;
select tst.expect_error($$select * from public.github_activity$$, 'permission denied', 'anonymous visitors cannot read the feed');
reset role;

-- 2. Recording, replay protection, unlinked repositories ------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.expect_true(record_github_delivery('11111111-aaaa','push','', 'codex/api','recorded','', 'push','2 commits pushed to main','amy','https://github.com/codex/api/compare/a...b','pushed','2026-10-30T10:00:00Z') = 'recorded', 'a first delivery is recorded');
select tst.expect_true(record_github_delivery('11111111-aaaa','push','', 'codex/api','recorded','', 'push','2 commits pushed to main','amy',null,'pushed',now()) = 'duplicate', 'the same delivery id is a duplicate');
select tst.expect_count($$select 1 from public.github_activity where repo_full_name='codex/api'$$, 1, 'a replay does not add a second feed row');
select tst.expect_true(record_github_delivery('22222222-bbbb','workflow_run','completed','codex/web','recorded','', 'workflow_run','CI on main','bo',null,'failure',now()) = 'recorded', 'a frontend event is recorded');
select tst.expect_true(record_github_delivery('33333333-cccc','push','', 'codex/not-linked','recorded','', 'push','x','amy',null,'pushed',now()) = 'ignored', 'a repository nobody linked produces no feed row');
select tst.expect_count($$select 1 from public.github_activity where repo_full_name='codex/not-linked'$$, 0, 'and nothing is stored for it');
select tst.expect_true((select outcome from public.github_webhook_deliveries where delivery_id='33333333-cccc') = 'ignored', 'the delivery log says why it was ignored');
select tst.expect_true(record_github_delivery('44444444-dddd','ping','', null,'ignored','ping') = 'ignored', 'a ping is logged as ignored');
select tst.expect_error($$select record_github_delivery('55555555-eeee','push','', 'codex/api','recorded','', 'push','x','amy','https://evil.example/x','pushed',now())$$, 'violates check constraint', 'a feed link outside github.com is refused by the database');
select tst.expect_error($$select record_github_delivery('bad id; drop','push','', 'codex/api','ignored','')$$, 'violates check constraint', 'a malformed delivery id is refused');
reset role;

-- 2b. A failed build tells the owning department's admins and the Main Admin, once ---------------------------------------------------------
select tst.expect_count($$select 1 from public.notifications where title='Build failed'$$, 2, 'the failed Frontend build notified exactly two people');
select tst.expect_true(exists (select 1 from public.notifications where title='Build failed' and user_id='00000000-0000-0000-0000-0000000000f2'), 'the Frontend admin was told');
select tst.expect_true(exists (select 1 from public.notifications where title='Build failed' and user_id='00000000-0000-0000-0000-0000000000a1'), 'the Main Admin was told');
select tst.expect_true(not exists (select 1 from public.notifications where title='Build failed' and user_id in ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000f1')), 'the Backend admin and a plain Frontend member were not');
set local role service_role; select tst.as_service();
select record_github_delivery('22222222-bbbb','workflow_run','completed','codex/web','recorded','', 'workflow_run','CI on main','bo',null,'failure',now());
select record_github_delivery('66666666-ffff','workflow_run','completed','codex/web','recorded','', 'workflow_run','CI on dev','bo',null,'success',now());
reset role;
select tst.expect_count($$select 1 from public.notifications where title='Build failed'$$, 2, 'a replayed failure does not notify again, and a success never does');

-- 3. Feed visibility mirrors repository visibility --------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from public.github_activity$$, 1, 'a Backend worker sees only the Backend repository activity');
select tst.expect_true((select repo_full_name from public.github_activity limit 1) = 'codex/api', 'and it is the right repository');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_count($$select 1 from public.github_activity$$, 2, 'a Frontend worker sees only the Frontend repository activity');
select tst.expect_true((select repo_full_name from public.github_activity limit 1) = 'codex/web', 'and it is the right repository');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from public.github_activity$$, 0, 'a client sees no development activity');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from public.github_activity$$, 3, 'the Main Admin sees all linked repositories');
-- Unlinking a repository hides its history from everyone but nothing else changes.
delete from public.integration_repositories where full_name = 'codex/web';
select tst.expect_count($$select 1 from public.github_activity$$, 1, 'unlinking a repository removes its activity from view');
reset role;

-- 4. Installations ----------------------------------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select upsert_github_installation(900, 'codex', 'Organization', 'selected', 'created');
select tst.expect_true((select repository_selection from public.github_installations where installation_id=900) = 'selected', 'an installation is recorded');
select upsert_github_installation(900, '', '', '', 'suspend');
select tst.expect_true((select suspended and account_login='codex' from public.github_installations where installation_id=900), 'suspending keeps the known account name');
select upsert_github_installation(900, '', '', '', 'unsuspend');
select tst.expect_true((select not suspended from public.github_installations where installation_id=900), 'unsuspending clears it');
select upsert_github_installation(900, '', '', '', 'deleted');
select tst.expect_true((select removed from public.github_installations where installation_id=900), 'a removed installation is flagged');
select upsert_github_installation(900, '', '', 'bogus', 'created');
select tst.expect_true((select repository_selection = 'selected' and not removed from public.github_installations where installation_id=900), 'an unknown selection value never overwrites, and re-creating revives it');
reset role;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from public.github_installations$$, 0, 'workers cannot see installations');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from public.github_installations$$, 1, 'the Main Admin can');
reset role;

-- 5. Retention --------------------------------------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.expect_error($$select prune_github_data(1)$$, 'at least 7 days', 'pruning refuses a window under a week');
update public.github_webhook_deliveries set received_at = now() - interval '200 days' where delivery_id = '11111111-aaaa';
select tst.expect_true(prune_github_data(90) = 1, 'one old delivery is pruned');
select tst.expect_count($$select 1 from public.github_activity where repo_full_name='codex/api'$$, 0, 'its feed row goes with it');
select tst.expect_count($$select 1 from public.github_activity where repo_full_name='codex/web'$$, 2, 'recent rows stay');
reset role;
rollback;
