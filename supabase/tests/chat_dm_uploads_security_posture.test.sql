-- Behavioural tests for migration 20260925000000_chat_dm_uploads_security_posture.sql
-- Run on a database with ALL migrations applied, as a superuser (uses SET ROLE; everything is rolled back):
--   psql "$DATABASE_URL" -f supabase/tests/chat_dm_uploads_security_posture.test.sql
-- (The storage.* checks need Supabase's storage schema, which a hosted project or `supabase start` provides.)
\set ON_ERROR_STOP on
begin;
create schema tst;
create function tst.as_user(u text) returns void language plpgsql as $$ begin execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u, true); end $$;
create function tst.as_super() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function tst.check(name text, ok boolean) returns void language plpgsql as $$ begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
create function tst.denied(name text, sql text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'NOT BLOCKED: %', name;
  exception when insufficient_privilege or check_violation or raise_exception or foreign_key_violation or invalid_parameter_value then
    if sqlerrm like 'NOT BLOCKED%' then raise; end if; raise notice 'PASS  % (%)', name, left(sqlerrm, 60); end; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x'), ('00000000-0000-0000-0000-0000000000b1','w1@x'), ('00000000-0000-0000-0000-0000000000b2','w2@x'),
 ('00000000-0000-0000-0000-0000000000b3','w3@x'), ('00000000-0000-0000-0000-0000000000d1','mgr_full@x'), ('00000000-0000-0000-0000-0000000000d2','mgr_none@x'),
 ('00000000-0000-0000-0000-0000000000c1','client1@x'), ('00000000-0000-0000-0000-0000000000c2','client2@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3');
update public.profiles set role='manager' where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
update public.profiles set role='client' where id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2');
insert into public.roles (id, name) values ('50000000-0000-0000-0000-000000000001','test_manager');
insert into public.role_permissions (role_id, permission_id) select '50000000-0000-0000-0000-000000000001', id from public.permissions where key in ('projects.view','projects.update');
insert into public.user_roles (user_id, role_id) values ('00000000-0000-0000-0000-0000000000d1','50000000-0000-0000-0000-000000000001');
insert into public.clients (id, organization) values ('10000000-0000-0000-0000-00000000000a','Acme'),('10000000-0000-0000-0000-00000000000b','Globex');
insert into public.client_users (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-0000000000c2','10000000-0000-0000-0000-00000000000b');
insert into public.projects (id, name, owner_id, client_account_id) values ('20000000-0000-0000-0000-000000000001','Acme site','00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000a');
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated; grant usage on schema storage to authenticated;

-- ═══ 1. The channel list (the "General x5" bug) ═══
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.check('1a General exists once, and the worker is a member of it',
  (select count(*) from public.chat_channels c where c.name='General' and exists (select 1 from public.chat_channel_members m where m.channel_id=c.id and m.user_id='00000000-0000-0000-0000-0000000000b1')) = 1);
select tst.check('1b REPRODUCTION: the old query (members -> channel) returns one row per MEMBER, not per channel',
  (select count(*) from public.chat_channel_members m where m.channel_id = (select id from public.chat_channels where name='General')) >= 5);
select tst.check('1c the fixed query (channel joined to MY membership row) returns exactly one row',
  (select count(*) from public.chat_channels c join public.chat_channel_members m on m.channel_id=c.id where m.user_id='00000000-0000-0000-0000-0000000000b1' and c.name='General') = 1);

-- ═══ 2. Private direct messages ═══
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');
create temp table dm as select public.get_or_create_dm('00000000-0000-0000-0000-0000000000b2') as id;
grant select on dm to authenticated;
select tst.check('2a a worker can open a DM with another team member', (select id from dm) is not null);
select tst.check('2b it is a dm channel with exactly the two members', (select count(*) from public.chat_channel_members where channel_id=(select id from dm)) = 2 and (select type from public.chat_channels where id=(select id from dm)) = 'dm');
select tst.check('2c asking again returns the SAME channel (no duplicate DMs)', public.get_or_create_dm('00000000-0000-0000-0000-0000000000b2') = (select id from dm));
insert into public.chat_messages (channel_id, sender_id, body) values ((select id from dm),'00000000-0000-0000-0000-0000000000b1','secret hello');
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.check('2d the other person gets the SAME channel when they open it from their side', public.get_or_create_dm('00000000-0000-0000-0000-0000000000b1') = (select id from dm));
select tst.check('2e ...and can read the message', (select count(*) from public.chat_messages where body='secret hello') = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.check('2f a third worker cannot see the DM channel or its messages', (select count(*) from public.chat_channels where type='dm') = 0 and (select count(*) from public.chat_messages where body='secret hello') = 0);
select tst.denied('2g a third worker cannot add THEMSELVES to someone else''s DM',
  format($q$insert into public.chat_channel_members (channel_id,user_id) values (%L,'00000000-0000-0000-0000-0000000000b3')$q$, (select id from dm)));
select tst.denied('2h ...nor post into it',
  format($q$insert into public.chat_messages (channel_id,sender_id,body) values (%L,'00000000-0000-0000-0000-0000000000b3','intruder')$q$, (select id from dm)));
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.check('2i a SUPERADMIN cannot read private DMs either', (select count(*) from public.chat_messages where body='secret hello') = 0 and (select count(*) from public.chat_channels where type='dm') = 0);
select tst.check('2j ...but still oversees group channels (General is visible)', (select count(*) from public.chat_channels where name='General') = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.denied('2k a client cannot start a DM', $q$select public.get_or_create_dm('00000000-0000-0000-0000-0000000000b1')$q$);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.denied('2l a worker cannot DM a client', $q$select public.get_or_create_dm('00000000-0000-0000-0000-0000000000c1')$q$);
select tst.denied('2m ...or themselves', $q$select public.get_or_create_dm('00000000-0000-0000-0000-0000000000b1')$q$);
select tst.denied('2n ...cannot add a client to General',
  $q$insert into public.chat_channel_members (channel_id,user_id) select id,'00000000-0000-0000-0000-0000000000c1' from public.chat_channels where name='General'$q$);
select tst.denied('2o ...and cannot invent a channel', $q$insert into public.chat_channels (type,name) values ('group','sneaky')$q$);

-- ═══ 3. Attachments ═══
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into public.chat_messages (channel_id, sender_id, body, attachments) select id,'00000000-0000-0000-0000-0000000000b1','', '[{"path":"p","name":"a.png","mime":"image/png","size":10}]'::jsonb from public.chat_channels where name='General';
select tst.check('3a a message may be attachment-only (empty text)', (select count(*) from public.chat_messages where attachments <> '[]'::jsonb) = 1);
select tst.denied('3b a message with neither text nor attachment is rejected',
  $q$insert into public.chat_messages (channel_id,sender_id,body) select id,'00000000-0000-0000-0000-0000000000b1','   ' from public.chat_channels where name='General'$q$);
select tst.denied('3c more than 6 attachments is rejected',
  $q$insert into public.chat_messages (channel_id,sender_id,body,attachments) select id,'00000000-0000-0000-0000-0000000000b1','x', '[1,2,3,4,5,6,7]'::jsonb from public.chat_channels where name='General'$q$);

-- ═══ 4. chat-media storage ═══
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');
create temp table ids as select (select id from public.chat_channels where name='General') as general, (select id from dm) as dm;
grant select on ids to authenticated;
insert into storage.objects (bucket_id, name, owner) select 'chat-media', general||'/00000000-0000-0000-0000-0000000000b1/1-photo.png', '00000000-0000-0000-0000-0000000000b1' from ids;
select tst.check('4a a channel member can upload into their own folder of that channel', (select count(*) from storage.objects where bucket_id='chat-media') = 1);
select tst.denied('4b ...but not into someone else''s folder',
  format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media', %L, '00000000-0000-0000-0000-0000000000b1')$q$, (select general from ids)||'/00000000-0000-0000-0000-0000000000b2/1-x.png'));
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b3');   -- b3 is NOT in the b1<->b2 DM
select tst.denied('4c a non-member cannot upload into someone else''s DM (even into their own folder)',
  format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media', %L, '00000000-0000-0000-0000-0000000000b3')$q$, (select dm from ids)||'/00000000-0000-0000-0000-0000000000b3/1-x.png'));
select tst.denied('4d ...and a path whose first segment is not a channel id is rejected',
  $q$insert into storage.objects (bucket_id,name,owner) values ('chat-media','not-a-uuid/00000000-0000-0000-0000-0000000000b3/x.png','00000000-0000-0000-0000-0000000000b3')$q$);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.check('4e a client cannot read chat media', (select count(*) from storage.objects where bucket_id='chat-media') = 0);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.check('4f a team member in the channel can read it', (select count(*) from storage.objects where bucket_id='chat-media') = 1);

-- ═══ 5. Project files: upload + download ═══
select tst.as_super();
insert into storage.objects (bucket_id, name) values ('private-project-files','20000000-0000-0000-0000-000000000001/seed-spec.pdf');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.check('5a a LINKED client (via client_users, not projects.client_id) can read their project file', (select count(*) from storage.objects where bucket_id='private-project-files') = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c2');
select tst.check('5b a different client cannot', (select count(*) from storage.objects where bucket_id='private-project-files') = 0);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d1');
insert into storage.objects (bucket_id, name, owner) values ('private-project-files','20000000-0000-0000-0000-000000000001/1-mgr.png','00000000-0000-0000-0000-0000000000d1');
insert into public.project_files (project_id, uploaded_by, name, storage_path) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','mgr.png','20000000-0000-0000-0000-000000000001/1-mgr.png');
select tst.check('5c a manager WITH projects.update can upload (file + record) and see it', (select count(*) from public.project_files) = 1);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d2');
select tst.denied('5d a manager WITHOUT it still cannot upload',
  $q$insert into storage.objects (bucket_id,name,owner) values ('private-project-files','20000000-0000-0000-0000-000000000001/1-no.png','00000000-0000-0000-0000-0000000000d2')$q$);
select tst.denied('5e ...nor create the file record',
  $q$insert into public.project_files (project_id,uploaded_by,name,storage_path) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d2','n','p')$q$);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.denied('5f a client cannot upload to a project',
  $q$insert into storage.objects (bucket_id,name,owner) values ('private-project-files','20000000-0000-0000-0000-000000000001/1-c.png','00000000-0000-0000-0000-0000000000c1')$q$);

-- ═══ 6. Security posture report ═══
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.check('6a superadmin gets a full report', (select public.security_posture() ?& array['tables_without_rls','tables_rls_without_policies','public_buckets','definer_functions_without_search_path','accounts','activity','policy_count']));
select tst.check('6b report numbers are sane (tables > 0, policies > 0, 1 superadmin)', (select (r->>'table_count')::int > 0 and (r->>'policy_count')::int > 0 and (r->'accounts'->>'superadmins')::int = 1 from (select public.security_posture() r) x));
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.denied('6c a worker cannot read it', $q$select public.security_posture()$q$);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000d1');
select tst.denied('6d nor can a manager', $q$select public.security_posture()$q$);
select tst.as_super(); select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.denied('6e nor a client', $q$select public.security_posture()$q$);
rollback;
