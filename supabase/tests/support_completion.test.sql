-- Behavioural tests for 20261005000000_support_completion.sql (all migrations applied; rolled back at the end)
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000d1','agent@x'), ('00000000-0000-0000-0000-0000000000d2','agent2@x'),
 ('00000000-0000-0000-0000-0000000000d3','lead@x'), ('00000000-0000-0000-0000-0000000000b1','devops@x'), ('00000000-0000-0000-0000-0000000000f1','fe@x'),
 ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
update public.profiles set display_name='Agent Two' where id='00000000-0000-0000-0000-0000000000d2';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000d1','CTF-WKR-C0000001',(select id from departments where slug='customer-service'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d2','CTF-WKR-C0000002',(select id from departments where slug='customer-service'),'member','active'),
 ('00000000-0000-0000-0000-0000000000d3','CTF-WKR-C0000003',(select id from departments where slug='customer-service'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-C0000004',(select id from departments where slug='devops'),'member','active'),
 ('00000000-0000-0000-0000-0000000000f1','CTF-WKR-C0000005',(select id from departments where slug='frontend-development'),'member','active');

-- The local harness re-grants EXECUTE on every function after migrations run (real Supabase does not). Re-apply the migration so the
-- revokes it makes are what is under test.
\ir ../migrations/20261005000000_support_completion.sql
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
create function tst.sflag(on_ boolean) returns void language sql as $$ select set_config('ctf.support_rpc', case when on_ then 'on' else 'off' end, true) $$;
create function tst.notes(uid uuid, like_ text) returns int language sql as $$ select count(*)::int from public.notifications where user_id = uid and kind = 'support' and title like like_ $$;
create function tst.keys_of(j jsonb) returns text language sql as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(j) k $$;
grant execute on all functions in schema tst to authenticated, service_role;

-- setup: two connected projects, tickets from each --------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select register_support_source('Portfolio site', tst.hash('key-one'), 'ctfs_ab');
select register_support_source('Other site', tst.hash('key-two'), 'ctfs_cd');
reset role; set local role service_role; select tst.as_service();
select * from support_intake(tst.hash('key-one'), 'order-77', 'cust-9', 'Ada', 'Cannot log in', 'I get an error', 'account', 'high');
select * from support_intake(tst.hash('key-two'), 'order-77', 'cust-1', 'Bo', 'Other project ticket', 'x', 'bug', 'normal');
reset role;
insert into ids select 'tk1', id from support_tickets where external_ref = 'order-77' and source_id = (select id from support_sources where name = 'Portfolio site');
insert into ids select 'tk2', id from support_tickets where external_ref = 'order-77' and source_id = (select id from support_sources where name = 'Other site');
insert into ids select 'src1', id from support_sources where name = 'Portfolio site';
insert into ids select 'src2', id from support_sources where name = 'Other site';

-- 1. The customer's view ----------------------------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select tst.expect_true((select tst.keys_of(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'ticket') = 'can_rate,can_reply,created_at,rating,ref,resolved_at,status,subject'), 'the customer sees exactly these ticket fields and no others');
select tst.expect_true((select support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages' = '[]'::jsonb), 'a new ticket has no messages yet');
select tst.expect_true((select support_ticket_view(tst.hash('forged'), 'order-77') is null), 'a wrong key finds nothing (and does not say whether the ticket exists)');
select tst.expect_true((select support_ticket_view(tst.hash('key-one'), 'nope') is null), 'an unknown reference finds nothing');
select tst.expect_true((select support_ticket_view(tst.hash('key-one'), 'order-77') -> 'ticket' ->> 'ref' <> support_ticket_view(tst.hash('key-two'), 'order-77') -> 'ticket' ->> 'ref'), 'the same reference under another project is another ticket');
reset role; set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select assign_ticket(tst.id('tk1'), '00000000-0000-0000-0000-0000000000d1');
select reply_to_ticket(tst.id('tk1'), 'INTERNAL-ONLY: customer is on the watch list', 'internal');
select reply_to_ticket(tst.id('tk1'), 'Hello Ada, we are looking into it.', 'public');
reset role; set local role service_role; select tst.as_service();
select tst.expect_true((select jsonb_array_length(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages') = 1 and support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages' -> 0 ->> 'from' = 'support'), 'the customer sees the public reply and nothing internal');
select tst.expect_true((select tst.keys_of(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages' -> 0) = 'at,body,from,id'), 'a message carries only its id, sender, text and time');
select tst.expect_true((select support_ticket_view(tst.hash('key-one'), 'order-77')::text not like '%INTERNAL-ONLY%' and support_ticket_view(tst.hash('key-one'), 'order-77')::text not like '%assignee%' and support_ticket_view(tst.hash('key-one'), 'order-77')::text not like '%escalat%'), 'no internal note, assignee or escalation reaches the customer');
select tst.expect_true((select support_customer_status('assigned') = 'open' and support_customer_status('escalated') = 'in_progress' and support_customer_status('in_progress') = 'in_progress' and support_customer_status('resolved') = 'resolved' and support_customer_status('waiting_for_customer') = 'waiting_for_customer'), 'internal statuses are shown to customers as open, in progress, waiting, resolved or closed');

-- 2. Customer replies and ratings ------------------------------------------------------------------------------------------------------------
select tst.expect_error($$select support_customer_reply(tst.hash('key-one'), 'order-77', '   ')$$, 'Write something', 'an empty reply is refused');
select tst.expect_error($$select support_customer_reply(tst.hash('forged'), 'order-77', 'hi')$$, 'Ticket not found', 'a reply with a wrong key is refused');
select support_customer_reply(tst.hash('key-one'), 'order-77', 'Thank you, it still fails.');
select tst.expect_true((select jsonb_array_length(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages') = 2 and support_ticket_view(tst.hash('key-one'), 'order-77') -> 'messages' -> 1 ->> 'from' = 'customer'), 'a customer reply is recorded as the customer''s');
select tst.expect_error($$select support_customer_rating(tst.hash('key-one'), 'order-77', 5)$$, 'once it is resolved', 'a ticket cannot be rated before it is resolved (it used to do nothing, silently)');
reset role; set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select set_ticket_status(tst.id('tk1'), 'resolved');
reset role; set local role service_role; select tst.as_service();
select tst.expect_true((select (support_ticket_view(tst.hash('key-one'), 'order-77') -> 'ticket' ->> 'can_rate')::boolean), 'a resolved ticket can be rated');
select tst.expect_error($$select support_customer_rating(tst.hash('key-one'), 'order-77', 9)$$, 'Rating must be 1 to 5', 'a rating outside 1 to 5 is refused');
select tst.expect_error($$select support_customer_rating(tst.hash('forged'), 'order-77', 4)$$, 'Ticket not found', 'a rating with a wrong key is refused');
select support_customer_rating(tst.hash('key-one'), 'order-77', 4, '  fast reply  ');
select tst.expect_true((select rating = 4 and rating_note = 'fast reply' from support_tickets where id = tst.id('tk1')), 'the rating and trimmed note are stored');
select tst.expect_error($$select support_customer_rating(tst.hash('key-one'), 'order-77', 1)$$, 'already been rated', 'a ticket is rated once, so a rating cannot be overwritten');
select tst.expect_true((select not (support_ticket_view(tst.hash('key-one'), 'order-77') -> 'ticket' ->> 'can_rate')::boolean), 'and the customer is told it can no longer be rated');
select support_customer_reply(tst.hash('key-one'), 'order-77', 'Actually it broke again.');
select tst.expect_true((select status = 'in_progress' and resolved_at is null from support_tickets where id = tst.id('tk1')), 'a reply to a resolved ticket reopens it');
reset role; select tst.sflag(true); update support_tickets set status = 'closed' where id = tst.id('tk2'); select tst.sflag(false);
set local role service_role; select tst.as_service();
select tst.expect_error($$select support_customer_reply(tst.hash('key-two'), 'order-77', 'hello?')$$, 'is closed', 'a closed ticket does not take replies');
select tst.expect_true((select not (support_ticket_view(tst.hash('key-two'), 'order-77') -> 'ticket' ->> 'can_reply')::boolean), 'and the customer is told so');
reset role;

-- 3. Attachments ---------------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select escalate_ticket(tst.id('tk1'), 'devops', 'Please check the login service');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'support-attachments', tst.id('tk1')::text || '/' || n, o from (values ('shot.png', '00000000-0000-0000-0000-0000000000d1'::uuid), ('invoice.pdf', '00000000-0000-0000-0000-0000000000d1'::uuid), ('theirs.png', '00000000-0000-0000-0000-0000000000d2'::uuid), ('devops.txt', '00000000-0000-0000-0000-0000000000b1'::uuid), ('devops-public.txt', '00000000-0000-0000-0000-0000000000b1'::uuid), ('virus.exe', '00000000-0000-0000-0000-0000000000d1'::uuid)) v(n, o);
insert into storage.objects (bucket_id, name, owner) values ('support-attachments', tst.id('tk2')::text || '/other.png', '00000000-0000-0000-0000-0000000000d1');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
insert into ids select 'att_internal', support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/shot.png', 'Screenshot.png', 'image/png', 2048);
insert into ids select 'att_public', support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/invoice.pdf', 'Invoice.pdf', 'application/pdf', 4096, 'public');
select tst.expect_true((select count(*) = 2 from support_attachments where ticket_id = tst.id('tk1')), 'an agent can attach internal and public files');
select tst.expect_true((select count(*) = 2 from support_messages where ticket_id = tst.id('tk1') and body like 'Attachment added:%' and visibility = 'internal'), 'each attachment is noted in the internal history, never to the customer');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/shot.png', 'Again.png', 'image/png', 10)$$, 'duplicate key', 'a file cannot be registered twice');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk2')::text || '/other.png', 'Other.png', 'image/png', 10)$$, 'not in this ticket', 'a file from another ticket''s folder cannot be attached here');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/never-uploaded.png', 'Ghost.png', 'image/png', 10)$$, 'upload was not found', 'a path with no upload behind it is refused');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/theirs.png', 'Theirs.png', 'image/png', 10)$$, 'upload was not found', 'someone else''s upload cannot be claimed');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/virus.exe', 'virus.exe', 'application/x-msdownload', 10)$$, 'mime_type', 'only the allowed file types are accepted');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), '../../etc/passwd', 'x', 'image/png', 10)$$, 'not in this ticket', 'a path trick is refused');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/shot.png', 'x', 'image/png', 10, 'secret')$$, 'Visibility must be', 'visibility is internal or public');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/devops.txt', 'x', 'text/plain', 10)$$, 'Ticket not found', 'a worker with no access to the ticket cannot attach to it');
select tst.expect_count($$select 1 from support_attachments$$, 0, 'and cannot list its attachments');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/devops.txt', 'notes.txt', 'text/plain', 300);
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/devops-public.txt', 'notes2.txt', 'text/plain', 300, 'public')$$, 'Only Customer Service can share', 'the team a ticket was escalated to can attach internally but cannot share files with the customer');
select tst.expect_count($$select 1 from support_attachments where ticket_id = tst.id('tk1')$$, 3, 'the technical team sees the attachments of a ticket escalated to it');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'support-attachments', tst.id('tk1')::text || '/bulk' || g || '.png', '00000000-0000-0000-0000-0000000000d1' from generate_series(1, 18) g;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
do $$ declare g int; begin for g in 1..17 loop perform support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/bulk' || g || '.png', 'bulk' || g || '.png', 'image/png', 10); end loop; end $$;
select tst.expect_error($$select support_add_attachment(tst.id('tk1'), tst.id('tk1')::text || '/bulk18.png', 'bulk18.png', 'image/png', 10)$$, 'at most 20', 'a ticket holds at most 20 attachments');
select tst.expect_error($$insert into support_attachments (ticket_id, path, file_name, mime_type, size_bytes) values (tst.id('tk1'), 'x/y', 'y', 'image/png', 1)$$, 'permission denied', 'attachments cannot be inserted directly');
reset role;
select tst.expect_error($$update support_attachments set visibility = 'public'$$, 'support workflow', 'nor changed around the workflow (an internal file cannot be quietly made public)');
select tst.expect_error($$delete from support_attachments$$, 'support workflow', 'nor deleted around the workflow');
select tst.sflag(true);
select tst.expect_error($$delete from support_attachments$$, 'cannot be deleted', 'and not even the workflow deletes evidence');
select tst.sflag(false);
set local role service_role; select tst.as_service();
select tst.expect_true((select jsonb_array_length(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'attachments') = 1 and support_ticket_view(tst.hash('key-one'), 'order-77') -> 'attachments' -> 0 ->> 'name' = 'Invoice.pdf'), 'the customer sees only the file that was shared with them');
select tst.expect_true((select tst.keys_of(support_ticket_view(tst.hash('key-one'), 'order-77') -> 'attachments' -> 0) = 'id,mime_type,name,size_bytes'), 'and only its name, type and size (never the storage path)');
select tst.expect_true((select support_attachment_path(tst.hash('key-one'), 'order-77', tst.id('att_public')) ->> 'path' = tst.id('tk1')::text || '/invoice.pdf'), 'the customer endpoint can resolve a shared file');
select tst.expect_true((select support_attachment_path(tst.hash('key-one'), 'order-77', tst.id('att_internal')) is null), 'but never an internal one');
select tst.expect_true((select support_attachment_path(tst.hash('key-two'), 'order-77', tst.id('att_public')) is null), 'nor a file of another project''s ticket');
select tst.expect_true((select support_attachment_path(tst.hash('forged'), 'order-77', tst.id('att_public')) is null), 'nor with a wrong key');
reset role;
select tst.expect_true((select count(*) = 2 and bool_and(cmd in ('SELECT', 'INSERT')) from pg_policies where tablename = 'objects' and policyname like 'support attachments%'), 'the bucket has read and add policies only: no update, no delete');
select tst.expect_true((select not public and file_size_limit = 10485760 from storage.buckets where id = 'support-attachments'), 'the bucket is private with a 10 MB limit');

-- 4. Tickets and incidents -------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'mp', monitor_register_project('Portfolio site', 'portfolio', 'web', null);
insert into ids select 'inc', monitor_open_incident(tst.id('mp'), 'Login service down', 'high');
reset role;
create temp table inc_ref as select ref from monitor_incidents where id = tst.id('inc'); grant select on inc_ref to authenticated;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_error($$select support_link_incident(tst.id('tk1'), (select ref from inc_ref))$$, 'No incident with that reference', 'a Customer Service agent who cannot see the incident cannot link it');
select tst.expect_error($$select support_link_incident(tst.id('tk1'), 'INC-999999')$$, 'No incident with that reference', 'a reference that does not exist gives the same answer, so references cannot be probed');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$select support_link_incident(tst.id('tk1'), (select ref from inc_ref))$$, 'Ticket not found', 'someone with no access to the ticket cannot link anything to it');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select support_link_incident(tst.id('tk1'), lower((select ref from inc_ref)));
select support_link_incident(tst.id('tk1'), (select ref from inc_ref));
select tst.expect_true((select count(*) = 1 from support_messages where ticket_id = tst.id('tk1') and body like 'Linked to incident INC-%'), 'a DevOps engineer on an escalated ticket can link it (any letter case), once, with one note');
select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_true((select jsonb_array_length(support_ticket_incident_links(tst.id('tk1'))) = 1 and tst.keys_of(support_ticket_incident_links(tst.id('tk1')) -> 0) = 'id,linked_at,project,ref,severity,status'), 'Customer Service sees the linked incident''s reference, severity, status and project');
select tst.expect_true((select support_ticket_incident_links(tst.id('tk1'))::text not like '%Login service down%'), 'but not its title, notes or root cause');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_error($$select support_ticket_incident_links(tst.id('tk1'))$$, 'Ticket not found', 'the links are hidden from people with no access to the ticket');
select tst.expect_error($$select 1 from support_ticket_incidents$$, 'permission denied', 'the link table cannot be read directly');
reset role;

-- 5. The sweep: what is going wrong, said once ----------------------------------------------------------------------------------------------------
set local role service_role; select tst.as_service();
select * from support_intake(tst.hash('key-one'), 'late-1', 'c', 'n', 'Unassigned and a bit old', 'd', 'bug', 'normal');
select * from support_intake(tst.hash('key-one'), 'late-2', 'c', 'n', 'Overdue first reply', 'd', 'bug', 'normal');
select * from support_intake(tst.hash('key-one'), 'late-3', 'c', 'n', 'Overdue twice over', 'd', 'bug', 'normal');
select * from support_intake(tst.hash('key-one'), 'late-4', 'c', 'n', 'Waiting on the customer', 'd', 'bug', 'normal');
reset role;
insert into ids select 'late' || n, id from (select substr(external_ref, 6)::int n, id from support_tickets where external_ref like 'late-%') q;
select tst.sflag(true);
update support_tickets set created_at = now() - interval '20 minutes' where id = tst.id('late1');
update support_tickets set created_at = now() - interval '25 hours', due_at = now() - interval '1 hour', assignee_id = '00000000-0000-0000-0000-0000000000d2', status = 'assigned' where id = tst.id('late2');
update support_tickets set created_at = now() - interval '100 hours', due_at = now() - interval '60 hours' where id = tst.id('late3');
update support_tickets set created_at = now() - interval '100 hours', due_at = now() - interval '60 hours', status = 'waiting_for_customer' where id = tst.id('late4');
select tst.sflag(false);
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_error($$select support_sweep()$$, 'Only a Customer Service lead', 'an ordinary agent cannot run the sweep');
reset role; set local role service_role; select tst.as_service();
create temp table sw1 as select support_sweep() as r;
select tst.expect_true((select (r ->> 'overdue_notified')::int = 2 and (r ->> 'overdue_escalated')::int = 1 and (r ->> 'unassigned_notified')::int = 2 from sw1), 'two tickets are past their first-reply target, one by twice as much, and two have waited unassigned');
reset role;
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d3', 'A customer is still waiting for a first reply') = 2, 'the lead is told about each overdue ticket');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d2', 'A customer is still waiting for a first reply') = 1, 'the assignee is told about theirs');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d1', 'A customer is still waiting%') = 0, 'agents who do not hold the ticket are not');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000a1', 'A customer has waited twice the target for a first reply') = 1, 'twice the target brings in the Main Admin');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d3', 'A customer has waited twice%') = 0, 'and only the Main Admin');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d3', 'A ticket has had nobody assigned for 15 minutes') = 2, 'the lead is told about tickets nobody has taken');
select tst.expect_true((select count(*) = 0 from support_notified where ticket_id = tst.id('late4')), 'a ticket waiting on the customer is never reported as late');
select tst.expect_true((select count(*) = 0 from support_notified where ticket_id = tst.id('tk1') and dedupe_key like 'overdue%'), 'nor one that has already had its first reply');
set local role service_role; select tst.as_service();
select tst.expect_true((select (support_sweep() ->> 'overdue_notified')::int = 0 and (support_sweep() ->> 'unassigned_notified')::int = 0 from (select 1) q), 'running it again tells nobody twice');
reset role; set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select monitor_set_incident_status(tst.id('inc'), 'acknowledged'); select monitor_set_incident_status(tst.id('inc'), 'resolved', 'Connection pool was exhausted.');
reset role; set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_true((select (support_sweep() ->> 'incident_resolved_notified')::int = 1), 'a lead can run it; when a linked incident is resolved, the ticket''s people are told to update the customer');
select tst.expect_true((select (support_sweep() ->> 'incident_resolved_notified')::int = 0), 'once');
reset role;
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d1', 'The incident behind a ticket is resolved') = 1, 'the assignee heard about it');

