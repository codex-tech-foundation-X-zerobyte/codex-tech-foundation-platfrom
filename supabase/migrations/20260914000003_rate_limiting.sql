-- Real, database-backed rate limiting. Edge functions call check_rate_limit()
-- before doing any work; it records the attempt and returns whether the
-- caller is over the limit for that action in the trailing window.

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket_key text not null,      -- e.g. 'submit-lead:203.0.113.4' or 'resolve-worker-login:CTF-WKR-0001'
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_bucket_time_idx on public.rate_limit_events(bucket_key, created_at desc);

alter table public.rate_limit_events enable row level security;
-- No policies at all: this table is written and read exclusively by edge
-- functions using the service-role key, which bypasses RLS. Nothing in the
-- anon/authenticated client should ever touch it directly.

-- Housekeeping: old events are useless past any window we check, and the
-- table would grow unboundedly otherwise. Edge functions call this
-- opportunistically (see check_rate_limit below) rather than relying on a
-- cron job that may not be configured in every environment.
create or replace function public.check_rate_limit(
  p_bucket_key text,
  p_max_events int,
  p_window_seconds int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  -- Opportunistic cleanup: cheap because of the index, and keeps the table
  -- bounded without depending on pg_cron being enabled.
  delete from public.rate_limit_events
    where bucket_key = p_bucket_key and created_at < now() - (p_window_seconds || ' seconds')::interval;

  select count(*) into v_count from public.rate_limit_events
    where bucket_key = p_bucket_key and created_at >= now() - (p_window_seconds || ' seconds')::interval;

  if v_count >= p_max_events then
    return false; -- over limit; caller should reject the request
  end if;

  insert into public.rate_limit_events (bucket_key) values (p_bucket_key);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
