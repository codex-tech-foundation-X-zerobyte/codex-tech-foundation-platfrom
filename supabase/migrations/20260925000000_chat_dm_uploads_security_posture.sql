-- Private team chat, working uploads, and a database security posture report.
--
--  1. "General" appeared five times. listMyChannels() read chat_channel_members and embedded the channel, but the policy
--     "members read channel membership" lets you read EVERY membership row of your channels, so a channel with five
--     members came back five times. (Fixed in the frontend too; this migration also merges any genuinely duplicated
--     General channels and makes a second one impossible.)
--  2. Private 1:1 chat: a DM channel per pair of team members, created only through get_or_create_dm(). Direct inserts
--     into chat_channel_members were allowed for ANY worker onto ANY channel (so a worker could add themselves to someone
--     else's DM) — tightened. A superadmin can still oversee group/project channels but can NOT read private DMs.
--  3. Chat attachments (images, video, audio, documents): a private bucket scoped to channel membership.
--  4. Project file uploads: managers holding projects.update could not upload (only worker/superadmin could), and the
--     storage policies still used the old client_id rule so linked clients could not download files.
--  5. security_posture(): a superadmin-only report of the database's own security configuration for the Security monitor.

-- ─── 1. Merge duplicate General channels, then forbid a second ───────────────
do $$
declare keep uuid; dup record;
begin
  select id into keep from public.chat_channels where type = 'group' and name = 'General' order by created_at, id limit 1;
  if keep is not null then
    for dup in select id from public.chat_channels where type = 'group' and name = 'General' and id <> keep loop
      insert into public.chat_channel_members (channel_id, user_id, joined_at)
        select keep, user_id, joined_at from public.chat_channel_members where channel_id = dup.id
        on conflict do nothing;
      update public.chat_messages set channel_id = keep where channel_id = dup.id;
      update public.group_calls set channel_id = keep where channel_id = dup.id;
      delete from public.chat_channels where id = dup.id; -- cascades the now-empty membership rows
    end loop;
  end if;
end $$;
create unique index if not exists chat_general_unique on public.chat_channels (name) where type = 'group' and name = 'General';

-- ─── 2. Private direct messages ──────────────────────────────────────────────
alter table public.chat_channels add column if not exists dm_key text;
create unique index if not exists chat_dm_unique on public.chat_channels (dm_key) where type = 'dm';

-- Superadmin may oversee group and project channels, but a DM is private to its two members.
create or replace function public.is_channel_member(p_channel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_channel_members where channel_id = p_channel_id and user_id = auth.uid())
    or (
      public.current_role() = 'superadmin'
      and not exists (select 1 from public.chat_channels c where c.id = p_channel_id and c.type = 'dm')
    )
$$;

create or replace function public.get_or_create_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_other is null or p_other = me then raise exception 'Choose someone else to message' using errcode = '22023'; end if;
  if public.current_role() not in ('worker', 'manager', 'superadmin') then
    raise exception 'Direct messages are for team members' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_other and role in ('worker', 'manager', 'superadmin')) then
    raise exception 'That person is not a team member' using errcode = '42501';
  end if;

  v_key := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into v_id from public.chat_channels where type = 'dm' and dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (type, name, dm_key) values ('dm', '', v_key)
      on conflict (dm_key) where type = 'dm' do nothing
      returning id into v_id;
    if v_id is null then select id into v_id from public.chat_channels where type = 'dm' and dm_key = v_key; end if; -- lost a race
  end if;
  insert into public.chat_channel_members (channel_id, user_id) values (v_id, me), (v_id, p_other) on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- No client code creates channels or adds members directly (project channels come from triggers, DMs from the function
-- above). Keep the capability narrow instead of "any worker, any channel".
drop policy if exists "workers create channels" on public.chat_channels;
drop policy if exists "superadmin creates group channels" on public.chat_channels;
create policy "superadmin creates group channels" on public.chat_channels
  for insert with check (public.current_role() = 'superadmin' and type = 'group');

drop policy if exists "workers add channel members" on public.chat_channel_members;
drop policy if exists "members add to non-dm channels" on public.chat_channel_members;
create policy "members add to non-dm channels" on public.chat_channel_members
  for insert with check (
    public.is_channel_member(channel_id)
    and not exists (select 1 from public.chat_channels c where c.id = channel_id and c.type = 'dm')
    and exists (select 1 from public.profiles p where p.id = user_id and p.role in ('worker', 'manager', 'superadmin'))
  );

-- A new DM should appear live for the other person.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_channel_members') then
    alter publication supabase_realtime add table public.chat_channel_members;
  end if;
end $$;

-- ─── 3. Chat attachments ─────────────────────────────────────────────────────
alter table public.chat_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.chat_messages drop constraint if exists chat_messages_attachments_check;
alter table public.chat_messages add constraint chat_messages_attachments_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6);
alter table public.chat_messages drop constraint if exists chat_messages_not_empty_check;
alter table public.chat_messages add constraint chat_messages_not_empty_check
  check (length(btrim(body)) > 0 or jsonb_array_length(attachments) > 0);

