-- Reusable rate limiting for public/anonymous Edge Functions. Previously
-- none of submit-lead, submit-contact, submit-job-application,
-- create-resume-upload-url, or resolve-worker-login enforced any limit —
-- each was a plain insert/lookup an anonymous caller could hit as fast as
-- the network allowed. This table + function is the single mechanism every
-- Edge Function should call; do not invent a second rate-limit table.

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,        -- e.g. 'submit-lead', 'resolve-worker-login'
  identifier text not null,    -- caller IP (or IP+worker_id for login attempts)
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup_idx on public.rate_limit_events(bucket, identifier, created_at desc);

-- Auto-prune anything older than a day so this table never grows unbounded;
-- cheap enough to run on every check given the small window sizes involved.
create or replace function public.check_rate_limit(p_bucket text, p_identifier text, p_max_attempts int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_count int;
begin
  delete from public.rate_limit_events where created_at < now() - interval '1 day';

  select count(*) into attempt_count from public.rate_limit_events
  where bucket = p_bucket and identifier = p_identifier and created_at > now() - make_interval(secs => p_window_seconds);

  if attempt_count >= p_max_attempts then
    return false;
  end if;

  insert into public.rate_limit_events (bucket, identifier) values (p_bucket, p_identifier);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, text, int, int) from public;
revoke all on function public.check_rate_limit(text, text, int, int) from anon, authenticated;
grant execute on function public.check_rate_limit(text, text, int, int) to service_role;

alter table public.rate_limit_events enable row level security;
-- No policies at all: this table is only ever touched via the
-- security-definer function above, called with the service role from Edge
-- Functions. Deny-by-default (RLS enabled, zero policies) is intentional.
