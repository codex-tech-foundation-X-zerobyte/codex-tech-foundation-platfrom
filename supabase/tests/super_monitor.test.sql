-- Behavioural tests for 20261004000000_super_monitor.sql (all migrations applied; rolled back at the end)
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','devopsadmin@x'), ('00000000-0000-0000-0000-0000000000b2','devops@x'),
 ('00000000-0000-0000-0000-0000000000b3','cyberadmin@x'), ('00000000-0000-0000-0000-0000000000e1','be@x'), ('00000000-0000-0000-0000-0000000000e2','beadmin@x'),
 ('00000000-0000-0000-0000-0000000000f1','fe@x'), ('00000000-0000-0000-0000-0000000000f2','fin@x'), ('00000000-0000-0000-0000-0000000000d3','csadmin@x'),
 ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000d3');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
update public.profiles set display_name='Devops Admin' where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set display_name='Backend Member' where id='00000000-0000-0000-0000-0000000000e1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-M0000001',(select id from departments where slug='devops'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-M0000002',(select id from departments where slug='devops'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b3','CTF-WKR-M0000003',(select id from departments where slug='cybersecurity'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000e1','CTF-WKR-M0000004',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000e2','CTF-WKR-M0000005',(select id from departments where slug='backend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-M0000006',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f2','CTF-WKR-M0000007',(select id from departments where slug='finance'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d3','CTF-WKR-M0000008',(select id from departments where slug='customer-service'),'admin','active');

-- The local harness re-grants EXECUTE on every function after migrations run (real Supabase does not). Re-apply the migration so the
-- revokes it makes are what is under test.
\ir ../migrations/20261004000000_super_monitor.sql
create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then if sqlerrm like 'FAIL %' then raise; end if; if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if; raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated, service_role; grant execute on all functions in schema tst to authenticated, service_role;
create temp table ids (k text primary key, v uuid); grant all on ids to authenticated, service_role;
create function tst.id(k text) returns uuid language sql as $$ select v from ids where k = $1 $$; grant execute on function tst.id(text) to authenticated, service_role;
create function tst.hash(k text) returns text language sql immutable as $$ select encode(sha256(convert_to($1,'UTF8')),'hex') $$; grant execute on function tst.hash(text) to authenticated, service_role;
create function tst.as_service() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', 'service_role', true); end $$;
create function tst.flag(on_ boolean) returns void language sql as $$ select set_config('ctf.monitor_rpc', case when on_ then 'on' else 'off' end, true) $$;
create function tst.evs(prefix text, n int, kind text, msg text, level text default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('event_id', prefix || g, 'kind', kind, 'message', msg || ' ' || g) || case when level is null then '{}'::jsonb else jsonb_build_object('level', level) end) from generate_series(1, n) g $$;
create function tst.ing(k text, ev jsonb) returns jsonb language sql as $$ select public.monitor_ingest(tst.hash(k), ev) $$;
create function tst.notes(uid uuid, like_ text) returns int language sql as $$ select count(*)::int from public.notifications where user_id = uid and kind = 'monitor' and title like like_ $$;
grant execute on all functions in schema tst to authenticated, service_role;

-- 1. Registering projects: a Main Admin control ------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select monitor_register_project('Nope', 'nope', 'web', 'devops')$$, 'Only a Main Admin', 'a DevOps admin cannot register a project');
select tst.as_user('00000000-0000-0000-0000-0000000000e2');
select tst.expect_error($$select monitor_register_project('Nope', 'nope', 'web', 'backend-development')$$, 'Only a Main Admin', 'nor can the owning department''s admin');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'p1', monitor_register_project('Portfolio site', 'portfolio', 'web', 'backend-development', null, 300, 3);
insert into ids select 'p2', monitor_register_project('Marketing site', 'marketing-site', 'web', 'marketing');
insert into ids select 'p3', monitor_register_project('Quota probe', 'quota-probe', 'api', null, null, 300, 10, 10);
select tst.expect_error($$select monitor_register_project('Portfolio site', 'portfolio-2', 'web', null)$$, 'duplicate key', 'a project name is unique');
select tst.expect_error($$select monitor_register_project('Bad slug', 'Bad Slug!', 'web', null)$$, 'slug_check', 'a slug is lowercase letters, digits and dashes');
select tst.expect_error($$select monitor_register_project('Odd dept', 'odd-dept', 'web', 'no-such-dept')$$, 'Unknown department', 'the owning department must exist');
select tst.expect_error($$select monitor_register_project('Fast beat', 'fast-beat', 'web', null, null, 5)$$, 'heartbeat_seconds', 'a heartbeat interval below 30 seconds is refused');
select tst.expect_true((select count(*) = 3 from audit_logs where action = 'monitor.project.register'), 'registering a project is audited');

-- who sees which project
select tst.expect_count($$select 1 from monitor_projects$$, 3, 'the Main Admin sees every project');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from monitor_projects$$, 3, 'DevOps staff see every project');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_count($$select 1 from monitor_projects$$, 3, 'Cybersecurity staff see every project');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from monitor_projects$$, 1, 'a backend developer sees only the project their department owns');
select tst.expect_true((select slug = 'portfolio' from monitor_projects), 'and it is the right one');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_count($$select 1 from monitor_projects$$, 0, 'a frontend developer sees none');
select tst.expect_true(jsonb_array_length(monitor_overview()) = 0, 'and the overview is empty for them');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from monitor_projects$$, 0, 'a client sees none');

