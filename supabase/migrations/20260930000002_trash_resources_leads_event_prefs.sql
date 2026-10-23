-- Four things, one migration (they share the same tables):
--   1. Resources: files could be listed but not opened by everyone who could see the row (storage policy mismatch).
--   2. Trash: deleting is no longer permanent for 30 days (restore + 5-minute undo for whoever deleted it).
--   3. Leads: private internal notes for the team.
--   4. Notifications: a "kind" on every notification and per-event in-app / push preferences.

-- ─── 1. Resources ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.resources add column if not exists mime_type text;
alter table public.resources add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0);

-- Before: storage reads were allowed to role worker/superadmin only, while the table policy also lets a MANAGER see rows
-- (permission resources.view) and scopes workers to their department. So a manager saw a file listed and could never open
-- it, and any worker who learned an object path could read another department's file.
-- Now: a file can be read exactly when its row can — the subquery runs as the caller, so the table's RLS decides.
drop policy if exists "workers read resources storage" on storage.objects;
drop policy if exists "resources storage readable with their row" on storage.objects;
create policy "resources storage readable with their row" on storage.objects for select to authenticated using (
  bucket_id = 'resources' and exists (select 1 from public.resources r where r.storage_path = name)
);

-- ─── 2. Leads: internal notes ────────────────────────────────────────────────────────────────────────────────────────
alter table public.leads add column if not exists internal_notes text not null default '';