-- 6. Shifts and workload ---------------------------------------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_error($$select support_add_shift('00000000-0000-0000-0000-0000000000d1', now() - interval '1 hour', now() + interval '1 hour')$$, 'Only a Customer Service lead', 'an agent cannot set shifts');
select tst.expect_error($$select support_workload()$$, 'Only a Customer Service lead', 'nor see the team''s workload (ratings and response times are about people)');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
insert into ids select 'sh1', support_add_shift('00000000-0000-0000-0000-0000000000d1', now() - interval '1 hour', now() + interval '1 hour', '  morning cover  ');
select tst.expect_true((select note = 'morning cover' from support_shifts where id = tst.id('sh1')), 'a lead sets a shift (note trimmed)');
select tst.expect_error($$select support_add_shift('00000000-0000-0000-0000-0000000000d1', now(), now() + interval '2 hours')$$, 'overlaps', 'a person cannot have two overlapping shifts');
select tst.expect_error($$select support_add_shift('00000000-0000-0000-0000-0000000000d2', now(), now() + interval '25 hours')$$, 'at most 24 hours', 'a shift lasts at most a day');
select tst.expect_error($$select support_add_shift('00000000-0000-0000-0000-0000000000d2', now(), now() - interval '1 hour')$$, 'end after it starts', 'and ends after it starts');
select tst.expect_error($$select support_add_shift('00000000-0000-0000-0000-0000000000f1', now(), now() + interval '1 hour')$$, 'not on the Customer Service team', 'only the Customer Service team can be rostered');
select support_add_shift('00000000-0000-0000-0000-0000000000d2', now() + interval '20 hours', now() + interval '28 hours');
select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select tst.expect_count($$select 1 from support_shifts$$, 2, 'the support team sees the roster');
select tst.expect_true((select jsonb_array_length(support_roster()) = 2 and tst.keys_of(support_roster() -> 0) = 'ends_at,id,name,note,on_now,starts_at,user_id'), 'and the roster function adds names and an on-now flag');
select tst.expect_true((select (support_roster() -> 0 ->> 'on_now')::boolean and not (support_roster() -> 1 ->> 'on_now')::boolean), 'the shift that covers this moment is marked as on now');
select tst.expect_true((select jsonb_array_length(support_roster(now() + interval '30 hours', now() + interval '40 hours')) = 0), 'a window with no shifts is empty');
select tst.expect_error($$select support_delete_shift(tst.id('sh1'))$$, 'Only a Customer Service lead', 'but cannot change it');
select tst.as_user('00000000-0000-0000-0000-0000000000f1');
select tst.expect_count($$select 1 from support_shifts$$, 0, 'other staff do not see it');
select tst.expect_error($$select support_roster()$$, 'Only the Customer Service team', 'nor read it through the roster function');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
create temp table wl as select support_workload() as w; grant select on wl to authenticated;
select tst.expect_true((select (w ->> 'unassigned')::int = 2 and jsonb_array_length(w -> 'people') = 3 from wl), 'the lead sees two unassigned tickets and the three-person team');
select tst.expect_true((select p ->> 'open' = '1' and p ->> 'overdue' = '1' and (p ->> 'on_shift')::boolean = false from wl, jsonb_array_elements(w -> 'people') p where p ->> 'name' = 'Agent Two'), 'Agent Two has one open ticket, one of them overdue, and is not on shift');
select tst.expect_true((select p ->> 'open' = '1' and p ->> 'overdue' = '0' and (p ->> 'on_shift')::boolean from wl, jsonb_array_elements(w -> 'people') p where p ->> 'user_id' = '00000000-0000-0000-0000-0000000000d1'), 'the other agent has one open ticket and is on shift now');
select tst.expect_true((select tst.keys_of(p) = 'avg_first_response_minutes_7d,avg_rating_30d,name,on_shift,open,overdue,resolved_7d,user_id,waiting_for_customer' from wl, jsonb_array_elements(w -> 'people') p limit 1), 'a workload row has exactly these fields');
select support_delete_shift(tst.id('sh1'));
select tst.expect_error($$select support_delete_shift(tst.id('sh1'))$$, 'Shift not found', 'a deleted shift is gone');
reset role;