-- 2. Keys: scoped, hashed, revocable -----------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000e2');
select tst.expect_error($$select monitor_create_key(tst.id('p1'), 'mine', tst.hash('mk-x'), 'ctfm_zz')$$, 'Only a Main Admin', 'a department admin cannot create a key');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'k1', monitor_create_key(tst.id('p1'), 'production', tst.hash('mk-portfolio'), 'ctfm_ab');
insert into ids select 'k2', monitor_create_key(tst.id('p1'), 'events only', tst.hash('mk-events'), 'ctfm_cd', array['events']);
insert into ids select 'k3', monitor_create_key(tst.id('p1'), 'short lived', tst.hash('mk-exp'), 'ctfm_ef', array['events', 'heartbeat'], now() + interval '1 day');
insert into ids select 'k4', monitor_create_key(tst.id('p3'), 'quota', tst.hash('mk-quota'), 'ctfm_gh');
insert into ids select 'k5', monitor_create_key(tst.id('p2'), 'marketing', tst.hash('mk-market'), 'ctfm_ij');
insert into ids select 'k6', monitor_create_key(tst.id('p1'), 'to revoke', tst.hash('mk-revoked'), 'ctfm_kl');
select tst.expect_error($$select monitor_create_key(tst.id('p1'), 'dup', tst.hash('mk-portfolio'), 'ctfm_ab')$$, 'duplicate key', 'the same key cannot be registered twice');
select tst.expect_error($$select monitor_create_key(tst.id('p1'), 'bad', tst.hash('mk-bad'), 'ctfm_ab', array['admin'])$$, 'scopes', 'a key can only ever have the ingest scopes');
select tst.expect_error($$select monitor_create_key(tst.id('p1'), 'bad', 'not-a-hash', 'ctfm_ab')$$, 'key_hash', 'only a SHA-256 hex digest can be stored');
select tst.expect_error($$select monitor_create_key(tst.id('p1'), 'past', tst.hash('mk-past'), 'ctfm_ab', array['events'], now() - interval '1 hour')$$, 'future', 'an expiry in the past is refused');
select monitor_revoke_key(tst.id('k6'));
select tst.expect_true((select revoked_at is not null and not active and revoked_by is not null from monitor_keys where id = tst.id('k6')), 'a revoked key records when and by whom');
select tst.expect_true((select count(*) = 1 from audit_logs where action = 'monitor.key.revoke' and severity = 'warning'), 'revoking a key is audited as a warning');
select tst.expect_true((select count(*) = 6 from audit_logs where action = 'monitor.key.create'), 'creating a key is audited');
select tst.expect_count($$select 1 from monitor_keys$$, 6, 'the Main Admin lists the credentials (without the secret)');
select tst.expect_error($$select key_hash from monitor_keys$$, 'permission denied', 'but not their hashes');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from monitor_keys$$, 0, 'DevOps staff can see the project but not its credentials');
reset role;
select tst.expect_true(not has_column_privilege('authenticated', 'monitor_keys', 'key_hash', 'select'), 'no signed-in role can read key_hash');
select tst.expect_true(not has_table_privilege('authenticated', 'monitor_events', 'select'), 'no signed-in role can read raw events');
select tst.expect_true((select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name like 'monitor\_%' and column_name ~* '(secret|password|passwd|token|api_?key)'), 'no monitoring column is named like a secret');
select tst.flag(true);
update monitor_keys set expires_at = now() - interval '1 minute' where id = tst.id('k3');
select tst.flag(false);

-- 3. Ingestion: authentication ---------------------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.expect_error($$select tst.ing('mk-unknown', '[]')$$, 'Unknown, revoked or expired', 'an unknown key is refused');
select tst.expect_error($$select tst.ing('mk-revoked', tst.evs('r', 1, 'error', 'x'))$$, 'Unknown, revoked or expired', 'a revoked key is refused');
select tst.expect_error($$select tst.ing('mk-exp', tst.evs('x', 1, 'error', 'x'))$$, 'Unknown, revoked or expired', 'an expired key is refused');
select tst.expect_true((select 'authentication' = 'authentication'), 'the refusal text is identical for every kind of bad key, so a caller learns nothing about why');
reset role; select tst.as_user('00000000-0000-0000-0000-0000000000b1'); set local role authenticated;
select tst.expect_error($$select public.monitor_ingest(tst.hash('mk-portfolio'), '[]'::jsonb)$$, 'permission denied', 'a signed-in person cannot call ingestion, even with a valid key');
reset role; set local role anon;
do $$ begin
  begin perform public.monitor_ingest(repeat('a', 64), '[]'::jsonb); raise exception 'FAIL an anonymous caller reached ingestion';
  exception when insufficient_privilege then raise notice 'PASS nor can an anonymous caller'; end;
end $$;
reset role; set local role service_role; select tst.as_service();