-- ─── 3. Trash ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- A BEFORE DELETE trigger copies the row (as JSON) into trash_items before it goes. Restoring re-inserts that copy.
-- Covered: blog posts, leads, careers (with their applications), case studies, team profiles, applications, resources.
-- Deliberately NOT covered: projects, workers and clients — deleting those removes whole trees of related rows that a
-- one-row snapshot cannot bring back, so they keep their typed-confirmation hard delete instead.
create table if not exists public.trash_items (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  row_id        uuid not null,
  label         text not null default '',
  snapshot      jsonb not null,
  children      jsonb not null default '{}'::jsonb,        -- rows that vanished with it (a career's applications)
  storage_refs  jsonb not null default '[]'::jsonb,        -- [{bucket, path}] files kept until the item is purged
  deleted_by    uuid references auth.users(id) on delete set null,
  deleted_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);
create index if not exists trash_items_row_idx on public.trash_items (table_name, row_id, deleted_at desc);
create index if not exists trash_items_expiry_idx on public.trash_items (expires_at);
alter table public.trash_items enable row level security;
revoke insert, update on public.trash_items from anon, authenticated;
drop policy if exists "main admin reads trash" on public.trash_items;
create policy "main admin reads trash" on public.trash_items for select using (public."current_role"() = 'superadmin');
drop policy if exists "main admin empties trash" on public.trash_items;
create policy "main admin empties trash" on public.trash_items for delete using (public."current_role"() = 'superadmin');

create or replace function public.capture_trash() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j    jsonb := to_jsonb(old);
  kids jsonb := '{}'::jsonb;
  refs jsonb := '[]'::jsonb;
begin
  -- A cascade (deleting a career deletes its applications) runs one trigger level deeper than a direct delete. Those rows
  -- are captured inside their parent below, not as separate trash items.
  if pg_trigger_depth() > 1 then return old; end if;

  if tg_table_name = 'applications' and j->>'resume_path' is not null then
    refs := jsonb_build_array(jsonb_build_object('bucket', 'applications', 'path', j->>'resume_path'));
  elsif tg_table_name = 'resources' and j->>'storage_path' is not null then
    refs := jsonb_build_array(jsonb_build_object('bucket', 'resources', 'path', j->>'storage_path'));
  elsif tg_table_name = 'team_profiles' and j->>'photo_path' is not null then
    refs := jsonb_build_array(jsonb_build_object('bucket', 'public-content', 'path', j->>'photo_path'));
  elsif tg_table_name = 'careers' then
    kids := jsonb_build_object('applications', coalesce((select jsonb_agg(to_jsonb(a)) from public.applications a where a.career_id = old.id), '[]'::jsonb));
    refs := coalesce((select jsonb_agg(jsonb_build_object('bucket', 'applications', 'path', a.resume_path)) from public.applications a where a.career_id = old.id and a.resume_path is not null), '[]'::jsonb);
  end if;

  insert into public.trash_items (table_name, row_id, label, snapshot, children, storage_refs, deleted_by)
  values (
    tg_table_name, old.id,
    left(coalesce(nullif(j->>'title', ''), nullif(j->>'name', ''), nullif(j->>'display_name', ''), nullif(j->>'email', ''), j->>'id'), 200),
    j, kids, refs, auth.uid()
  );
  return old;
end;
$$;
revoke all on function public.capture_trash() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['blog_posts', 'leads', 'careers', 'case_studies', 'team_profiles', 'applications', 'resources'] loop
    execute format('drop trigger if exists capture_trash on public.%I', t);
    execute format('create trigger capture_trash before delete on public.%I for each row execute procedure public.capture_trash()', t);
  end loop;
end $$;

-- Restoring: the Main Admin any time; whoever deleted it for 5 minutes (that is the "Undo" button). Runs as the owner, so
-- it re-inserts regardless of RLS — the permission check below is the gate.
create or replace function public.restore_trash_items(p_ids uuid[]) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t   public.trash_items;
  n   integer := 0;
  me  uuid := auth.uid();
  is_admin boolean := public."current_role"() = 'superadmin';
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  for t in select * from public.trash_items where id = any (p_ids) order by deleted_at loop
    if not (is_admin or (t.deleted_by = me and t.deleted_at > now() - interval '5 minutes')) then
      raise exception 'Only the Main Admin can restore this now (undo lasts 5 minutes).' using errcode = '42501';
    end if;
    if t.table_name not in ('blog_posts', 'leads', 'careers', 'case_studies', 'team_profiles', 'applications', 'resources') then
      raise exception 'That item cannot be restored.' using errcode = '22023';
    end if;
    begin
      execute format('insert into public.%I select (jsonb_populate_record(null::public.%I, $1)).*', t.table_name, t.table_name) using t.snapshot;
      if t.children ? 'applications' then
        insert into public.applications select (jsonb_populate_recordset(null::public.applications, t.children->'applications')).*;
      end if;
    exception
      when unique_violation then
        raise exception 'Can''t restore "%": something with the same address, slug or email now exists. Rename or remove that first.', t.label using errcode = '23505';
      when foreign_key_violation then
        raise exception 'Can''t restore "%": something it depended on has since been deleted.', t.label using errcode = '23503';
    end;
    delete from public.trash_items where id = t.id;
    n := n + 1;
  end loop;

  if n > 0 then
    insert into public.audit_logs (actor_user_id, action, resource_type, severity, metadata)
    values (me, 'trash.restored', 'trash_items', 'info', jsonb_build_object('count', n));
  end if;
  return n;
end;
$$;
revoke all on function public.restore_trash_items(uuid[]) from public, anon;
grant execute on function public.restore_trash_items(uuid[]) to authenticated;

-- "Undo" from the list the item was deleted from: restore the most recent trash copy of each of these rows.
create or replace function public.restore_deleted(p_table text, p_ids uuid[]) returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.restore_trash_items(coalesce(array_agg(id), '{}'::uuid[]))
  from (
    select distinct on (row_id) id from public.trash_items
    where table_name = p_table and row_id = any (p_ids)
    order by row_id, deleted_at desc
  ) latest
$$;
revoke all on function public.restore_deleted(text, uuid[]) from public, anon;
grant execute on function public.restore_deleted(text, uuid[]) to authenticated;

-- ─── 4. Per-event notification settings ──────────────────────────────────────────────────────────────────────────────
alter table public.notifications add column if not exists kind text not null default 'general';
alter table public.notification_preferences add column if not exists events jsonb not null default '{}'::jsonb;

-- The existing inserters (assignments, announcements, comments, mentions, meetings, approvals, project updates) write fixed
-- titles, so the category is derived from them in one place. A future inserter can simply set `kind` itself.
create or replace function public.notification_kind(p_title text, p_body text) returns text
language sql
immutable
as $$
  select case
    when p_title like 'You were mentioned on %' then 'mentions'
    when p_body like 'This task %' or p_title like 'Comment on %' or p_title = 'Assigned to you' or p_title like 'Action item from %' then 'tasks'
    when p_title like 'Update on %' or p_title = 'New department assignment' then 'projects'
    when p_title in ('Company announcement', 'Department announcement') then 'announcements'
    when p_title = 'Meeting invitation' then 'meetings'
    when p_title in ('Suspension review needed', 'Suspension decision') then 'approvals'
    else 'general'
  end
$$;

-- Classifies, then drops the notification entirely if this person switched that kind off in-app. (Returning NULL skips the
-- insert, so no row, no badge — and, because the push hand-off is an AFTER INSERT trigger, no push either.)
create or replace function public.apply_notification_prefs() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev jsonb;
begin
  if new.kind = 'general' then new.kind := public.notification_kind(new.title, new.body); end if;
  if new.kind <> 'general' then
    select events -> new.kind into ev from public.notification_preferences where user_id = new.user_id;
    if ev is not null and ev ->> 'in_app' = 'false' then return null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_notification_prefs() from public, anon, authenticated;
drop trigger if exists apply_notification_prefs on public.notifications;
create trigger apply_notification_prefs before insert on public.notifications for each row execute procedure public.apply_notification_prefs();

create or replace function public.set_notification_event_pref(p_kind text, p_channel text, p_enabled boolean) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_kind not in ('chat', 'calls', 'mentions', 'tasks', 'projects', 'announcements', 'meetings', 'approvals') then
    raise exception 'Unknown notification type.' using errcode = '22023';
  end if;
  if p_channel not in ('in_app', 'push') then raise exception 'Unknown channel.' using errcode = '22023'; end if;

  -- A first-ever row must not accidentally switch push OFF for someone who already subscribed a device.
  insert into public.notification_preferences (user_id, push)
  values (auth.uid(), exists (select 1 from public.push_subscriptions where user_id = auth.uid()))
  on conflict (user_id) do nothing;

  update public.notification_preferences
  set events = jsonb_set(coalesce(events, '{}'::jsonb), array[p_kind], coalesce(events -> p_kind, '{}'::jsonb) || jsonb_build_object(p_channel, p_enabled), true),
      updated_at = now()
  where user_id = auth.uid();
end;
$$;
revoke all on function public.set_notification_event_pref(text, text, boolean) from public, anon;
grant execute on function public.set_notification_event_pref(text, text, boolean) to authenticated;
