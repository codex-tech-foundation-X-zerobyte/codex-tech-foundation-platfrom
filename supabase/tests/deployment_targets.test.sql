-- Behavioural tests for 20261008000000_deployment_targets.sql
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','be@x'), ('00000000-0000-0000-0000-0000000000f1','fe@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-D0000001',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-D0000002',(select id from departments where slug='frontend-development'),'member','active');
\ir ../migrations/20261008000000_deployment_targets.sql
create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then if sqlerrm like 'FAIL %' then raise; end if; if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if; raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated, anon; grant execute on all functions in schema tst to authenticated, anon;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.integration_repositories (full_name, department_id) values ('codex/api', (select id from departments where slug='backend-development')), ('codex/web', (select id from departments where slug='frontend-development'));

-- 1. Only the Main Admin connects or disconnects ------------------------------------------------------------------------------------------------
select set_deployment_target('codex/api', 'vercel', 'codex-api', null);
select tst.expect_true((select project_ref from public.deployment_targets where repo_full_name='codex/api') = 'codex-api', 'the Main Admin can connect a repository to a Vercel project');
select set_deployment_target('codex/api', 'vercel', '  prj_abc123  ', '  team_xyz ');
select tst.expect_true((select project_ref || '|' || team_ref from public.deployment_targets where repo_full_name='codex/api') = 'prj_abc123|team_xyz', 'values are trimmed, and the mapping is replaced, not duplicated');
select tst.expect_count($$select 1 from public.deployment_targets$$, 1, 'one mapping per repository');
select set_deployment_target('codex/api', 'vercel', 'codex-api', '   ');
select tst.expect_true((select team_ref is null from public.deployment_targets where repo_full_name='codex/api'), 'a blank team means no team');
select set_deployment_target('codex/web', 'vercel', 'codex-web', null);
select tst.expect_error($$select set_deployment_target('codex/api', 'netlify', 'x', null)$$, 'Only Vercel', 'another provider is refused for now');
select tst.expect_error($$select set_deployment_target('codex/ghost', 'vercel', 'x', null)$$, 'not linked', 'an unlinked repository is refused');
select tst.expect_error($$select set_deployment_target('codex/api', 'vercel', 'bad name; drop', null)$$, 'violates check constraint', 'a malformed project reference is refused');
select tst.expect_error($$select set_deployment_target('codex/api', 'vercel', '', null)$$, 'violates check constraint', 'an empty project reference is refused');
select tst.expect_error($$select set_deployment_target('codex/api', 'vercel', 'ok', '../team')$$, 'violates check constraint', 'a malformed team reference is refused');
select tst.expect_error($$select set_deployment_target('codex/api', 'vercel', repeat('a', 101), null)$$, 'violates check constraint', 'an over-long reference is refused');
reset role;

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select set_deployment_target('codex/api', 'vercel', 'x', null)$$, 'Only the Main Admin', 'a worker cannot connect deployments');
select tst.expect_error($$select clear_deployment_target('codex/api')$$, 'Only the Main Admin', 'nor disconnect them');
select tst.expect_error($$insert into public.deployment_targets (repo_full_name, project_ref) values ('codex/api','x')$$, 'permission denied', 'nor write the table directly');
select tst.expect_error($$update public.deployment_targets set project_ref = 'hijack'$$, 'permission denied', 'nor update it directly');
select tst.expect_error($$delete from public.deployment_targets$$, 'permission denied', 'nor delete from it');

-- 2. Visibility follows the repository ------------------------------------------------------------------------------------------------------------
select tst.expect_count($$select 1 from public.deployment_targets$$, 1, 'a Backend member sees only the Backend repository mapping');
select tst.expect_true((select repo_full_name from public.deployment_targets) = 'codex/api', 'and it is the right one');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_true((select repo_full_name from public.deployment_targets) = 'codex/web' and (select count(*) from public.deployment_targets) = 1, 'a Frontend member sees only the Frontend one');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from public.deployment_targets$$, 0, 'a client sees none');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count($$select 1 from public.deployment_targets$$, 2, 'the Main Admin sees all');
reset role;
set local role anon;
select tst.expect_error($$select * from public.deployment_targets$$, 'permission denied', 'anonymous visitors cannot read mappings');
reset role;

-- 3. Disconnect, audit, unlink ------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select clear_deployment_target('codex/web');
select tst.expect_count($$select 1 from public.deployment_targets where repo_full_name='codex/web'$$, 0, 'the Main Admin can disconnect');
select clear_deployment_target('codex/web');
select tst.expect_count($$select 1 from public.audit_logs where action='deployment.target.cleared'$$, 1, 'disconnecting twice audits once');
select tst.expect_true((select count(*) from public.audit_logs where action='deployment.target.set') >= 4, 'every connection is audited');
delete from public.integration_repositories where full_name = 'codex/api';
select tst.expect_count($$select 1 from public.deployment_targets$$, 0, 'unlinking a repository removes its deployment mapping');
reset role;
rollback;
