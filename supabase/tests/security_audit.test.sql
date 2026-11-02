-- Behavioural tests for 20261003000000_security_audit_fixes.sql (all migrations applied; rolled back)
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','w1@x'), ('00000000-0000-0000-0000-0000000000b2','w2@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2');
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-A0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-A0000002',(select id from departments where slug='backend-development'),'member','active');

-- The local harness re-grants EXECUTE on every function after migrations run (real Supabase does not): re-apply so the revokes are under test.
\ir ../migrations/20261003000000_security_audit_fixes.sql

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
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin
  if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
-- Role and permission ids, read as the table owner: the people under test cannot read these tables, so a plain sub-select would be empty and an insert of zero rows would "pass" for the wrong reason.
create function tst.role_id(n text) returns uuid language sql security definer set search_path = public as $$ select id from public.roles where name = n $$;
create function tst.perm_id(k text) returns uuid language sql security definer set search_path = public as $$ select id from public.permissions where key = k $$;
grant usage on schema tst to anon, authenticated; grant execute on all functions in schema tst to anon, authenticated;

-- ══ EVERY TABLE IN public HAS ROW LEVEL SECURITY ═════════════════════════════════════════════════════════════
-- (This is the regression guard: user_roles and role_permissions were the two that slipped through.)
select tst.expect_count($$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity$$, 0, 'every table in public has row level security enabled');

-- ══ ROLE TABLES ARE NOT OPEN TO THE WORLD ════════════════════════════════════════════════════════════════════
set local role anon;
select tst.expect_error($$select 1 from public.role_permissions$$, 'permission denied', 'a signed-out visitor cannot read role_permissions');
select tst.expect_error($$select 1 from public.user_roles$$, 'permission denied', 'a signed-out visitor cannot read user_roles');
select tst.expect_error($$insert into public.user_roles (user_id, role_id) values ('00000000-0000-0000-0000-0000000000b1', tst.role_id('superadmin'))$$, 'permission denied', 'a signed-out visitor cannot grant a role');
select tst.expect_error($$delete from public.role_permissions$$, 'permission denied', 'a signed-out visitor cannot delete permission links');
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from public.role_permissions$$, 0, 'a worker cannot read role_permissions');
select tst.expect_error($$insert into public.user_roles (user_id, role_id) values ('00000000-0000-0000-0000-0000000000b1', tst.role_id('superadmin'))$$, 'row-level security', 'a worker cannot make themselves a Main Admin through user_roles');
select tst.expect_error($$insert into public.role_permissions (role_id, permission_id) values (tst.role_id('client'), tst.perm_id('projects.view')) on conflict do nothing$$, 'row-level security', 'a worker cannot give their role more permissions');
do $$ declare n int; begin delete from public.role_permissions; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL a worker deleted % permission links', n; end if; raise notice 'PASS a worker cannot delete permission links (RLS: no matching row)'; end $$;
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_true((select count(*) from public.role_permissions) > 0, 'the Main Admin can still read role_permissions (the Roles page keeps working)');
do $$ begin
  insert into public.user_roles (user_id, role_id) values ('00000000-0000-0000-0000-0000000000b2', tst.role_id('client')) on conflict do nothing;
  if not exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000b2' and role_id = tst.role_id('client')) then raise exception 'FAIL the Main Admin could not add a role'; end if;
  raise notice 'PASS the Main Admin can still manage user_roles';
end $$;
reset role;

-- has_permission() is SECURITY DEFINER, so turning RLS on does not break it for people who cannot read the tables.
insert into public.roles (name, description) values ('manager','test') on conflict (name) do nothing;
update public.profiles set role='manager' where id='00000000-0000-0000-0000-0000000000b2';
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_true(public.has_permission('projects.view') is not null, 'has_permission still answers for a signed-in person (it reads the role tables as its owner)');
reset role;

-- ══ INTERNAL FUNCTIONS ARE NOT CALLABLE FROM THE API ═════════════════════════════════════════════════════════
select tst.expect_true(not has_function_privilege('anon', 'public.sync_department_channels(uuid)', 'execute'), 'a signed-out visitor cannot run sync_department_channels');
select tst.expect_true(not has_function_privilege('authenticated', 'public.sync_department_channels(uuid)', 'execute'), 'a signed-in person cannot run sync_department_channels');

-- ══ A PRESENTATION CANNOT CARRY A SCRIPT ADDRESS ═════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into presentation_sessions (id, department_id, presenter_id, title, kind, state) values
 ('70000000-0000-0000-0000-0000000000a1',(select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000b1','Demo','browser','{"url":"https://example.com/app"}');
select tst.expect_true((select state ->> 'url' from presentation_sessions where id='70000000-0000-0000-0000-0000000000a1') = 'https://example.com/app', 'an https address is accepted');
select tst.expect_error($$update presentation_sessions set state='{"url":"javascript:fetch(1)"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'a javascript: address is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":"JaVaScRiPt:alert(1)"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'a mixed-case javascript: address is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":"data:text/html,<script>alert(1)</script>"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'a data: address is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":"http://example.com/plain"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'plain http (not localhost) is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":"https://user:pw@example.com/"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'an address with a password in it is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":"https://exa mple.com/"}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'an address with a space is refused');
select tst.expect_error($$update presentation_sessions set state='{"url":123}' where id='70000000-0000-0000-0000-0000000000a1'$$, 'text', 'a non-text address is refused');
select tst.expect_error($$update presentation_sessions set state=jsonb_build_object('url', 'https://example.com/' || repeat('a', 2100)) where id='70000000-0000-0000-0000-0000000000a1'$$, 'https', 'an address over 2000 characters is refused');
update presentation_sessions set state='{"url":"http://localhost:5173/"}' where id='70000000-0000-0000-0000-0000000000a1';
select tst.expect_true((select state ->> 'url' from presentation_sessions where id='70000000-0000-0000-0000-0000000000a1') = 'http://localhost:5173/', 'http://localhost is accepted');
update presentation_sessions set state='{"device":"mobile"}' where id='70000000-0000-0000-0000-0000000000a1';
select tst.expect_true((select state_version from presentation_sessions where id='70000000-0000-0000-0000-0000000000a1') = 2, 'a state with no address (device only) is fine, and versions still count');
select tst.expect_error($$insert into presentation_sessions (department_id, presenter_id, title, kind, state) values ((select id from departments where slug='frontend-development'),'00000000-0000-0000-0000-0000000000b1','Bad','browser','{"url":"javascript:alert(1)"}') returning id$$, 'https', 'a presentation cannot START with a javascript: address either (INSERT ... RETURNING)');
reset role;

rollback;
