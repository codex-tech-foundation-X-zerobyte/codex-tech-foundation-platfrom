-- Notification checkup. The push hand-off (public.dispatch_push) was built to NEVER fail the original insert, so when anything on the
-- way broke (pg_net not enabled, a wrong address, a wrong secret, the function deployed with JWT checking on) it failed silently and
-- nobody could tell where. This records what happened to each hand-off so a person can press one button and be told which step is
-- broken. Nothing here changes who is notified or when.

create table if not exists public.push_dispatch_log (
  id           bigserial primary key,
  request_id   bigint,                       -- pg_net request id, when the call was handed over
  source_table text not null,
  source_id    text,
  error        text,                         -- set when the database could not even hand the call over
  created_at   timestamptz not null default now()
);
create index if not exists push_dispatch_log_source_idx on public.push_dispatch_log (source_table, source_id);
create index if not exists push_dispatch_log_created_idx on public.push_dispatch_log (created_at desc);
alter table public.push_dispatch_log enable row level security;
revoke all on public.push_dispatch_log from anon, authenticated;

create or replace function public.dispatch_push() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s public.push_settings; v_req bigint; v_id text := to_jsonb(new) ->> 'id';
begin
  select * into s from public.push_settings where id;
  if not found then return null; end if;                -- push not configured yet: in-app behaviour is unchanged
  begin
    v_req := net.http_post(
      url     := s.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s.webhook_secret),
      body    := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'record', to_jsonb(new)));
    insert into public.push_dispatch_log (request_id, source_table, source_id) values (v_req, tg_table_name, v_id);
  exception when others then
    -- The hand-off itself failed. Keep the reason (it never contains the secret) so the checkup can show it.
    begin insert into public.push_dispatch_log (source_table, source_id, error) values (tg_table_name, v_id, left(sqlerrm, 300)); exception when others then null; end;
  end;
  if random() < 0.01 then delete from public.push_dispatch_log where created_at < now() - interval '3 days'; end if;  -- housekeeping
  return null;
exception when others then
  return null;                                          -- never fail the original insert because of push
end $$;
revoke all on function public.dispatch_push() from public, anon, authenticated;

-- A test notification for the signed-in person, sent through the REAL path (notifications table → trigger → function → push service).
create or replace function public.send_test_notification() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.notifications where user_id = auth.uid() and kind = 'test' and created_at > now() - interval '5 seconds') then
    raise exception 'Wait a few seconds between tests.' using errcode = '23514';
  end if;
  insert into public.notifications (user_id, title, body, kind) values (auth.uid(), 'Notifications are working', 'This test went through the real path: the database, the push function, and your device.', 'test') returning id into v_id;
  delete from public.notifications where user_id = auth.uid() and kind = 'test' and created_at < now() - interval '1 day';
  return v_id;
end $$;

-- What happened to the hand-off for one of MY test notifications.
create or replace function public.push_dispatch_result(p_notification uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.push_dispatch_log; v_net boolean := to_regclass('net._http_response') is not null; v_status int; v_content text; v_err text;
begin
  if auth.uid() is null or not exists (select 1 from public.notifications where id = p_notification and user_id = auth.uid()) then
    raise exception 'That notification is not yours.' using errcode = '42501';
  end if;
  select * into l from public.push_dispatch_log where source_table = 'notifications' and source_id = p_notification::text order by id desc limit 1;
  if not found then return jsonb_build_object('handed_over', false, 'configured', exists (select 1 from public.push_settings), 'pg_net_available', v_net); end if;
  if l.error is not null then return jsonb_build_object('handed_over', false, 'configured', true, 'pg_net_available', v_net, 'error', l.error); end if;
  if not v_net then return jsonb_build_object('handed_over', true, 'configured', true, 'pg_net_available', false); end if;
  execute 'select status_code, left(content, 300), left(error_msg, 300) from net._http_response where id = $1' into v_status, v_content, v_err using l.request_id;
  return jsonb_build_object('handed_over', true, 'configured', true, 'pg_net_available', true, 'answered', v_status is not null or v_err is not null, 'status_code', v_status, 'content', v_content, 'error', v_err);
end $$;

-- Setup facts the person is allowed to know: whether push is configured (never the secret) and how many devices their account has.
create or replace function public.push_setup_summary() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.push_settings;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into s from public.push_settings where id;
  return jsonb_build_object('configured', found, 'secret_set', coalesce(char_length(btrim(s.webhook_secret)) >= 16, false),
    'function_host', case when found then split_part(split_part(s.function_url, '://', 2), '/', 1) end,
    'function_path_ok', coalesce(s.function_url ~ '^https://[^/]+/functions/v1/push-dispatch/?$', false),
    'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()),
    'pg_net_available', to_regclass('net._http_response') is not null);
end $$;

revoke all on function public.send_test_notification(), public.push_dispatch_result(uuid), public.push_setup_summary() from public, anon;
grant execute on function public.send_test_notification(), public.push_dispatch_result(uuid), public.push_setup_summary() to authenticated;