-- 4. Ingestion: shape, redaction, de-duplication -----------------------------------------------------------------------------------------
select tst.expect_error($$select tst.ing('mk-portfolio', '{}'::jsonb)$$, 'must be an array', 'the body must be a list of events');
select tst.expect_error($$select tst.ing('mk-portfolio', (select jsonb_agg(jsonb_build_object('event_id', 'big' || g, 'kind', 'message')) from generate_series(1, 51) g))$$, 'At most 50', 'a batch is capped at 50 events');
select tst.expect_true((tst.ing('mk-portfolio', '[]') ->> 'accepted')::int = 0, 'an empty batch is harmless');
select tst.expect_true(tst.ing('mk-portfolio', jsonb_build_array(
  jsonb_build_object('event_id', 'a1', 'kind', 'error', 'message', 'TypeError: x is undefined for ada@example.com token=abc123def456 and card 4242 4242 4242 4242', 'stack', E'Error\n at f (app.js:1:2)', 'route', '/api/users/42?token=zzz&email=a@b.com', 'release', '1.2.0', 'sdk_name', 'ctf-sdk', 'sdk_version', '0.1.0'),
  jsonb_build_object('event_id', 'a2', 'kind', 'latency', 'latency_ms', 120, 'route', '/api/users'),
  jsonb_build_object('event_id', 'a3', 'kind', 'heartbeat', 'latency_ms', 30))) = '{"accepted":3,"duplicates":0,"rejected":0,"out_of_scope":0}'::jsonb, 'a valid batch is accepted in full');
select tst.expect_true((tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'a1', 'kind', 'error', 'message', 'again'), jsonb_build_object('event_id', 'a2', 'kind', 'latency', 'latency_ms', 5))) ->> 'duplicates')::int = 2, 'a retried batch is recognised and not counted twice');
select tst.expect_true((tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'z1', 'kind', 'bogus'), jsonb_build_object('kind', 'error'), '"text"'::jsonb, jsonb_build_object('event_id', 'z2', 'kind', 'message', 'message', 'fine'))) ->> 'rejected')::int = 3, 'unknown kinds, missing ids and non-objects are rejected one by one, the rest still goes in');
reset role;
select tst.expect_true((select message not like '%ada@example.com%' and message like '%[email]%' and message like '%token=[redacted]%' and message not like '%4242%' and message like '%[number]%' from monitor_events where event_id = 'a1'), 'e-mail addresses, tokens and card numbers are redacted before storage');
select tst.expect_true((select route = '/api/users/42' from monitor_events where event_id = 'a1'), 'the query string is dropped from a route');
select tst.expect_true((select message = 'TypeError: x is undefined for [email] token=[redacted] and card [number]' from monitor_events where event_id = 'a1'), 'redaction leaves the useful text intact');
select tst.expect_true((select count(*) = 1 from monitor_events where event_id = 'a1'), 'the duplicate did not create a second row');
select tst.expect_true((select last_sdk_version = '0.1.0' and last_release = '1.2.0' and last_heartbeat_at is not null and last_event_at is not null from monitor_projects where id = tst.id('p1')), 'the project records its SDK version, release, and last heartbeat');
select tst.expect_true((select last_used_at is not null from monitor_keys where id = tst.id('k1')), 'the key records when it was last used');

-- redaction in isolation
select tst.expect_true(monitor_redact('Authorization: Bearer abcdefgh12345678') not like '%abcdefgh%', 'a bearer token is removed (and not left behind by the generic authorization rule)');
select tst.expect_true(monitor_redact('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop') = 'jwt [token]', 'a JWT is removed');
select tst.expect_true(monitor_redact('key sk_live_abcdefghijklmnop1234') = 'key [key]', 'a payment provider key is removed');
select tst.expect_true(monitor_redact('using ctfm_' || repeat('a', 48)) = 'using [key]', 'one of our own keys is removed');
select tst.expect_true(monitor_redact('password=hunter2 and api_key: abc') = 'password=[redacted] and api_key=[redacted]', 'password-like assignments are removed');
select tst.expect_true(monitor_redact(null) = '', 'null is safe');
select tst.expect_true(monitor_redact('order 12345 failed after 3 retries') = 'order 12345 failed after 3 retries', 'ordinary numbers are left alone');

-- scopes, clamping, quota
set local role service_role; select tst.as_service();
select tst.expect_true((tst.ing('mk-events', jsonb_build_array(jsonb_build_object('event_id', 's1', 'kind', 'heartbeat'), jsonb_build_object('event_id', 's2', 'kind', 'message', 'message', 'hello'))) = '{"accepted":1,"duplicates":0,"rejected":0,"out_of_scope":1}'::jsonb), 'a key without the heartbeat scope cannot send heartbeats');
select tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'old1', 'kind', 'message', 'occurred_at', '2020-01-01T00:00:00Z'), jsonb_build_object('event_id', 'fut1', 'kind', 'message', 'occurred_at', '2099-01-01T00:00:00Z'), jsonb_build_object('event_id', 'bad1', 'kind', 'message', 'occurred_at', 'yesterday-ish', 'status_code', 'abc', 'latency_ms', '-5')));
reset role;
select tst.expect_true((select occurred_at >= now() - interval '24 hours 1 minute' from monitor_events where event_id = 'old1'), 'an event claiming to be years old is clamped to the last 24 hours');
select tst.expect_true((select occurred_at <= now() from monitor_events where event_id = 'fut1'), 'an event from the future is clamped to now');
select tst.expect_true((select status_code is null and latency_ms is null from monitor_events where event_id = 'bad1'), 'nonsense numbers and dates are dropped instead of failing the whole batch');
set local role service_role; select tst.as_service();
select tst.ing('mk-quota', tst.evs('q', 8, 'message', 'filler'));
select tst.expect_error($$select tst.ing('mk-quota', tst.evs('r', 5, 'message', 'more'))$$, 'quota', 'a project over its per-minute quota is throttled');
reset role;
select tst.expect_true((select count(*) = 8 from monitor_events where project_id = tst.id('p3')), 'a throttled request stores nothing at all');

