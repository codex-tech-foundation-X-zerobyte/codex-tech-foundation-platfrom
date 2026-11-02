-- Security audit fixes (October 2026 review). Idempotent and non-destructive.
--
-- 1. user_roles and role_permissions had policies but ROW LEVEL SECURITY WAS NEVER ENABLED on them (the loop in
--    20260912000002 listed `roles` and `permissions` but not these two). With Supabase's default table grants that meant anyone,
--    signed in or not, could read, add and delete role assignments and permission links through the API. has_permission() reads
--    both tables, so this was a privilege-escalation path. Turn RLS on; the existing "admins manage …" policies (Main Admin only)
--    then apply. has_permission()/has_permission_for() are SECURITY DEFINER and are unaffected.
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.user_roles from anon;
revoke all on public.role_permissions from anon;
revoke truncate, references, trigger on public.user_roles from authenticated;
revoke truncate, references, trigger on public.role_permissions from authenticated;

-- 2. sync_department_channels(uuid) re-computes someone's channel membership. Only triggers and migrations call it, but it was
--    executable by anyone through the API (it ignores who is calling). Make it internal. Trigger functions that call it are
--    SECURITY DEFINER, so they keep working.
revoke all on function public.sync_department_channels(uuid) from public, anon, authenticated;

-- 3. A presentation's stage state is written by the presenter's browser, but any signed-in presenter can also write it straight
--    through the API, and every viewer's browser then renders it. In the browser stage the address went into an <iframe> with
--    allow-scripts + allow-same-origin: a `javascript:` address would have run as the Workspace itself for every viewer (a Main
--    Admin included). The app now refuses such addresses when it renders them; this makes the database refuse them too, and caps
--    the state size (the table's own check constraint already limits it to an object under 256 KB).
create or replace function public.presentation_url_ok(p_url text) returns boolean language sql immutable set search_path = public as $$
  select p_url is null or p_url = '' or (
    length(p_url) <= 2000
    and p_url !~ '[[:space:][:cntrl:]]'
    and (p_url ~* '^https://[^/?#@]+([/?#].*)?$' or p_url ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?([/?#].*)?$')
  )
$$;

create or replace function public.guard_presentation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(new.state -> 'url') is not null and jsonb_typeof(new.state -> 'url') <> 'string' then
    raise exception 'A presentation address must be text.' using errcode = '23514';
  end if;
  if not public.presentation_url_ok(new.state ->> 'url') then
    raise exception 'Presentations can only show https:// addresses (http is allowed for localhost).' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- someone presents one thing at a time: starting a new one ends their previous live session
    update public.presentation_sessions set status = 'ended', ended_at = now(), updated_at = now() where presenter_id = new.presenter_id and status = 'live';
    new.status := 'live'; new.ended_at := null; new.state_version := 0; new.started_at := now(); new.updated_at := now();
    return new;
  end if;
  if (new.id, new.presenter_id, new.department_id, new.kind) is distinct from (old.id, old.presenter_id, old.department_id, old.kind) then
    raise exception 'A presentation''s presenter, department and stage type cannot change.' using errcode = '23514';
  end if;
  if old.status = 'ended' and new.status = 'live' then raise exception 'An ended presentation cannot be restarted. Start a new one.' using errcode = '23514'; end if;
  if auth.uid() is not null and auth.uid() <> old.presenter_id and (new.state, new.title, new.visibility) is distinct from (old.state, old.title, old.visibility) then
    raise exception 'Only the presenter controls the stage. A Main Admin can end a presentation.' using errcode = '42501';
  end if;
  if new.state is distinct from old.state then new.state_version := old.state_version + 1; end if;
  if new.status = 'ended' and old.status = 'live' then new.ended_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_presentation on public.presentation_sessions;
create trigger guard_presentation before insert or update on public.presentation_sessions for each row execute function public.guard_presentation();
