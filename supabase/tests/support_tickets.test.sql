-- Behavioural tests for 20261002000002_support_tickets.sql
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000d1','agent@x'), ('00000000-0000-0000-0000-0000000000d2','agent2@x'),
 ('00000000-0000-0000-0000-0000000000d3','lead@x'), ('00000000-0000-0000-0000-0000000000e1','be@x'), ('00000000-0000-0000-0000-0000000000e2','beadmin@x'),
 ('00000000-0000-0000-0000-0000000000e3','fin@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e3');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000d1','CTF-WKR-S0000001',(select id from departments where slug='customer-service'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d2','CTF-WKR-S0000002',(select id from departments where slug='customer-service'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d3','CTF-WKR-S0000003',(select id from departments where slug='customer-service'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000e1','CTF-WKR-S0000004',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000e2','CTF-WKR-S0000005',(select id from departments where slug='backend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000e3','CTF-WKR-S0000006',(select id from departments where slug='finance'),'member','active');

-- The local harness re-grants EXECUTE on every function after migrations run (real Supabase does not). Re-apply the migration so the
-- revokes it makes are what is under test.
\ir ../migrations/20261002000002_support_tickets.sql
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

-- 1. Connecting a project -----------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_error($$select register_support_source('Portfolio site', tst.hash('key-one'), 'ctfs_ab')$$, 'Only a Main Admin', 'a support lead cannot connect a project');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select register_support_source('Portfolio site', tst.hash('key-one'), 'ctfs_ab');
select register_support_source('Other site', tst.hash('key-two'), 'ctfs_cd');
select tst.expect_error($$select register_support_source('Dup', tst.hash('key-one'), 'ctfs_ab')$$, 'duplicate key', 'the same key cannot be registered twice');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_count($$select 1 from support_sources$$, 2, 'a support lead can see which projects are connected');
select tst.expect_error($$select key_hash from support_sources$$, 'permission denied', '...but never the key hashes');
select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_count($$select 1 from support_sources$$, 0, 'an agent cannot');

-- 2. Intake: only the service role; authenticated by project key ------------------------------------------------------------------------
select tst.expect_error($$select * from support_intake(tst.hash('key-one'),'x1','c1','Ada','Cannot log in','Details','account','high')$$, 'permission denied', 'a signed-in user cannot call intake directly');
reset role; set local role service_role;
create temp table t1 as select * from support_intake(tst.hash('key-one'),'order-77','cust-9','Ada','Cannot log in','I get an error','account','high');
select tst.expect_true((select not duplicate from t1), 'a report from a connected project creates a ticket');
create temp table t2 as select * from support_intake(tst.hash('key-one'),'order-77','cust-9','Ada','Cannot log in','I get an error','account','high');
select tst.expect_true((select duplicate and ticket_ref = (select ticket_ref from t1) from t2), 'a retried webhook returns the same ticket (no duplicate)');
select tst.expect_true((select count(*) from support_tickets where external_ref='order-77') = 1, '...and there is still only one');
create temp table t3 as select * from support_intake(tst.hash('key-two'),'order-77','cust-1','Bo','Different project, same reference','x','bug','normal');
select tst.expect_true((select not duplicate from t3), 'the same external reference from ANOTHER project is a different ticket');
select tst.expect_error($$select * from support_intake(tst.hash('forged'),'z','c','n','subject here','d','bug','low')$$, 'Unknown or revoked', 'an unknown project key is refused');
select tst.expect_error($$select * from support_intake(tst.hash('key-one'),'','c','n','subject here','d','bug','low')$$, 'external_ref is required', 'a report without a reference is refused (it could not be de-duplicated)');
select tst.expect_true((select priority = 'high' and due_at < now() + interval '25 hours' from support_tickets where external_ref='order-77' and source_id = (select id from support_sources where name='Portfolio site')), 'high priority gets the 24-hour first-response target');
reset role; insert into ids select 'tk1', id from support_tickets where external_ref='order-77' and source_id = (select id from support_sources where name='Portfolio site');
select tst.expect_true((select count(*) from notifications where title in ('New customer report','Urgent customer report') and user_id in ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000a1')) >= 2, 'the support lead and Main Admin are told');
-- rate limit
set local role service_role;
do $$ begin for i in 1..29 loop perform * from support_intake(tst.hash('key-two'),'flood-'||i,'c','n','Flooding the queue','d','bug','low'); end loop; end $$;
select tst.expect_error($$select * from support_intake(tst.hash('key-two'),'flood-30','c','n','Flooding the queue','d','bug','low')$$, 'Too many tickets', 'a project that floods the queue is rate-limited');
reset role;
update support_sources set active=false where name='Other site';
set local role service_role;
select tst.expect_error($$select * from support_intake(tst.hash('key-two'),'after-revoke','c','n','After revoke here','d','bug','low')$$, 'Unknown or revoked', 'a revoked project key stops working immediately');
reset role;

-- 3. Who can see and do what ------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_true((select count(*) from support_tickets) >= 1, 'a support agent sees the queue');
select tst.expect_error($$update support_tickets set status='resolved' where id=tst.id('tk1')$$, 'permission denied', 'agents cannot write the table directly');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from support_tickets$$, 0, 'a backend engineer cannot see customer tickets');
select tst.as_user('00000000-0000-0000-0000-0000000000e3');
select tst.expect_count($$select 1 from support_tickets$$, 0, 'nor can Finance');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from support_tickets$$, 0, 'nor a client');

-- 4. Assignment ---------------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select tst.expect_error($$select assign_ticket(tst.id('tk1'), '00000000-0000-0000-0000-0000000000d1')$$, 'only a Customer Service lead', 'an agent cannot hand a ticket to someone else');
select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select assign_ticket(tst.id('tk1'), '00000000-0000-0000-0000-0000000000d1');
select tst.expect_true((select assignee_id = '00000000-0000-0000-0000-0000000000d1' and status='assigned' from support_tickets where id=tst.id('tk1')), 'an agent can take an unassigned ticket');
select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select tst.expect_error($$select set_ticket_status(tst.id('tk1'), 'resolved')$$, 'assigned to someone else', 'another agent cannot change a ticket assigned to a colleague');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select assign_ticket(tst.id('tk1'), '00000000-0000-0000-0000-0000000000d2');
select tst.expect_error($$select assign_ticket(tst.id('tk1'), '00000000-0000-0000-0000-0000000000e1')$$, 'not on the Customer Service team', 'a ticket can only be assigned to Customer Service staff');

-- 5. Replies: customer-visible vs internal ---------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select reply_to_ticket(tst.id('tk1'), 'Internal: looks like the auth cookie bug again.', 'internal');
select tst.expect_true((select first_response_at is null from support_tickets where id=tst.id('tk1')), 'an internal note does not count as a response to the customer');
select reply_to_ticket(tst.id('tk1'), 'Hi Ada, we are looking into it.', 'public');
select tst.expect_true((select first_response_at is not null and status='in_progress' from support_tickets where id=tst.id('tk1')), 'a public reply records the first response');
reset role; set local role service_role;
select tst.expect_true((select count(*) from support_ticket_public(tst.hash('key-one'),'order-77') where message_body is not null) = 1, 'the customer sees exactly one message');
select tst.expect_true(not exists (select 1 from support_ticket_public(tst.hash('key-one'),'order-77') where message_body ilike '%auth cookie%'), 'and it is not the internal note');
select tst.expect_true(not exists (select 1 from support_ticket_public(tst.hash('key-one'),'order-77') where message_body ilike '%Reported through%' or message_body ilike '%Assigned to%'), 'nor any system log line');
select tst.expect_true((select count(*) from support_ticket_public(tst.hash('key-two'),'order-77')) = 0, 'another project''s key cannot read this ticket');
select support_customer_reply(tst.hash('key-one'),'order-77','Thanks, still stuck.');
select tst.expect_error($$insert into support_messages (ticket_id, author_kind, visibility, body) values ((select v from ids where k='tk1'),'customer','internal','x')$$, 'support workflow', 'even the service role cannot write messages directly (only the workflow functions can)');
reset role;
select tst.expect_true((select count(*) from support_messages where ticket_id=tst.id('tk1') and author_kind='customer' and visibility='public') = 1, 'a customer reply is stored as public');
select tst.expect_error($$insert into support_messages (ticket_id, author_kind, visibility, body) values ((select v from ids where k='tk1'),'customer','internal','x')$$, 'support workflow', 'and can never be stored as internal');

-- 6. Escalation ---------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select tst.expect_error($$select escalate_ticket(tst.id('tk1'), 'finance', 'please look')$$, 'technical department', 'tickets escalate to technical departments only');
select tst.expect_error($$select escalate_ticket(tst.id('tk1'), 'backend-development', 'hi')$$, 'what you need', 'an escalation must say what is needed');
select escalate_ticket(tst.id('tk1'), 'backend-development', 'Login fails with a 500 for this customer; please check the auth service.');
select tst.expect_true((select status='escalated' and escalated_record_id is not null from support_tickets where id=tst.id('tk1')), 'escalation marks the ticket and links a bug');
select tst.as_user('00000000-0000-0000-0000-0000000000e1');
select tst.expect_count($$select 1 from support_tickets$$, 1, 'the backend team now sees that one ticket (and no other)');
select tst.expect_true((select count(*) from support_messages where ticket_id=tst.id('tk1')) >= 3, 'with its notes, for context');
select reply_to_ticket(tst.id('tk1'), 'Root cause: expired signing key. Fix deploying.', 'internal');
select tst.expect_error($$select reply_to_ticket(tst.id('tk1'), 'Hello customer', 'public')$$, 'Only Customer Service', 'the technical team cannot message the customer');
select tst.expect_error($$select set_ticket_status(tst.id('tk1'), 'resolved')$$, 'not Customer Service', 'nor change the ticket status');
reset role; select tst.expect_true((select count(*) from department_records where kind='bug' and title like 'TKT-%' and department_id=(select id from departments where slug='backend-development')) = 1, 'the bug is on the Backend department board');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000e3');
select tst.expect_count($$select 1 from support_tickets$$, 0, 'Finance still cannot see it');

-- 7. Resolving, rating --------------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select set_ticket_status(tst.id('tk1'), 'resolved');
select tst.expect_true((select resolved_at is not null from support_tickets where id=tst.id('tk1')), 'resolving stamps the time');
reset role; set local role service_role;
select support_customer_rating(tst.hash('key-one'),'order-77', 4, 'Quick fix, thanks');
select support_customer_rating(tst.hash('key-two'),'order-77', 1, 'wrong project tries to rate');
reset role;
select tst.expect_true((select rating = 4 from support_tickets where id=tst.id('tk1')), 'the customer''s rating is recorded, and another project''s key cannot overwrite it');
select tst.expect_error($$delete from support_tickets$$, 'support workflow', 'support history cannot be deleted');
rollback;