-- 7. Callbacks to the connected project's backend --------------------------------------------------------------------------------------------------
select tst.expect_true((select bool_and(support_callback_url_ok(u) = ok) from (values
   ('https://api.shopfront.dev/support/hook', true), ('https://shop.co.uk:443/x?a=1', true), ('https://a.b.c.example-shop.com:8443/', true), ('HTTPS://Shop.Dev/Hook', true),
   ('http://shop.dev/hook', false), ('https://127.0.0.1/hook', false), ('https://169.254.169.254/latest/meta-data', false), ('https://10.0.0.5/x', false), ('https://[::1]/x', false),
   ('https://localhost/hook', false), ('https://db.internal/hook', false), ('https://printer.local/hook', false), ('https://box.lan/x', false), ('https://shop/hook', false),
   ('https://user:pw@shop.dev/hook', false), ('https://shop.dev:8080/hook', false), ('https://shop.dev:22/hook', false), ('https://shop.dev/hook#frag', false),
   ('ftp://shop.dev/x', false), ('https://shop.dev/ a b', false), ('', false), ('https://' || repeat('a', 300) || '.dev/', false)) v(u, ok)), 'the address check accepts normal https domains and refuses http, IP addresses, internal names, odd ports, credentials and fragments');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_error($$select support_set_callback(tst.id('src1'), 'https://api.shopfront.dev/support/callbacks/TOKEN123')$$, 'Only a Main Admin', 'a support lead cannot set a callback');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$select support_set_callback(tst.id('src1'), 'http://api.shopfront.dev/x')$$, 'must be an https', 'a plain http address is refused');
