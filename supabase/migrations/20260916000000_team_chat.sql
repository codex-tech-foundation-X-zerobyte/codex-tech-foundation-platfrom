-- Team Chat (§23/§38 of the brief), built per the design in
-- /docs/REALTIME.md. Membership is derived from the SAME tables that
-- already gate REST access (project_members, client_projects/client_users)
-- rather than a second, parallel membership model — per that doc's own
-- stated design principle. Only DMs need an explicit membership table,
-- since a DM has no other table to derive membership from.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'project', 'dm')),
  name text,                                    -- team/project channels only; null for dm
  project_id uuid references public.projects(id) on delete cascade,  -- required when kind='project', null otherwise
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint channels_project_kind_consistent check (
    (kind = 'project' and project_id is not null) or (kind <> 'project' and project_id is null)
  )
);
create unique index channels_one_per_project on public.channels(project_id) where kind = 'project';

-- Only used for DM membership (2 rows per DM channel). Team/project channel
-- membership is computed on the fly by can_access_channel() below — see
-- that function for why duplicating it into rows here would just be a
-- second source of truth to keep in sync.
create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null default '',
  attachment_path text,   -- storage key in the 'chat-attachments' bucket, if any
  attachment_name text,
  attachment_size bigint,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,  -- soft delete: row stays (so "message deleted" renders in place), body/attachment cleared by the service
  constraint messages_body_or_attachment check (body <> '' or attachment_path is not null or deleted_at is not null)
);
create index messages_channel_idx on public.messages(channel_id, created_at desc);

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;

-- Single source of truth for "can this user see/post in this channel".
-- Every RLS policy on channels/channel_members/messages calls this instead
-- of re-deriving membership logic per policy.
create or replace function public.can_access_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ch record;
begin
  select kind, project_id into ch from public.channels where id = p_channel_id;
  if ch is null then
    return false;
  end if;

  if ch.kind = 'team' then
    return public.current_role() in ('worker', 'manager', 'superadmin');
  end if;

  if ch.kind = 'dm' then
    return exists (select 1 from public.channel_members cm where cm.channel_id = p_channel_id and cm.user_id = auth.uid());
  end if;

  if ch.kind = 'project' then
    if public.current_role() in ('manager', 'superadmin') then
      return true;
    end if;
    -- Worker: project owner or an explicit project_members row.
    if exists (
      select 1 from public.projects p
      where p.id = ch.project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid())
    ) then
      return true;
    end if;
    if exists (select 1 from public.project_members m where m.project_id = ch.project_id and m.user_id = auth.uid()) then
      return true;
    end if;
    -- Client: an active client_users row for a client with client_projects access.
    if exists (
      select 1 from public.client_users cu
      join public.client_projects cp on cp.client_id = cu.client_id
      where cu.user_id = auth.uid() and cu.status = 'active' and cp.project_id = ch.project_id
    ) then
      return true;
    end if;
    return false;
  end if;

  return false;
end;
$$;

create policy "members read channels" on public.channels for select using (public.can_access_channel(id));
-- DMs are an internal team feature (§39 of the brief: clients must not
-- automatically receive internal team channels) — Chat has no client-facing
-- route in this pass, and this policy is the real boundary regardless of
-- what the UI exposes. Every branch requires a team role, including DM creation.
create policy "team creates channels and dms" on public.channels for insert to authenticated with check (
  public.current_role() in ('worker', 'manager', 'superadmin')
);
create policy "creator or admin archives a channel" on public.channels for update to authenticated using (
  created_by = auth.uid() or public.current_role() in ('manager', 'superadmin')
) with check (
  created_by = auth.uid() or public.current_role() in ('manager', 'superadmin')
);

create policy "members read their dm membership" on public.channel_members for select using (public.can_access_channel(channel_id));
-- Self-insert only — an ordinary insert on this table can never add a row
-- for someone else. That means openDirectMessage() (chat.ts) cannot use a
-- plain insert to seed BOTH participants of a new DM from one session; it
-- calls create_dm_channel() below instead, which is the one place both
-- rows get created, deliberately, inside a security-definer function.
create policy "self-insert into a dm" on public.channel_members for insert to authenticated with check (
  user_id = auth.uid() and public.current_role() in ('worker', 'manager', 'superadmin')
);

