-- General Chat: a single, canonical, always-existing 'group' channel that
-- every internal (worker/manager/superadmin) account is auto-joined to —
-- so a newly logged-in worker can open Chat -> General immediately, with no
-- project required. Clients are never added here, matching the isolation
-- rule already documented in docs/REALTIME.md.

insert into public.chat_channels (type, name)
select 'group', 'General'
where not exists (select 1 from public.chat_channels where type = 'group' and name = 'General');

-- Backfill: add every existing internal account to General.
insert into public.chat_channel_members (channel_id, user_id)
select c.id, p.id
from public.chat_channels c
cross join public.profiles p
where c.type = 'group' and c.name = 'General' and p.role in ('worker', 'manager', 'superadmin')
on conflict do nothing;

-- Going forward: auto-join whenever a profile's role is set to an internal
-- role — reuses the same trigger point as sync_user_role (profiles role
-- insert/update) rather than adding a second, separately-timed trigger.
create or replace function public.join_general_channel() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_general_id uuid;
begin
  if new.role not in ('worker', 'manager', 'superadmin') then
    return new;
  end if;
  select id into v_general_id from public.chat_channels where type = 'group' and name = 'General' limit 1;
  if v_general_id is not null then
    insert into public.chat_channel_members (channel_id, user_id) values (v_general_id, new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_join_general on public.profiles;
create trigger on_profile_role_join_general
  after insert or update of role on public.profiles
  for each row execute procedure public.join_general_channel();