select tst.expect_error($$select support_set_callback(tst.id('src1'), 'https://169.254.169.254/latest/meta-data')$$, 'must be an https', 'a cloud metadata address is refused');
select tst.expect_error($$select support_set_callback(gen_random_uuid(), 'https://api.shopfront.dev/x')$$, 'not found', 'an unknown project is refused');
create temp table cb1 as select support_set_callback(tst.id('src1'), 'https://api.shopfront.dev/support/callbacks/TOKEN123') as secret; grant select on cb1 to authenticated, service_role;
select tst.expect_true((select secret ~ '^[0-9a-f]{64}$' from cb1), 'the secret is 64 random hex characters, returned to the Main Admin');
create temp table cb2 as select support_set_callback(tst.id('src1'), 'https://api.shopfront.dev/support/callbacks/TOKEN123') as secret; grant select on cb2 to authenticated, service_role;
select tst.expect_true((select cb1.secret <> cb2.secret from cb1, cb2), 'setting it again rotates the secret');
select tst.expect_error($$select secret from support_callbacks$$, 'permission denied', 'no signed-in user, not even the Main Admin, can read the secret back');
select tst.expect_error($$select * from support_callback_events$$, 'permission denied', 'nor the raw delivery queue');
reset role;
select tst.expect_true((select secret = (select secret from cb2) and rotated_at is not null from support_callbacks where source_id = tst.id('src1')), 'only the latest secret is kept');
select tst.expect_true((select count(*) = 2 from audit_logs where action = 'support.callback.set'), 'setting a callback is audited');
select tst.expect_true((select not exists (select 1 from audit_logs where action = 'support.callback.set' and (metadata::text like '%TOKEN123%' or metadata::text like '%' || (select secret from cb2) || '%'))), 'and the audit entry holds neither the path nor the secret');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_true((select o ->> 'host' = 'api.shopfront.dev' and (o ->> 'configured')::boolean from jsonb_array_elements(support_callbacks_overview()) o where o ->> 'name' = 'Portfolio site'), 'a lead sees which projects have a callback, by host');
select tst.expect_true((select support_callbacks_overview()::text not like '%TOKEN123%' and support_callbacks_overview()::text not like '%' || (select secret from cb2) || '%'), 'never the path or the secret');
select tst.expect_true((select not (o ->> 'configured')::boolean from jsonb_array_elements(support_callbacks_overview()) o where o ->> 'name' = 'Other site'), 'and which have none');
select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_error($$select support_callbacks_overview()$$, 'Only a Customer Service lead', 'ordinary agents do not see callback settings');
reset role;