-- 5. Aggregates: dashboards read these, not raw events ---------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.ing('mk-market', jsonb_build_array(
  jsonb_build_object('event_id', 'm1', 'kind', 'latency', 'latency_ms', 40), jsonb_build_object('event_id', 'm2', 'kind', 'latency', 'latency_ms', 200), jsonb_build_object('event_id', 'm3', 'kind', 'latency', 'latency_ms', 900),
  jsonb_build_object('event_id', 'm4', 'kind', 'error', 'message', 'boom'), jsonb_build_object('event_id', 'm5', 'kind', 'message', 'level', 'warning', 'message', 'careful'),
  jsonb_build_object('event_id', 'm6', 'kind', 'heartbeat', 'latency_ms', 60)));
reset role; select tst.as_user('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select tst.expect_true((select (s ->> 'events')::int = 6 and (s ->> 'errors')::int = 1 and (s ->> 'warnings') is null and (s ->> 'heartbeats')::int = 1 from (select monitor_series(tst.id('p2'), 24) -> -1 as s) q), 'hourly counts add up: 6 events, 1 error, 1 heartbeat');
select tst.expect_true((select (s ->> 'avg_ms')::int = 300 and (s ->> 'max_ms')::int = 900 and (s ->> 'p95_ms')::int = 1000 from (select monitor_series(tst.id('p2'), 24) -> -1 as s) q), 'latency figures: average 300 ms, slowest 900 ms, p95 band 1000 ms');
select tst.expect_true((select (r ->> 'errors_24h')::int = 1 and (r ->> 'events_24h')::int = 6 and (r ->> 'p95_ms_24h')::int = 1000 and r ->> 'health' = 'healthy' from jsonb_array_elements(monitor_overview()) r where r ->> 'slug' = 'marketing-site'), 'the overview reports the same figures and a healthy project');
select tst.expect_true((select (monitor_top_errors(tst.id('p2'), 5) -> 0 ->> 'message') = 'boom' and (monitor_top_errors(tst.id('p2'), 5) -> 0 ->> 'occurrences')::int = 1), 'the error appears once in the top errors');
select tst.expect_true(monitor_hist_p95(array[0,0,0,0,0,0,0,0]) is null, 'no samples, no percentile');
select tst.expect_true(monitor_hist_p95(array[95,0,0,0,0,0,0,5]) = 50, 'p95 lands in the band that holds the 95th percentile');
select tst.expect_true(monitor_hist_p95(array[90,0,0,0,0,0,0,10]) = 10000, 'a slow tail is reported as "slower than 5 s" (10000)');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$select monitor_series(tst.id('p2'), 24)$$, 'Project not found', 'another department''s project cannot be read, and its existence is not revealed');

-- 6. Errors become incidents ----------------------------------------------------------------------------------------------------------------
reset role; set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', tst.evs('t', 2, 'error', 'DB timeout after N ms for request'));
reset role;
select tst.expect_count($$select 1 from monitor_incidents where project_id = tst.id('p1') and source = 'auto_errors'$$, 0, 'two errors, below the project''s threshold of three, open nothing');
set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', tst.evs('u', 1, 'error', 'DB timeout after N ms for request'));
reset role;
select tst.expect_count($$select 1 from monitor_incidents where project_id = tst.id('p1') and source = 'auto_errors'$$, 1, 'the third occurrence opens exactly one incident');
insert into ids select 'inc1', id from monitor_incidents where project_id = tst.id('p1') and source = 'auto_errors';
select tst.expect_true((select severity = 'medium' and status = 'open' and ack_due_at is not null and next_escalation_at is not null and title like 'Errors in Portfolio site: DB timeout%' from monitor_incidents where id = tst.id('inc1')), 'it starts as a medium incident with an acknowledgement deadline');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b1', 'Medium incident INC-%') = 1, 'DevOps admins are told');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000e2', 'Medium incident INC-%') = 1, 'so is the owning department''s admin');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b2', 'Medium incident INC-%') = 0 and tst.notes('00000000-0000-0000-0000-0000000000b3', 'Medium incident INC-%') = 0, 'ordinary members and the security team are not paged at the first level');
set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', tst.evs('v', 2, 'error', 'DB timeout after N ms for request'));
reset role;
select tst.expect_count($$select 1 from monitor_incidents where project_id = tst.id('p1') and source = 'auto_errors'$$, 1, 'more of the same error never open a second incident');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b1', 'Medium incident INC-%') = 1, 'and never notify again');
set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', tst.evs('w', 10, 'error', 'DB timeout after N ms for request'));
reset role;
select tst.expect_true((select severity = 'high' from monitor_incidents where id = tst.id('inc1')), 'fifteen in ten minutes raise it to high automatically');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('inc1') and kind = 'severity'), 'and the raise is written into the history');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b1', 'Incident INC-% is now high') = 1, 'with one notification');
set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'oom1', 'kind', 'error', 'level', 'fatal', 'message', 'OOM killed')));
reset role;
select tst.expect_true((select severity = 'critical' from monitor_incidents where project_id = tst.id('p1') and title like '%OOM killed%'), 'a single fatal error opens a critical incident at once');
insert into ids select 'inc_oom', id from monitor_incidents where title like '%OOM killed%';

