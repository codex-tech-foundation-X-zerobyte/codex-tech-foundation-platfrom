-- Push notifications that reach people when the app is closed.
--
-- Shape: every event worth a push becomes a row (notifications already is one; chat messages, ringing calls and group
-- calls are rows too). An AFTER INSERT trigger hands the row to the `push-dispatch` edge function through pg_net, and that
-- function delivers a Web Push to each of the recipient's registered devices (push_subscriptions).
--
-- Nothing here can break the write that triggered it: the hand-off is wrapped so a missing extension, an unconfigured
-- project or an unreachable function only means "no push", never a failed message or a failed notification insert.

create extension if not exists pg_net with schema extensions;

-- ─── 1. Delivery settings (set once by the Main Admin, see docs/NOTIFICATIONS.md) ─────────────────────────────────────
-- A single private row. RLS is on with NO policies, so no signed-in user can read the secret; only the service role and
-- the security-definer trigger below can.
create table if not exists public.push_settings (
  id             boolean primary key default true check (id),
  function_url   text not null,
  webhook_secret text not null,
  updated_at     timestamptz not null default now()
);
alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon, authenticated;

-- ─── 2. Devices ──────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.push_subscriptions add column if not exists last_success_at timestamptz;
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ─── 3. The hand-off ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.dispatch_push() returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.push_settings;
begin
  select * into s from public.push_settings where id;
  if not found then return null; end if;               -- push not configured yet: in-app behaviour is unchanged
  perform net.http_post(
    url     := s.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s.webhook_secret),
    body    := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'record', to_jsonb(new))
  );
  return null;
exception when others then
  return null;                                          -- never fail the original insert because of push
end;
$$;
revoke all on function public.dispatch_push() from public, anon, authenticated;

drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification after insert on public.notifications for each row execute procedure public.dispatch_push();

drop trigger if exists push_on_chat_message on public.chat_messages;
create trigger push_on_chat_message after insert on public.chat_messages for each row execute procedure public.dispatch_push();

drop trigger if exists push_on_call on public.calls;
create trigger push_on_call after insert on public.calls for each row when (new.status = 'ringing') execute procedure public.dispatch_push();

drop trigger if exists push_on_group_call on public.group_calls;
create trigger push_on_group_call after insert on public.group_calls for each row when (new.status = 'active') execute procedure public.dispatch_push();

-- ─── 4. A published project update is something people should hear about ─────────────────────────────────────────────
-- Nothing created a notification for it before, so team members and the client only found out by opening the project.
create or replace function public.notify_project_update() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project text;
begin
  -- Fire when an update becomes published: inserted already published, or published later.
  if new.published_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.published_at is not null then return new; end if;

  select name into v_project from public.projects where id = new.project_id;

  insert into public.notifications (user_id, title, body)
  select distinct u.id, 'Update on ' || coalesce(v_project, 'a project'), new.title
  from (
    select pm.user_id as id from public.project_members pm where pm.project_id = new.project_id
    union
    select cu.user_id from public.client_projects cp join public.client_users cu on cu.client_id = cp.client_id
      where cp.project_id = new.project_id and cu.status = 'active'
  ) u
  where u.id is distinct from new.author_id;
  return new;
end;
$$;
revoke all on function public.notify_project_update() from public, anon, authenticated;

drop trigger if exists notify_project_update on public.project_updates;
create trigger notify_project_update after insert or update of published_at on public.project_updates
  for each row execute procedure public.notify_project_update();

-- ─── 5. Registering a device ─────────────────────────────────────────────────────────────────────────────────────────
-- push_subscriptions.endpoint is unique per browser install. If someone else used this browser before (shared computer,
-- or they signed out without it being cleaned up), the old row belongs to THEM and RLS would block a plain upsert. Taking
-- the endpoint over for the signed-in user is exactly right — a browser can only belong to whoever is signed in on it now —
-- and it means the previous person stops receiving this person's pushes.
create or replace function public.register_push_subscription(p_endpoint text, p_subscription jsonb, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_endpoint is null or length(p_endpoint) > 2000 or p_endpoint !~ '^https://' then
    raise exception 'Invalid push endpoint.' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, subscription, user_agent)
  values (auth.uid(), p_endpoint, p_subscription, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), subscription = excluded.subscription, user_agent = excluded.user_agent, updated_at = now();
  insert into public.notification_preferences (user_id, push) values (auth.uid(), true)
  on conflict (user_id) do update set push = true, updated_at = now();
end;
$$;
revoke all on function public.register_push_subscription(text, jsonb, text) from public, anon;
grant execute on function public.register_push_subscription(text, jsonb, text) to authenticated;