-- events: what is queued, and what is NOT
set local role service_role; select tst.as_service();
select * from support_intake(tst.hash('key-one'), 'cb-1', 'c', 'n', 'Callback ticket', 'd', 'bug', 'normal');
select * from support_intake(tst.hash('key-two'), 'cb-2', 'c', 'n', 'Ticket from a project with no callback', 'd', 'bug', 'normal');
reset role;
insert into ids select 'cb1t', id from support_tickets where external_ref = 'cb-1';
insert into ids select 'cb2t', id from support_tickets where external_ref = 'cb-2';
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select assign_ticket(tst.id('cb1t'), '00000000-0000-0000-0000-0000000000d1');
select reply_to_ticket(tst.id('cb1t'), 'SECRET-INTERNAL-NOTE: this customer is on the watch list', 'internal');
select assign_ticket(tst.id('cb2t'), '00000000-0000-0000-0000-0000000000d1'); select reply_to_ticket(tst.id('cb2t'), 'Hello from support.', 'public');
reset role;
select tst.expect_count($$select 1 from support_callback_events where ticket_id = tst.id('cb1t')$$, 0, 'assigning a ticket, or an internal note, tells the customer''s system nothing');
select tst.expect_count($$select 1 from support_callback_events where ticket_id = tst.id('cb2t')$$, 0, 'a project with no callback gets nothing queued');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select reply_to_ticket(tst.id('cb1t'), 'Hello, we are on it.', 'public');
reset role;
select tst.expect_true((select array_agg(event order by event) = array['ticket.acknowledged', 'ticket.reply', 'ticket.status'] from support_callback_events where ticket_id = tst.id('cb1t')), 'the first public reply queues: acknowledged, the reply, and the status change');
select tst.expect_true((select tst.keys_of(payload) = 'event,external_ref,message,occurred_at,sequence,ticket_ref' and tst.keys_of(payload -> 'message') = 'at,body' and payload ->> 'external_ref' = 'cb-1' and payload -> 'message' ->> 'body' = 'Hello, we are on it.' from support_callback_events where ticket_id = tst.id('cb1t') and event = 'ticket.reply'), 'a reply payload carries only the references, a sequence number and the public text (no status that could be stale)');
select tst.expect_true((select tst.keys_of(payload) = 'acknowledged_at,event,external_ref,occurred_at,sequence,ticket_ref' from support_callback_events where ticket_id = tst.id('cb1t') and event = 'ticket.acknowledged'), 'an acknowledgement payload is similarly small');
select tst.expect_true((select tst.keys_of(payload) = 'event,external_ref,occurred_at,sequence,status,ticket_ref' and payload ->> 'status' = 'in_progress' from support_callback_events where ticket_id = tst.id('cb1t') and event = 'ticket.status'), 'and a status payload alone carries the customer-safe status');
select tst.expect_true((select count(distinct (payload ->> 'sequence')::bigint) = 3 and bool_and((payload ->> 'sequence')::bigint = seq) and (select array_agg(event order by seq) from support_callback_events where ticket_id = tst.id('cb1t')) is not null from support_callback_events where ticket_id = tst.id('cb1t')), 'every event has its own increasing sequence number, the same in the payload and the log');
select tst.expect_true((select count(*) = 0 from support_callback_events where payload::text like '%SECRET-INTERNAL-NOTE%' or payload::text like '%watch list%' or payload::text like '%assignee%' or payload::text like '%escalat%'), 'no internal note, assignee or escalation is ever in a payload');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select escalate_ticket(tst.id('cb1t'), 'backend-development', 'Needs a backend look at it');
reset role;
select tst.expect_count($$select 1 from support_callback_events where ticket_id = tst.id('cb1t')$$, 3, 'escalating internally is not news to the customer, so no event');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select set_ticket_status(tst.id('cb1t'), 'waiting_for_customer');
reset role;
select tst.expect_count($$select 1 from support_callback_events where ticket_id = tst.id('cb1t') and event = 'ticket.status'$$, 2, 'a change the customer would notice is');