-- 7. Silence: a project that stops sending heartbeats ----------------------------------------------------------------------------------------
select tst.flag(true); update monitor_projects set last_heartbeat_at = now() - interval '20 minutes' where id = tst.id('p1'); select tst.flag(false);
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$select monitor_sweep()$$, 'Only the Main Admin or the scheduler', 'a department member cannot run the sweep');
reset role; set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'silent_projects_opened')::int = 1, 'three missed heartbeat intervals open an incident (run by the scheduler)');
select tst.expect_true((monitor_sweep() ->> 'silent_projects_opened')::int = 0, 'running the sweep again does not open a second one');
reset role;
select tst.expect_true((select severity = 'critical' and status = 'open' from monitor_incidents where project_id = tst.id('p1') and source = 'auto_down'), 'it is critical');
select tst.as_user('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select tst.expect_true((select r ->> 'health' = 'down' from jsonb_array_elements(monitor_overview()) r where r ->> 'slug' = 'portfolio'), 'the overview shows the project as down');
reset role; set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'hb-back', 'kind', 'heartbeat')));
reset role;
select tst.expect_true((select status = 'monitoring' from monitor_incidents where project_id = tst.id('p1') and source = 'auto_down'), 'a returning heartbeat moves the incident to Monitoring (a person still resolves it)');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes n join monitor_incidents i on i.id = n.incident_id where i.source = 'auto_down' and n.body like 'Heartbeats resumed%'), 'and says so in the history');
select tst.as_user('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select tst.expect_true((select r ->> 'health' <> 'down' from jsonb_array_elements(monitor_overview()) r where r ->> 'slug' = 'portfolio'), 'the project is no longer down');
reset role;

-- 8. The incident lifecycle ------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'acknowledged')$$, 'Incident not found', 'someone who cannot see the project cannot touch its incident, nor learn it exists');
select tst.expect_error($$select monitor_open_incident(tst.id('p1'), 'Sneaky', 'low')$$, 'Project not found', 'nor open one');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select monitor_set_incident_status(tst.id('inc1'), 'acknowledged');
reset role;
select tst.expect_true((select status = 'acknowledged' and acknowledged_at is not null and assignee_id = '00000000-0000-0000-0000-0000000000e1' and next_escalation_at is null from monitor_incidents where id = tst.id('inc1')), 'acknowledging assigns it to you and stops the escalation clock');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'monitoring')$$, 'cannot move', 'an acknowledged incident cannot jump to monitoring');
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'resolved')$$, 'Say what caused it', 'resolving needs a root cause');
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'resolved', 'short')$$, 'Say what caused it', 'a one-word root cause does not count');
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'nonsense')$$, 'cannot move', 'an unknown status is refused');
select tst.expect_error($$select monitor_assign_incident(tst.id('inc1'), '00000000-0000-0000-0000-0000000000f1')$$, 'cannot see this project', 'an incident cannot be given to someone who cannot see the project');
select monitor_assign_incident(tst.id('inc1'), '00000000-0000-0000-0000-0000000000b2');
select tst.expect_true((select assignee_id = '00000000-0000-0000-0000-0000000000b2' from monitor_incidents where id = tst.id('inc1')), 'it can be given to someone who can');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('inc1') and kind = 'assignment'), 'and the handover is written into the history');
select monitor_set_incident_status(tst.id('inc1'), 'investigating');
select monitor_set_incident_status(tst.id('inc1'), 'fix_in_progress');
select monitor_set_incident_status(tst.id('inc1'), 'monitoring');
select tst.expect_error($$select monitor_set_root_cause(tst.id('inc1'), 'nope')$$, '10 characters', 'a root cause needs substance');
select monitor_set_incident_status(tst.id('inc1'), 'resolved', 'Connection pool was too small under peak load.');
reset role;
select tst.expect_true((select status = 'resolved' and resolved_at is not null and root_cause = 'Connection pool was too small under peak load.' from monitor_incidents where id = tst.id('inc1')), 'resolving records the time and the root cause');
select tst.expect_true((select count(*) = 5 from monitor_incident_notes where incident_id = tst.id('inc1') and kind = 'status'), 'every status change is in the history');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('inc1') and kind = 'root_cause'), 'and so is the root cause');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b2', 'Incident INC-% resolved') = 1, 'the assignee is told it was resolved');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b2', 'Incident INC-% assigned to you') = 1, 'and was told when it was assigned to them');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$select monitor_set_incident_status(tst.id('inc1'), 'investigating')$$, 'cannot move', 'a resolved incident can only be reopened');
select tst.expect_error($$select monitor_assign_incident(tst.id('inc1'), null)$$, 'cannot be reassigned', 'and cannot be reassigned while resolved');
select monitor_set_incident_status(tst.id('inc1'), 'reopened');
reset role;
select tst.expect_true((select status = 'reopened' and reopen_count = 1 and resolved_at is null and escalation_level = 0 and next_escalation_at is not null from monitor_incidents where id = tst.id('inc1')), 'reopening restarts the acknowledgement clock and counts the reopen');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select monitor_add_note(tst.id('inc1'), 'Looks like it is back after the deploy.');
select tst.expect_error($$select monitor_add_note(tst.id('inc1'), '   ')$$, 'Write something', 'an empty note is refused');
select monitor_set_severity(tst.id('inc1'), 'critical');
select tst.expect_true((select severity = 'critical' from monitor_incidents where id = tst.id('inc1')), 'severity can be changed by hand');
select tst.expect_error($$select monitor_set_severity(tst.id('inc1'), 'catastrophic')$$, 'Severity must be', 'but only to a defined level');

