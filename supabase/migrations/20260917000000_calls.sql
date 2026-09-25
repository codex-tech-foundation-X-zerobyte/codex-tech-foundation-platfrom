-- Voice/Video Calls (§25/§40 of the brief). WebRTC peer connections,
-- Supabase Realtime Broadcast for SDP/ICE signaling (ephemeral — not
-- persisted to Postgres, unlike chat messages). See /docs/REALTIME.md for
-- what is and is not protected here — read that before assuming broadcast
-- signaling has the same RLS guarantee as everything else in this schema.
--
-- Design choice: every call belongs to a channel (team/project/dm) —
-- there is no standalone "call anyone" mode. This means call access reuses
-- can_access_channel() from the Chat migration wholesale; there is no new
-- membership model to keep in sync with it. A call started in a DM is a
-- 1:1 call; a call started in a team/project channel is open to anyone who
-- can access that channel (mesh WebRTC — see docs/REALTIME.md for why this
-- doesn't scale past a small group, matching the brief's own
-- "~8-10 internal users, add an SFU later" framing).

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  kind text not null check (kind in ('voice', 'video')),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index calls_channel_active_idx on public.calls(channel_id) where status = 'active';

create table public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'joined' check (status in ('joined', 'left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (call_id, user_id)
);

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;

create policy "members read calls in their channels" on public.calls for select using (public.can_access_channel(channel_id));
create policy "members start calls in their channels" on public.calls for insert to authenticated with check (public.can_access_channel(channel_id) and created_by = auth.uid());
create policy "members end calls in their channels" on public.calls for update to authenticated using (public.can_access_channel(channel_id)) with check (public.can_access_channel(channel_id));

create policy "members read call participants" on public.call_participants for select using (
  exists (select 1 from public.calls c where c.id = call_id and public.can_access_channel(c.channel_id))
);
-- Join a call: self-insert only, and only into a call whose channel you can
-- access — you cannot add anyone else to a call, and you cannot join a
-- call in a channel you have no access to (guessing a call_id UUID is not
-- enough on its own; this check still applies).
create policy "members join calls in their channels" on public.call_participants for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.calls c where c.id = call_id and public.can_access_channel(c.channel_id))
);
create policy "members leave their own call row" on public.call_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