-- first path segment as a uuid, or NULL if it isn't one (a bad cast inside a policy would abort the whole query)
create or replace function public.uuid_from_path_segment(p_name text, p_index int) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', p_index) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', p_index)::uuid end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (
  'chat-media', 'chat-media', false, 52428800,
  array['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
        'application/json', 'application/msword', 'application/vnd.openxmlformats-officedocument.*', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']
) on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Objects live at  <channel_id>/<uploader_id>/<timestamp>-<safe-name>
drop policy if exists "channel members read chat media" on storage.objects;
create policy "channel members read chat media" on storage.objects for select to authenticated using (
  bucket_id = 'chat-media'
  and public.uuid_from_path_segment(name, 1) is not null
  and public.is_channel_member(public.uuid_from_path_segment(name, 1))
);
drop policy if exists "channel members upload chat media" on storage.objects;
create policy "channel members upload chat media" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-media'
  and public.uuid_from_path_segment(name, 1) is not null
  and public.is_channel_member(public.uuid_from_path_segment(name, 1))
  and split_part(name, '/', 2) = auth.uid()::text -- you can only upload into your own folder
);
drop policy if exists "uploaders delete own chat media" on storage.objects;
create policy "uploaders delete own chat media" on storage.objects for delete to authenticated using (
  bucket_id = 'chat-media' and split_part(name, '/', 2) = auth.uid()::text
);

-- ─── 4. Project file uploads / downloads ─────────────────────────────────────
drop policy if exists "staff upload project files" on public.project_files;
create policy "staff upload project files" on public.project_files for insert with check (
  (public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update'))
  and uploaded_by = auth.uid()
);
drop policy if exists "project files visible to staff and client" on public.project_files;
create policy "project files visible to staff and client" on public.project_files for select using (
  public.current_role() in ('worker', 'superadmin')
  or public.has_permission('projects.view') or public.has_permission('projects.update')
  or uploaded_by = auth.uid()
  or exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid()))
);

-- is_project_client() with a text argument, so a storage path whose first segment isn't a uuid simply yields false.
create or replace function public.is_project_client_text(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_project_client(p_id::uuid) else false end
$$;
revoke all on function public.is_project_client_text(text) from public, anon;
grant execute on function public.is_project_client_text(text) to authenticated;

drop policy if exists "project files isolated by project" on storage.objects;
create policy "project files isolated by project" on storage.objects for select to authenticated using (
  bucket_id = 'private-project-files' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'superadmin')
    or public.has_permission('projects.view') or public.has_permission('projects.update')
    or public.is_project_client_text(split_part(name, '/', 1)) -- linked client accounts (client_users / client_projects)
  )
);
drop policy if exists "project members upload files" on storage.objects;
create policy "project members upload files" on storage.objects for insert to authenticated with check (
  bucket_id = 'private-project-files' and (
    split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid())
    or public.current_role() in ('worker', 'superadmin')
    or public.has_permission('projects.update')
  )
);

-- ─── 5. Security posture report (superadmin only) ────────────────────────────
create or replace function public.security_posture() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if public.current_role() is distinct from 'superadmin' then
    raise exception 'Only a superadmin can view the security posture' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'tables_without_rls', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
    'tables_rls_without_policies', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)),
    'table_count', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')),
    'policy_count', (select count(*) from pg_policies where schemaname = 'public'),
    'public_buckets', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from storage.buckets where public),
    'private_buckets', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from storage.buckets where not public),
    'definer_functions_without_search_path', (
      select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'superadmins', (select count(*) from public.profiles where role = 'superadmin'),
      'workers', (select count(*) from public.profiles where role in ('worker', 'manager')),
      'clients', (select count(*) from public.profiles where role = 'client'),
      'suspended_workers', (select count(*) from public.worker_profiles where status <> 'active'),
      'suspended_clients', (select count(*) from public.client_users where status <> 'active'),
      'must_change_password', (
        (select count(*) from public.worker_profiles where must_change_password)
        + (select count(*) from public.client_users where must_change_password))),
    'activity', jsonb_build_object(
      'failed_logins_24h', (select count(*) from public.audit_logs where action = 'login.failed' and created_at > now() - interval '24 hours'),
      'failed_logins_7d', (select count(*) from public.audit_logs where action = 'login.failed' and created_at > now() - interval '7 days'),
      'warnings_24h', (select count(*) from public.audit_logs where severity = 'warning' and created_at > now() - interval '24 hours'),
      'errors_24h', (select count(*) from public.audit_logs where severity = 'error' and created_at > now() - interval '24 hours'),
      'events_7d', (select count(*) from public.audit_logs where created_at > now() - interval '7 days'))
  ) into result;
  return result;
end $$;
revoke all on function public.security_posture() from public, anon;
grant execute on function public.security_posture() to authenticated;