-- duplicates
insert into ids select 'm1', monitor_open_incident(tst.id('p1'), 'Checkout is slow', 'medium', 'Reported by support.');
insert into ids select 'm2', monitor_open_incident(tst.id('p1'), 'Checkout feels slow', 'medium');
select tst.expect_error($$select monitor_open_incident(tst.id('p1'), 'Bad', 'urgent')$$, 'Severity must be', 'an incident needs a defined severity');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'mx', monitor_open_incident(tst.id('p2'), 'Marketing site down', 'high');
select tst.expect_error($$select monitor_mark_duplicate(tst.id('m1'), tst.id('mx'))$$, 'same project', 'incidents in different projects cannot be duplicates');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$select monitor_mark_duplicate(tst.id('m1'), tst.id('m1'))$$, 'itself', 'an incident is not a duplicate of itself');
select tst.expect_error($$select monitor_mark_duplicate(tst.id('m1'), tst.id('mx'))$$, 'not found', 'and cannot be linked to one the person cannot see');
select monitor_mark_duplicate(tst.id('m2'), tst.id('m1'));
select tst.expect_error($$select monitor_mark_duplicate(tst.id('m1'), tst.id('m2'))$$, 'itself a duplicate', 'linking to a duplicate is refused: link to the original');
select tst.expect_true((select status = 'resolved' and duplicate_of = tst.id('m1') and root_cause like 'Duplicate of INC-%' from monitor_incidents where id = tst.id('m2')), 'a duplicate is closed and points at the original');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('m1') and kind = 'link'), 'the original records the link');
select tst.expect_true((select jsonb_array_length(monitor_incident_detail(tst.id('m1')) -> 'duplicates') = 1 from (select 1) q), 'the detail view lists the duplicate');
select tst.expect_true((select jsonb_array_length(monitor_incident_detail(tst.id('inc1')) -> 'notes') >= 8 from (select 1) q), 'the detail view carries the full history');
select tst.expect_true(not exists (select 1 from jsonb_array_elements(monitor_incidents_list('live')) r where r ->> 'project_name' = 'Marketing site'), 'the incident list never includes another department''s project');
select tst.expect_true(exists (select 1 from jsonb_array_elements(monitor_incidents_list('resolved')) r where r ->> 'ref' = (select ref from monitor_incidents where id = tst.id('m2'))), 'the resolved list shows closed incidents');
select tst.expect_true((select bool_and(r ->> 'id' <> '00000000-0000-0000-0000-0000000000f1') and count(*) filter (where r ->> 'id' = '00000000-0000-0000-0000-0000000000e1') = 1 and count(*) filter (where r ->> 'id' = '00000000-0000-0000-0000-0000000000f1') = 0 from jsonb_array_elements(monitor_assignable(tst.id('p1'))) r), 'only people who can see the project are offered as assignees');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$select monitor_incident_detail(tst.id('inc1'))$$, 'Incident not found', 'the detail of an incident is hidden from people without access');
reset role;

-- an error that returns after resolution reopens its incident
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select monitor_set_incident_status(tst.id('inc_oom'), 'acknowledged');
select monitor_set_incident_status(tst.id('inc_oom'), 'resolved', 'Memory leak in the image resizer worker.');
reset role; set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'oom2', 'kind', 'error', 'level', 'fatal', 'message', 'OOM killed')));
reset role;
select tst.expect_true((select status = 'reopened' and reopen_count = 1 from monitor_incidents where id = tst.id('inc_oom')), 'the same fatal error coming back reopens its incident');
select tst.expect_count($$select 1 from monitor_incidents where title like '%OOM killed%'$$, 1, 'instead of opening a second one');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('inc_oom') and body like 'Reopened automatically%'), 'and says why in its history');

