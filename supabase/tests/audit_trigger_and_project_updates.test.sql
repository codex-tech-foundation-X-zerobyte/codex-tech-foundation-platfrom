-- Behavioural tests for migration 20260924000000_fix_audit_trigger_and_project_updates.sql
-- Run on a database with ALL migrations applied, as a superuser (uses SET ROLE; everything is rolled back):
--   psql "$DATABASE_URL" -f supabase/tests/audit_trigger_and_project_updates.test.sql
-- Each check prints "NOTICE: PASS ..."; any failure raises an exception.
\set ON_ERROR_STOP on
begin;
create schema tst;
create function tst.as_user(u text) returns void language plpgsql as $$ begin execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u, true); end $$;
create function tst.as_super() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function tst.check(name text, ok boolean) returns void language plpgsql as $$ begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

-- ---------- fixtures ----------
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x'), ('00000000-0000-0000-0000-0000000000b1','worker@x'),
 ('00000000-0000-0000-0000-0000000000d1','mgr_full@x'), ('00000000-0000-0000-0000-0000000000d2','mgr_none@x'),
 ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker'     where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set role='manager'    where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
-- mgr_full holds the permissions a typical manager is meant to have; mgr_none is a manager with no granted permissions.
insert into public.roles (id, name) values ('50000000-0000-0000-0000-000000000001','test_manager');
insert into public.role_permissions (role_id, permission_id) select '50000000-0000-0000-0000-000000000001', id from public.permissions where key in ('projects.view','projects.update','workers.view','workers.update','workers.suspend');
insert into public.user_roles (user_id, role_id) values ('00000000-0000-0000-0000-0000000000d1','50000000-0000-0000-0000-000000000001');
insert into public.worker_profiles (user_id, worker_id) values ('00000000-0000-0000-0000-0000000000b1','CTF-W-0001');
insert into public.clients (id, organization) values ('10000000-0000-0000-0000-00000000000a','Acme');
insert into public.client_users (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000a');
insert into public.projects (id, name, owner_id, client_account_id) values ('20000000-0000-0000-0000-000000000001','Acme site','00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000a');
grant select on all tables in schema public to authenticated;

-- ═══ A. Suspend / reactivate (the worker_profiles 400) ═══
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
update public.worker_profiles set status='suspended' where user_id='00000000-0000-0000-0000-0000000000b1';
select tst.check('A1 superadmin can suspend a worker (was: 42703 -> HTTP 400)', (select status from public.worker_profiles) = 'suspended');
update public.worker_profiles set status='active' where user_id='00000000-0000-0000-0000-0000000000b1';
select tst.check('A2 ...and reactivate', (select status from public.worker_profiles) = 'active');
select tst.as_super();
select tst.check('A3 audit rows written with resource_id = the worker''s user_id',
  (select count(*) from public.audit_logs where action='worker.status_changed' and resource_id='00000000-0000-0000-0000-0000000000b1'
     and actor_user_id='00000000-0000-0000-0000-0000000000a1') = 2);
select tst.check('A4 audit metadata records from/to status',
  exists (select 1 from public.audit_logs where action='worker.status_changed' and metadata = '{"from_status":"active","to_status":"suspended"}'::jsonb));
update public.client_users set status='suspended' where user_id='00000000-0000-0000-0000-0000000000c1';
select tst.check('A5 client_users status change (same bug) also works and is audited',
  exists (select 1 from public.audit_logs where action='client.status_changed' and resource_id='00000000-0000-0000-0000-0000000000c1'));
-- A suspended client must lose access to project data (is_project_client requires an active client_users row).
insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','Visible only to active clients','x', now());
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.check('A5b a SUSPENDED client can no longer read project updates', (select count(*) from public.project_updates) = 0);
select tst.as_super();
update public.client_users set status='active' where user_id='00000000-0000-0000-0000-0000000000c1';
delete from public.project_updates where title='Visible only to active clients';
update public.projects set status='active' where id='20000000-0000-0000-0000-000000000001';
select tst.check('A6 tables keyed by id still audit correctly (projects)',
  exists (select 1 from public.audit_logs where action='project.updated' and resource_id='20000000-0000-0000-0000-000000000001'));

-- authorisation must NOT have been weakened
select tst.as_user('00000000-0000-0000-0000-0000000000d2');   -- manager, no permissions
do $$ declare n int; begin
  begin update public.worker_profiles set status='suspended' where user_id='00000000-0000-0000-0000-0000000000b1'; get diagnostics n = row_count;
    if n = 0 then raise notice 'PASS  A7 manager without permissions cannot change worker status (0 rows)'; else raise exception 'FAIL A7 manager changed status'; end if;
  exception when insufficient_privilege then raise notice 'PASS  A7 manager without permissions cannot change worker status (denied)'; end; end $$;
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');   -- worker (not admin)
do $$ declare n int; begin
  update public.worker_profiles set status='banned' where user_id='00000000-0000-0000-0000-0000000000b1'; get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  A8 a worker cannot ban themselves (0 rows)'; else raise exception 'FAIL A8 worker changed own status'; end if; end $$;
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d1');   -- manager with workers.suspend
update public.worker_profiles set status='suspended' where user_id='00000000-0000-0000-0000-0000000000b1';
select tst.check('A9 manager WITH workers.suspend can suspend', (select status from public.worker_profiles) = 'suspended');

-- ═══ B. Publishing project updates (the project_updates 403) ═══
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');   -- worker
insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','Worker update','x', now());
select tst.check('B1 worker can publish an update as themselves (was: 403)', (select count(*) from public.project_updates where title='Worker update') = 1);
do $$ begin
  begin insert into public.project_updates (project_id, author_id, title, body) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Forged author','x'); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege then raise notice 'PASS  B2 cannot publish as someone else (author_id must equal auth.uid())'; end; end $$;
do $$ begin
  begin insert into public.project_updates (project_id, author_id, title, body) values ('20000000-0000-0000-0000-000000000001',null,'Anonymous','x'); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege then raise notice 'PASS  B3 null author is rejected (the old null-author fallback can never succeed)'; end; end $$;
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000a1');   -- superadmin
insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Admin update','x', now());
select tst.check('B4 superadmin can publish', (select count(*) from public.project_updates where title='Admin update') = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d1');   -- manager with projects.update
insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','Manager update','x', now());
select tst.check('B5 manager WITH projects.update can publish and can read it back', (select count(*) from public.project_updates where title='Manager update') = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d2');   -- manager without permissions
do $$ begin
  begin insert into public.project_updates (project_id, author_id, title, body) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d2','Not allowed','x'); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege then raise notice 'PASS  B6 manager WITHOUT projects.update is still blocked'; end; end $$;
select tst.check('B7 ...and cannot read updates either', (select count(*) from public.project_updates) = 0);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c1');   -- client
do $$ begin
  begin insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','Client post','x', now()); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege then raise notice 'PASS  B8 a client cannot publish updates'; end; end $$;
select tst.check('B9 client sees only published updates on their own project (3 published, 0 drafts)', (select count(*) from public.project_updates) = 3);
select tst.as_super();
insert into public.project_updates (project_id, author_id, title, body, published_at) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','A draft','x', null);
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.check('B10 client still cannot see an unpublished draft', (select count(*) from public.project_updates where title='A draft') = 0);
select tst.as_super(); reset role;
set local role anon;
do $$ declare n int; begin
  begin select count(*) into n from public.project_updates; if n = 0 then raise notice 'PASS  B11 anonymous users see nothing'; else raise exception 'FAIL anon read'; end if;
  exception when insufficient_privilege then raise notice 'PASS  B11 anonymous users are denied'; end; end $$;
do $$ begin
  begin insert into public.project_updates (project_id, title, body) values ('20000000-0000-0000-0000-000000000001','anon','x'); raise exception 'NOT BLOCKED';
  exception when insufficient_privilege then raise notice 'PASS  B12 anonymous users cannot insert'; end; end $$;
rollback;
