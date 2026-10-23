-- Group calls are a genuinely different mechanism from the 1:1 `calls`
-- table (fixed caller/callee, ring/accept/decline) — this is a "join a
-- room" model instead, scoped to a chat channel (so anyone who can see
-- General, or a project channel, can start/join a call in it). Kept as a
-- separate table rather than overloading `calls`, since conflating
-- "ring a specific person" with "join an ongoing room" into one schema
-- would make both harder to reason about.
--
-- Mesh topology (every participant connects directly to every other
-- participant) — reuses the same "don't persist signaling" approach as 1:1
-- calls via a per-call broadcast channel. Mesh does not scale indefinitely;
-- see docs/REALTIME.md for the practical participant ceiling this implies.
-- An SFU would replace this table's role in a future pass, not extend it.

create table if not exists public.group_calls (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  started_by uuid not null references auth.users(id),
  type text not null check (type in ('voice', 'video')),
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists group_calls_channel_active_idx on public.group_calls(channel_id) where status = 'active';

create table if not exists public.group_call_participants (
  call_id uuid not null references public.group_calls(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index if not exists group_call_participants_active_idx on public.group_call_participants(call_id) where left_at is null;

alter table public.group_calls enable row level security;
alter table public.group_call_participants enable row level security;

-- Reuses is_channel_member() from 20260916000001_team_chat.sql — the same
-- membership check that already governs who can read/post in the channel
-- governs who can start or join a call in it. No separate authorization
-- concept invented here.
create policy "channel members read group calls" on public.group_calls for select using (
  public.is_channel_member(channel_id)
);
create policy "channel members start group calls" on public.group_calls for insert with check (
  public.is_channel_member(channel_id) and started_by = auth.uid()
);
create policy "channel members end group calls" on public.group_calls for update using (
  public.is_channel_member(channel_id)
) with check (
  public.is_channel_member(channel_id)
);

create policy "channel members read participants" on public.group_call_participants for select using (
  exists (select 1 from public.group_calls gc where gc.id = call_id and public.is_channel_member(gc.channel_id))
);
create policy "channel members join calls" on public.group_call_participants for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.group_calls gc where gc.id = call_id and public.is_channel_member(gc.channel_id))
);
-- Leaving (setting left_at) is the only self-update allowed — never someone
-- else's row.
create policy "participants update own row" on public.group_call_participants for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);

create trigger audit_group_call_started after insert on public.group_calls
  for each row execute procedure public.audit_row_change('group_call.started');