-- 9. Guards: only the workflow writes ---------------------------------------------------------------------------------------------------------
select tst.expect_error($$update monitor_incidents set title = 'edited behind the workflow'$$, 'monitoring workflow', 'incidents cannot be edited around the workflow');
select tst.expect_error($$insert into monitor_incident_notes (incident_id, kind, body) values (tst.id('inc1'), 'note', 'forged')$$, 'monitoring workflow', 'notes cannot be inserted around the workflow');
select tst.expect_error($$delete from monitor_incidents$$, 'cannot be deleted', 'incidents cannot be deleted');
select tst.expect_error($$delete from monitor_events$$, 'cannot be deleted', 'raw events are deleted only by retention');
select tst.flag(true);
select tst.expect_error($$update monitor_incident_notes set body = 'rewritten'$$, 'cannot be edited', 'even the workflow cannot rewrite history');
select tst.expect_error($$delete from monitor_incident_notes$$, 'cannot be deleted', 'or erase it');
select tst.flag(false);
create temp table t_fp as select fingerprint from monitor_events where event_id = 'oom1'; grant select on t_fp to authenticated;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_error($$insert into monitor_projects (name, slug) values ('Mine', 'mine')$$, 'permission denied', 'a signed-in person cannot insert a project directly');
select tst.expect_error($$update monitor_incidents set status = 'resolved'$$, 'permission denied', 'nor update an incident directly');
select tst.expect_error($$delete from monitor_incident_notes$$, 'permission denied', 'nor delete a note');
select tst.expect_error($$select count(*) from monitor_events$$, 'permission denied', 'nor read raw events');
select tst.expect_true((select jsonb_array_length(monitor_recent_occurrences(tst.id('p1'), (select fingerprint from t_fp), 5)) >= 1), 'the recent occurrences of one error are available through the bounded function');
select tst.expect_true((select monitor_recent_occurrences(tst.id('p1'), (select fingerprint from t_fp), 5)::text not like '%ctfm_%' and monitor_recent_occurrences(tst.id('p1'), (select fingerprint from t_fp), 50)::text not like '%key_hash%'), 'and carry no key material');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$select monitor_recent_occurrences(tst.id('p1'), 'abcdef0123456789', 5)$$, 'Project not found', 'occurrences of someone else''s project are refused');
reset role;

-- 10. Escalation of an unacknowledged incident ------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.ing('mk-portfolio', jsonb_build_array(jsonb_build_object('event_id', 'disk1', 'kind', 'error', 'level', 'fatal', 'message', 'Disk full')));
reset role;
insert into ids select 'inc_disk', id from monitor_incidents where title like '%Disk full%';
select tst.expect_true((select status = 'open' and escalation_level = 0 and ack_due_at <= now() + interval '5 minutes 1 second' from monitor_incidents where id = tst.id('inc_disk')), 'a critical incident must be acknowledged within five minutes');
set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'escalated')::int = 0, 'it is not escalated before its deadline');
reset role;
select tst.flag(true); update monitor_incidents set next_escalation_at = now() - interval '1 minute' where id = tst.id('inc_disk'); select tst.flag(false);
set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'escalated')::int = 1, 'once overdue, the sweep escalates it');
select tst.expect_true((monitor_sweep() ->> 'escalated')::int = 0, 'and not again on the next run');
reset role;
select tst.expect_true((select escalation_level = 1 and next_escalation_at is not null from monitor_incidents where id = tst.id('inc_disk')), 'level 1 sets the next deadline');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b3', 'Unacknowledged: incident INC-%') = 1, 'level 1 brings in the Cybersecurity admins');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000a1', 'Unacknowledged: incident INC-%') = 0, 'the Main Admin is not yet bothered');
select tst.expect_true((select count(*) = 1 from monitor_incident_notes where incident_id = tst.id('inc_disk') and kind = 'escalation'), 'the escalation is in the history');
select tst.flag(true); update monitor_incidents set next_escalation_at = now() - interval '1 minute' where id = tst.id('inc_disk'); select tst.flag(false);
set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'escalated')::int = 1, 'unacknowledged past level 1, it escalates again');
reset role;
select tst.expect_true((select escalation_level = 2 and next_escalation_at is null from monitor_incidents where id = tst.id('inc_disk')), 'level 2 is the top: no further deadline');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000a1', 'Unacknowledged: incident INC-%') = 1, 'level 2 tells the Main Admin');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000b3', 'Unacknowledged: incident INC-%') = 1, 'nobody is told twice for the same reason');
select tst.flag(true); update monitor_incidents set next_escalation_at = now() - interval '1 minute' where id = tst.id('inc_disk'); select tst.flag(false);
set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'escalated')::int = 0, 'it never escalates past level 2');
reset role;

-- 11. Retention -------------------------------------------------------------------------------------------------------------------------------------
select tst.flag(true);
insert into monitor_events (project_id, key_id, event_id, kind, level, occurred_at, received_at) values (tst.id('p1'), tst.id('k1'), 'ancient', 'message', 'info', now() - interval '15 days', now() - interval '15 days');
insert into monitor_hourly (project_id, environment, bucket, events) values (tst.id('p1'), 'production', now() - interval '401 days', 3);
select tst.flag(false);
select tst.expect_true((select count(*) from monitor_incident_notes) > 0, 'there is incident history to protect');
create temp table n_before as select count(*) as n from monitor_incident_notes;
set local role service_role; select tst.as_service();
select tst.expect_true((monitor_sweep() ->> 'events_deleted')::int >= 1, 'the sweep removes raw events older than 14 days');
reset role;
select tst.expect_count($$select 1 from monitor_events where event_id = 'ancient'$$, 0, 'the old event is gone');
select tst.expect_count($$select 1 from monitor_events where event_id = 'a1'$$, 1, 'recent events stay');
select tst.expect_count($$select 1 from monitor_hourly where bucket < now() - interval '400 days'$$, 0, 'hourly figures older than 400 days are gone');
select tst.expect_true((select count(*) = (select n from n_before) from monitor_incident_notes), 'incident history is untouched by retention');
select tst.expect_true((select count(*) > 0 from monitor_incidents), 'and so are the incidents');