-- delivery: claim, lease, report, back off, give up
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$select * from support_callbacks_claim(10)$$, 'permission denied', 'a signed-in user cannot claim deliveries, even the Main Admin');
select tst.expect_error($$select support_callback_report(gen_random_uuid(), true, 200, null)$$, 'permission denied', 'nor report one');
reset role; set local role service_role; select tst.as_service();
create temp table claimed as select * from support_callbacks_claim(10); grant select on claimed to authenticated;
select tst.expect_true((select count(*) = 4 and bool_and(url = 'https://api.shopfront.dev/support/callbacks/TOKEN123' and secret = (select secret from cb2)) from claimed), 'the worker claims the four due deliveries with the address and the secret');
select tst.expect_count($$select 1 from support_callbacks_claim(10)$$, 0, 'a claimed delivery is leased: a second worker gets nothing');
reset role; select count(*) from support_callback_events; update support_callback_events set next_attempt_at = now() - interval '1 second' where status = 'delivering';
set local role service_role; select tst.as_service();
select tst.expect_count($$select 1 from support_callbacks_claim(10)$$, 4, 'if the worker died, the lease expires and they are claimed again');
create temp table ev as select event_id, event from support_callbacks_claim(1) limit 0;
select support_callback_report((select id from support_callback_events where event = 'ticket.reply' and ticket_id = tst.id('cb1t')), true, 200, null);
select tst.expect_true((select status = 'delivered' and delivered_at is not null and attempts = 1 and last_http = 200 from support_callback_events where event = 'ticket.reply' and ticket_id = tst.id('cb1t')), 'a successful delivery is recorded');
select support_callback_report((select id from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')), false, 503, 'Service Unavailable');
select tst.expect_true((select status = 'pending' and attempts = 1 and next_attempt_at = now() + interval '1 minute' and last_http = 503 and last_error = 'Service Unavailable' from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')), 'a failure is retried in a minute');
select support_callback_report((select id from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')), false, 500, 'late report');
select tst.expect_true((select attempts = 1 and last_error = 'Service Unavailable' from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')), 'a report for a delivery that is no longer in flight changes nothing');
reset role;
do $$ declare e uuid; waits interval[] := '{}'; n interval; i int;
begin
  select id into e from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t');
  waits := waits || interval '1 minute';
  for i in 2..5 loop
    update support_callback_events set status = 'delivering' where id = e;
    perform support_callback_report(e, false, 500, 'still failing');
    select next_attempt_at - now() into n from support_callback_events where id = e;
    waits := waits || n;
  end loop;
  if waits <> array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours', interval '12 hours'] then raise exception 'FAIL the back-off schedule is %', waits; end if;
  raise notice 'PASS retries back off 1 min, 5 min, 30 min, 2 h, 12 h';
  update support_callback_events set status = 'delivering' where id = e;
  perform support_callback_report(e, false, 500, 'still failing');
end $$;
select tst.expect_true((select status = 'dead' and attempts = 6 from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')), 'after six failed tries a delivery is given up on');
select tst.expect_true(tst.notes('00000000-0000-0000-0000-0000000000d3', 'A callback to Portfolio site was given up on') = 1, 'and the lead is told, once');
create temp table dead_ev as select id from support_callback_events where status = 'dead'; create temp table delivered_ev as select id from support_callback_events where status = 'delivered' limit 1; grant select on dead_ev, delivered_ev to authenticated;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.expect_error($$select support_callback_retry((select id from dead_ev))$$, 'Only a Customer Service lead', 'an agent cannot retry a dead delivery');
select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_true((select jsonb_array_length(support_callback_events_list(tst.id('src1'), 10)) >= 4 and tst.keys_of(support_callback_events_list(tst.id('src1'), 10) -> 0) = 'attempts,created_at,delivered_at,event,id,last_error,last_http,status,ticket_ref'), 'a lead sees the delivery log without payloads');
select support_callback_retry((select id from dead_ev));
reset role;
select tst.expect_true((select status = 'pending' and attempts = 0 and last_error is null from support_callback_events where event = 'ticket.acknowledged' and ticket_id = tst.id('cb1t')) , 'a lead can retry it');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_error($$select support_callback_retry((select id from delivered_ev))$$, 'given up on', 'only a given-up delivery can be retried');
reset role;

-- turning it off, and housekeeping
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d3');
select tst.expect_error($$select support_clear_callback(tst.id('src1'))$$, 'Only a Main Admin', 'a lead cannot remove a callback');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select support_clear_callback(tst.id('src1'));
reset role;
select tst.expect_count($$select 1 from support_callbacks where source_id = tst.id('src1')$$, 0, 'removing a callback deletes its address and secret');
select tst.expect_true((select count(*) = 0 from support_callback_events where source_id = tst.id('src1') and status in ('pending', 'delivering')), 'and abandons what was still queued');
select tst.expect_true((select count(*) = 1 from audit_logs where action = 'support.callback.clear' and severity = 'warning'), 'removal is audited as a warning');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select reply_to_ticket(tst.id('cb1t'), 'Another public reply after removal.', 'public');
reset role;
select tst.expect_true((select count(*) = 0 from support_callback_events where created_at >= now() and payload::text like '%after removal%'), 'with no callback, nothing new is queued');
insert into support_callbacks (source_id, url, secret) values (tst.id('src1'), 'https://api.shopfront.dev/hook', repeat('a', 64));
update support_callbacks set enabled = false where source_id = tst.id('src1');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select reply_to_ticket(tst.id('cb1t'), 'A reply while the callback is switched off.', 'public');
reset role;
select tst.expect_true((select count(*) = 0 from support_callback_events where payload::text like '%switched off%'), 'a disabled callback queues nothing');
insert into support_callback_events (source_id, ticket_id, event, payload, status, created_at, delivered_at) values (tst.id('src1'), tst.id('cb1t'), 'ticket.status', '{}', 'delivered', now() - interval '31 days', now() - interval '31 days'), (tst.id('src1'), tst.id('cb1t'), 'ticket.status', '{}', 'dead', now() - interval '31 days', null), (tst.id('src1'), tst.id('cb1t'), 'ticket.status', '{}', 'delivered', now() - interval '1 day', now() - interval '1 day');
set local role service_role; select tst.as_service();
select tst.expect_true((select support_callbacks_purge() = 2), 'finished deliveries older than 30 days are purged, recent ones kept');
reset role;

-- 8. Structure ----------------------------------------------------------------------------------------------------------------------------------------
select tst.expect_true((select not has_function_privilege('authenticated', 'support_callbacks_claim(integer)', 'execute') and not has_function_privilege('authenticated', 'support_callback_report(uuid, boolean, integer, text)', 'execute')
   and not has_function_privilege('authenticated', 'support_ticket_view(text, text)', 'execute') and not has_function_privilege('authenticated', 'support_customer_reply(text, text, text)', 'execute')
   and not has_function_privilege('authenticated', 'support_customer_rating(text, text, integer, text)', 'execute') and not has_function_privilege('authenticated', 'support_attachment_path(text, text, uuid)', 'execute')
   and not has_function_privilege('anon', 'support_ticket_view(text, text)', 'execute') and not has_function_privilege('anon', 'support_sweep()', 'execute')), 'only the service role can run the customer-facing and delivery functions; nobody signed in or anonymous can');
select tst.expect_true((select has_function_privilege('service_role', 'support_callbacks_claim(integer)', 'execute') and has_function_privilege('service_role', 'support_ticket_view(text, text)', 'execute') and has_function_privilege('service_role', 'support_sweep()', 'execute')), 'and the service role can');
select tst.expect_true((select not has_function_privilege('authenticated', 'support_notify_once(uuid, text, uuid[], text, text)', 'execute') and not has_function_privilege('authenticated', 'support_enqueue_callback(uuid, text, jsonb)', 'execute')), 'the internal plumbing is not callable from outside');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$insert into support_callbacks (source_id, url, secret) values (tst.id('src1'), 'https://x.dev', repeat('a', 64))$$, 'permission denied', 'no signed-in user writes a callback table directly');
select tst.expect_error($$insert into support_shifts (user_id, starts_at, ends_at) values ('00000000-0000-0000-0000-0000000000d1', now(), now() + interval '1 hour')$$, 'permission denied', 'nor the roster');
select tst.expect_error($$insert into support_notified (ticket_id, dedupe_key) values (tst.id('tk1'), 'x')$$, 'permission denied', 'nor the notification record');
select tst.expect_error($$select * from support_notified$$, 'permission denied', 'nor read it');
reset role;
rollback;