-- Atomically creates (or returns the existing) 1:1 DM channel between the
-- caller and another team member. Security-definer because seeding BOTH
-- channel_members rows from one session is exactly what the plain
-- self-insert-only RLS policy above is designed to prevent for anyone
-- else — this function is the single, deliberate, narrow exception: it
-- only ever inserts the caller (auth.uid()) and one explicitly-named other
-- team member, never an arbitrary third party, and only after checking
-- both are team roles.
create or replace function public.create_dm_channel(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if other_user_id = me then
    raise exception 'Cannot start a DM with yourself.';
  end if;
  if public.current_role() not in ('worker', 'manager', 'superadmin') then
    raise exception 'Not authorized.';
  end if;
  if (select role from public.profiles where id = other_user_id) not in ('worker', 'manager', 'superadmin') then
    raise exception 'That account is not available for direct messages.';
  end if;

  select cm1.channel_id into existing_id
  from public.channel_members cm1
  join public.channel_members cm2 on cm2.channel_id = cm1.channel_id
  join public.channels c on c.id = cm1.channel_id
  where c.kind = 'dm' and cm1.user_id = me and cm2.user_id = other_user_id;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.channels (kind, created_by) values ('dm', me) returning id into new_id;
  insert into public.channel_members (channel_id, user_id) values (new_id, me), (new_id, other_user_id);
  return new_id;
end;
$$;

revoke all on function public.create_dm_channel(uuid) from public;
grant execute on function public.create_dm_channel(uuid) to authenticated;

create policy "members read channel messages" on public.messages for select using (public.can_access_channel(channel_id));
create policy "members post messages" on public.messages for insert to authenticated with check (
  public.can_access_channel(channel_id) and author_id = auth.uid()
);
create policy "authors edit or delete their own messages" on public.messages for update to authenticated using (
  author_id = auth.uid() or public.current_role() in ('manager', 'superadmin')
) with check (
  author_id = auth.uid() or public.current_role() in ('manager', 'superadmin')
);

-- Attachments: private bucket, same access rule as the channel itself. Kept
-- separate from `resources` (Team Files) rather than reusing that bucket —
-- chat attachments are message-scoped and should be deletable/retained on a
-- different lifecycle than the team file library; conflating the two would
-- make "delete this message" and "delete this team file" the same
-- operation, which they should not be.
insert into storage.buckets (id, name, public) values ('chat-attachments', 'chat-attachments', false) on conflict (id) do nothing;
create policy "chat attachment access follows channel access" on storage.objects for select to authenticated using (
  bucket_id = 'chat-attachments' and public.can_access_channel((string_to_array(name, '/'))[1]::uuid)
);
create policy "chat attachment upload follows channel access" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-attachments' and public.can_access_channel((string_to_array(name, '/'))[1]::uuid)
);

-- Enable Realtime on messages so clients can subscribe to new/edited/
-- deleted rows per channel (see src/lib/realtime.ts). Membership is still
-- enforced by the RLS policies above — Realtime respects RLS on postgres_changes.
alter publication supabase_realtime add table public.messages;

-- BUG FOUND WHILE BUILDING THIS (pre-existing, not introduced by Chat):
-- `profiles` SELECT RLS has only ever been `id = auth.uid() or
-- current_role() = 'superadmin'` (from the very first migration). That
-- means a worker or manager viewing another team member's name — in
-- AdminWorkers.tsx's listWorkers() (which joins worker_profiles to
-- profiles for display_name), and now in Chat for message authors/DM
-- targets — has been silently getting an empty name for every row but
-- their own, unless the viewer happened to be superadmin. This has nothing
-- to do with Chat specifically; it would have surfaced the moment anyone
-- but a superadmin opened the Workers list. Fixed additively: team members
-- can see each other's basic profile row. Client profiles remain
-- invisible to this policy (both viewer AND target must be
-- worker/manager/superadmin), so this does not expose client identities
-- beyond what `clients`/`client_users` already do.
create policy "team views colleague profiles" on public.profiles for select using (
  public.current_role() in ('worker', 'manager', 'superadmin')
  and role in ('worker', 'manager', 'superadmin')
);