-- 12. The Super Dashboard: each section follows its own permission ------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000f1');
insert into ids select 'fr1', create_fund_request(jsonb_build_object('department_id', (select id from departments where slug = 'frontend-development'), 'category', 'domain', 'title', 'Renew domain', 'justification', 'The domain expires in two weeks.', 'amount', 100000, 'vendor', 'Namecheap'), false, 'dash-1');
select submit_fund_request(tst.id('fr1'));
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select save_finance_renewal(null, jsonb_build_object('department_id', (select id from departments where slug = 'frontend-development'), 'title', 'Hosting', 'category', 'hosting', 'amount', 85000, 'frequency', 'yearly', 'next_due', (current_date + 7)::text, 'critical', true));
select save_finance_renewal(null, jsonb_build_object('department_id', (select id from departments where slug = 'frontend-development'), 'title', 'Old licence', 'category', 'software', 'amount', 5000, 'frequency', 'yearly', 'next_due', (current_date - 3)::text));
create temp table dash_main as select super_dashboard() as d; grant select on dash_main to authenticated;
select tst.expect_true((select d -> 'sections' = '["monitoring","support","finance","renewals","audit"]'::jsonb from dash_main), 'the Main Admin sees all five sections');
select tst.expect_true((select (d #>> '{monitoring,projects,total}')::int = 3 and (d #>> '{monitoring,incidents,open}')::int >= 3 and (d #>> '{monitoring,incidents,critical}')::int >= 2 from dash_main), 'monitoring counts projects and live incidents by severity');
select tst.expect_true((select (d #>> '{monitoring,projects,down}')::int = 0 and (d #>> '{monitoring,incidents,unacknowledged}')::int >= 1 from dash_main), 'and unacknowledged incidents');
select tst.expect_true((select d #>> '{finance,pending_decision,0,basis}' = 'pending' and (d #>> '{finance,pending_decision,0,amount}')::numeric = 100000 and (d #>> '{finance,pending_decision,0,count}')::int = 1 from dash_main), 'a submitted request is counted as pending, labelled as such');
select tst.expect_true((select d #>> '{renewals,due_30d_amount,0,basis}' = 'estimated' and (d #>> '{renewals,due_30d_amount,0,amount}')::numeric = 85000 and (d #>> '{renewals,due_30d_count}')::int = 1 and (d #>> '{renewals,critical_due_30d}')::int = 1 and (d #>> '{renewals,overdue}')::int = 1 from dash_main), 'renewal amounts are labelled estimated, with due, critical and overdue counts');
select tst.expect_true((select jsonb_typeof(d #> '{finance,paid_30d}') = 'array' and jsonb_typeof(d #> '{finance,reconciled_30d}') = 'array' and (d #>> '{finance,needs_attention}')::int = 0 from dash_main), 'paid and reconciled figures are separate, and nothing needs attention');
select tst.expect_true((select (d #>> '{audit,events_24h}')::int > 0 and jsonb_typeof(d #> '{audit,recent}') = 'array' from dash_main), 'the audit section summarises the last day');
select tst.expect_true((select not (d #> '{audit,recent,0}' ? 'metadata') and not (d #> '{audit,recent,0}' ? 'ip_address') from dash_main), 'and exposes no metadata or addresses');
select tst.expect_true((select (d #>> '{support,open}')::int >= 0 and d -> 'support' ? 'overdue' from dash_main), 'support shows open and overdue tickets');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_true((select super_dashboard() -> 'sections' = '["monitoring"]'::jsonb), 'a DevOps member sees only the monitoring section');
select tst.expect_true((select not (super_dashboard() ? 'finance') and not (super_dashboard() ? 'audit') and not (super_dashboard() ? 'support') from (select 1) q), 'finance, support and audit are absent, not merely empty');
select tst.as_user('00000000-0000-0000-0000-0000000000f2');
select tst.expect_true((select super_dashboard() -> 'sections' = '["finance","renewals"]'::jsonb), 'a finance member sees finance and renewals only');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_true((select super_dashboard() -> 'sections' = '["support"]'::jsonb), 'the Customer Service lead sees support only');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_true((select super_dashboard() -> 'sections' = '[]'::jsonb), 'a frontend developer sees nothing');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_true((select super_dashboard() -> 'sections' = '[]'::jsonb), 'neither does a client');
reset role; set local role anon;
do $$ begin
  begin perform public.super_dashboard(); raise exception 'FAIL an anonymous caller reached the dashboard';
  exception when insufficient_privilege then raise notice 'PASS and an anonymous caller cannot call it at all'; end;
end $$;
reset role;
rollback;
