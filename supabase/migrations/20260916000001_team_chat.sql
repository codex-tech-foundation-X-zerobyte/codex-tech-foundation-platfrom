-- Team Chat. Internal only for this pass (workers/managers/superadmin) —
-- clients do NOT get channels here; a client-facing "Messages" surface, if
-- built later, needs its own separate, explicitly-scoped table per
-- docs/REALTIME.md's authorization rule. Realtime is used for live delivery
-- (see the frontend chat service) — this migration is just the schema + RLS.

create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('project', 'dm', 'group')),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists chat_channels_project_unique on public.chat_channels(project_id) where type = 'project';

create table if not exists public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null,
  reply_to_id uuid references public.chat_messages(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists chat_messages_channel_created_idx on public.chat_messages(channel_id, created_at desc);

alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;

-- Membership check as its own function so it's not duplicated across every
-- policy below (and so the chat_channel_members table itself doesn't need a
-- self-referential recursive policy — this runs as security definer instead).
create or replace function public.is_channel_member(p_channel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_channel_members where channel_id = p_channel_id and user_id = auth.uid())
    or public.current_role() = 'superadmin'
$$;

create policy "members read their channels" on public.chat_channels for select using (public.is_channel_member(id));
create policy "workers create channels" on public.chat_channels for insert with check (public.current_role() in ('worker', 'manager', 'superadmin'));

create policy "members read channel membership" on public.chat_channel_members for select using (public.is_channel_member(channel_id));
create policy "workers add channel members" on public.chat_channel_members for insert with check (
  public.current_role() in ('worker', 'manager', 'superadmin')
);
create policy "members leave channels" on public.chat_channel_members for delete using (user_id = auth.uid() or public.current_role() = 'superadmin');

create policy "members read channel messages" on public.chat_messages for select using (public.is_channel_member(channel_id));
create policy "members send channel messages" on public.chat_messages for insert with check (
  public.is_channel_member(channel_id) and sender_id = auth.uid()
);
create policy "senders edit own messages" on public.chat_messages for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- Auto-provision a project channel + seed membership from project_members
-- whenever a project is created / a member is added, so chat doesn't need
-- a separate manual "create channel" step for the common case.
create or replace function public.provision_project_channel() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_channel_id uuid;
begin
  insert into public.chat_channels (type, project_id, name) values ('project', new.id, new.name)
    on conflict (project_id) where type = 'project' do nothing;
  if new.owner_id is not null then
    select id into v_channel_id from public.chat_channels where project_id = new.id and type = 'project';
    insert into public.chat_channel_members (channel_id, user_id) values (v_channel_id, new.owner_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists on_project_created_channel on public.projects;
create trigger on_project_created_channel after insert on public.projects
  for each row execute procedure public.provision_project_channel();

create or replace function public.sync_project_channel_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_channel_id uuid;
begin
  select id into v_channel_id from public.chat_channels where project_id = new.project_id and type = 'project';
  if v_channel_id is not null then
    insert into public.chat_channel_members (channel_id, user_id) values (v_channel_id, new.user_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists on_project_member_added_channel on public.project_members;
create trigger on_project_member_added_channel after insert on public.project_members
  for each row execute procedure public.sync_project_channel_membership();

-- Enable Realtime replication for live message delivery.
alter publication supabase_realtime add table public.chat_messages;
