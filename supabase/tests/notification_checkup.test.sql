-- Behavioural tests for 20261003000003: the notification checkup (all migrations applied; rolled back)
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1','u1@x'), ('00000000-0000-0000-0000-0000000000b2','u2@x');
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
\ir ../migrations/20261003000003_notification_checkup.sql

create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;
create temp table ids (k text primary key, v uuid); grant all on ids to authenticated;
create function tst.id(k text) returns uuid language sql as $$ select v from ids where k = $1 $$; grant execute on function tst.id(text) to authenticated;
create temp table out (k text primary key, j jsonb); grant all on out to authenticated;

-- ══ push not configured at all ═══════════════════════════════════════════════════════════════════════════════
delete from public.push_settings;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'n0', send_test_notification();
select tst.expect_true((select kind = 'test' and user_id = auth.uid() from notifications where id = tst.id('n0')), 'a test notification is a real notification row, of kind "test", for me only');
insert into out select 'r0', push_dispatch_result(tst.id('n0'));
select tst.expect_true((select (j ->> 'handed_over')::boolean = false and (j ->> 'configured')::boolean = false from out where k = 'r0'), 'with no push_settings row the result says the database was never told where to send (not configured)');
select tst.expect_error($$select send_test_notification()$$, 'Wait a few seconds', 'tests cannot be fired back to back');
insert into out select 's0', push_setup_summary();
select tst.expect_true((select (j ->> 'configured')::boolean = false and (j ->> 'devices')::int = 0 from out where k = 's0'), 'the summary says not configured, no devices');
reset role;

-- ══ configured, but the database cannot make the call (pg_net missing / bad settings) ════════════════════════════
insert into public.push_settings (function_url, webhook_secret) values ('https://abc.supabase.co/functions/v1/push-dispatch', 'super-secret-value-123456');
update public.notifications set created_at = now() - interval '1 minute' where kind = 'test';
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'n1', send_test_notification();
insert into out select 'r1', push_dispatch_result(tst.id('n1'));
select tst.expect_true((select (j ->> 'handed_over')::boolean = false and (j ->> 'error') is not null from out where k = 'r1'), 'when the database cannot hand the call over, the reason is kept and shown');
select tst.expect_true((select position('super-secret' in j::text) = 0 from out where k = 'r1'), 'and it never contains the secret');
insert into out select 's1', push_setup_summary();
select tst.expect_true((select (j ->> 'configured')::boolean and (j ->> 'secret_set')::boolean and (j ->> 'function_host') = 'abc.supabase.co' and (j ->> 'function_path_ok')::boolean and position('super-secret' in j::text) = 0 from out where k = 's1'), 'the summary reports configuration without ever revealing the secret');
reset role;

-- ══ pg_net present and the function answered (stand-in for the real extension) ════════════════════════════════
create schema net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 4242::bigint $$;
create table net._http_response (id bigint, status_code int, content text, error_msg text, created timestamptz default now());
update public.notifications set created_at = now() - interval '1 minute' where kind = 'test';
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'n2', send_test_notification();
insert into out select 'r2a', push_dispatch_result(tst.id('n2'));
select tst.expect_true((select (j ->> 'handed_over')::boolean and (j ->> 'answered')::boolean = false from out where k = 'r2a'), 'handed over but not answered yet: the result says so (it can take a few seconds)');
reset role;
insert into net._http_response (id, status_code, content) values (4242, 403, '{"error":"Forbidden"}');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into out select 'r2b', push_dispatch_result(tst.id('n2'));
select tst.expect_true((select (j ->> 'answered')::boolean and (j ->> 'status_code')::int = 403 and (j ->> 'content') like '%Forbidden%' from out where k = 'r2b'), 'once the function answers, its status and message are shown');
-- who can see it
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$select push_dispatch_result(tst.id('n2'))$$, 'not yours', 'someone else cannot read my test result');
reset role;
select tst.expect_true(not has_function_privilege('anon', 'public.send_test_notification()', 'execute') and not has_function_privilege('anon', 'public.push_dispatch_result(uuid)', 'execute') and not has_function_privilege('anon', 'public.push_setup_summary()', 'execute'), 'signed-out visitors can run none of the checkup functions');
select tst.expect_true(not exists (select 1 from pg_class c where c.relname = 'push_dispatch_log' and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))), 'the dispatch log is closed to everyone but the system');

-- ══ real events are logged too, and never fail the original insert ═══════════════════════════════════════════════
insert into public.notifications (user_id, title, body) values ('00000000-0000-0000-0000-0000000000b2', 'A task was assigned', 'Fix the login page');
select tst.expect_true((select count(*) from push_dispatch_log where source_table = 'notifications') = 3, 'every hand-off for a notification is logged (test or not)');
select tst.expect_true(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and title = 'A task was assigned'), 'and the notification itself was saved');
-- a bad function_url inside pg_net must not stop notifications from being created
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as $$ begin raise exception 'simulated pg_net failure'; end $$;
insert into public.notifications (user_id, title, body) values ('00000000-0000-0000-0000-0000000000b2', 'Second one', 'still saved');
select tst.expect_true(exists (select 1 from notifications where title = 'Second one') and exists (select 1 from push_dispatch_log where error like '%simulated pg_net failure%'), 'a failing hand-off never blocks the notification, and its reason is logged');

rollback;
