-- GitHub Shadow, slice 1: GitHub App installations, signed-webhook delivery log (replay protection) and a development activity feed.
-- Idempotent and non-destructive: new tables only. The existing `integrations`, `integration_secrets` and `integration_repositories`
-- tables are untouched, so the shared-token path keeps working until the App replaces it.
--
-- Credentials are NOT stored here. The App id, private key and webhook secret live in Edge Function secrets
-- (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET). Installation tokens are minted in memory and never persisted.

-- 1. Installations the App reports about itself (written by the webhook receiver only) -------------------------------------------------------
create table if not exists public.github_installations (
  installation_id      bigint primary key,
  account_login        text not null default '',
  account_type         text not null default '',
  repository_selection text not null default '' check (repository_selection in ('', 'all', 'selected')),
  suspended            boolean not null default false,
  removed              boolean not null default false,
  updated_at           timestamptz not null default now()
);
alter table public.github_installations enable row level security;
revoke all on public.github_installations from anon, authenticated;
drop policy if exists "installations visible to main admin" on public.github_installations;
create policy "installations visible to main admin" on public.github_installations for select to authenticated using (public."current_role"() = 'superadmin');
grant select on public.github_installations to authenticated;   -- RLS above is the gate: only the Main Admin sees rows

-- 2. Delivery log: one row per GitHub delivery id. The primary key IS the replay protection. ------------------------------------------------
create table if not exists public.github_webhook_deliveries (
  delivery_id   text primary key check (delivery_id ~ '^[0-9a-fA-F-]{8,64}$'),
  event         text not null check (length(event) <= 60),
  action        text not null default '' check (length(action) <= 60),
  repo_full_name text,
  outcome       text not null check (outcome in ('recorded', 'ignored')),
  detail        text not null default '' check (length(detail) <= 200),
  received_at   timestamptz not null default now()
);
alter table public.github_webhook_deliveries enable row level security;
revoke all on public.github_webhook_deliveries from anon, authenticated;   -- service role only; no policies

-- 3. Activity feed (what the Developer Hub shows) -------------------------------------------------------------------------------------------
create table if not exists public.github_activity (
  id             uuid primary key default gen_random_uuid(),
  delivery_id    text not null unique references public.github_webhook_deliveries(delivery_id) on delete cascade,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  kind           text not null check (kind in ('push', 'pull_request', 'review', 'issue', 'workflow_run', 'deployment')),
  title          text not null check (length(title) <= 300),
  actor          text not null default '' check (length(actor) <= 100),
  url            text check (url is null or url ~ '^https://github\.com/'),
  state          text not null default '' check (length(state) <= 30),
  occurred_at    timestamptz not null,
  created_at     timestamptz not null default now()
);
create index if not exists github_activity_repo_time on public.github_activity (repo_full_name, occurred_at desc);
alter table public.github_activity enable row level security;
revoke all on public.github_activity from anon, authenticated;
grant select on public.github_activity to authenticated;
-- Visibility mirrors integration_repositories EXACTLY: the subquery runs under the caller's own RLS on that table, so a person sees
-- activity only for repositories they may already see (their department's, their project's, or everything for the Main Admin).
-- Being a workspace member is not enough, and a repository nobody linked has no visible activity.
drop policy if exists "activity follows repository visibility" on public.github_activity;
create policy "activity follows repository visibility" on public.github_activity for select to authenticated using (
  exists (select 1 from public.integration_repositories r where r.full_name = github_activity.repo_full_name)
);

-- 4. Record one delivery atomically; returns 'duplicate' for a replay. Service role only. ---------------------------------------------------
create or replace function public.record_github_delivery(
  p_delivery text, p_event text, p_action text, p_repo text, p_outcome text, p_detail text,
  p_kind text default null, p_title text default null, p_actor text default null, p_url text default null, p_state text default null, p_occurred timestamptz default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_inserted int; v_linked boolean; v_dept uuid;
begin
  insert into public.github_webhook_deliveries (delivery_id, event, action, repo_full_name, outcome, detail)
  values (p_delivery, p_event, coalesce(p_action, ''), p_repo, p_outcome, left(coalesce(p_detail, ''), 200))
  on conflict (delivery_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;
  if p_outcome = 'recorded' and p_kind is not null then
    -- Only repositories the Main Admin has linked get a feed row: an installation may cover repos nobody linked to the Workspace.
    select true, department_id into v_linked, v_dept from public.integration_repositories where full_name = p_repo;
    if v_linked is not true then
      update public.github_webhook_deliveries set outcome = 'ignored', detail = 'repository not linked to the Workspace' where delivery_id = p_delivery;
      return 'ignored';
    end if;
    insert into public.github_activity (delivery_id, repo_full_name, kind, title, actor, url, state, occurred_at)
    values (p_delivery, p_repo, p_kind, p_title, coalesce(p_actor, ''), p_url, coalesce(p_state, ''), coalesce(p_occurred, now()));
    -- A failed build or deployment tells the owning department's admins and the Main Admin, once (this function runs once per delivery id).
    if (p_kind = 'workflow_run' and p_state = 'failure') or (p_kind = 'deployment' and p_state in ('failure', 'error')) then
      insert into public.notifications (user_id, title, body)
      select distinct u.id, case when p_kind = 'deployment' then 'Deployment failed' else 'Build failed' end, left(p_repo || ': ' || coalesce(p_title, ''), 300)
        from (
          select p.id from public.profiles p where p.role = 'superadmin'
          union
          select wd.user_id from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
           where wd.department_id = v_dept and wd.department_role = 'admin' and wp.status = 'active'
        ) u(id);
    end if;
    return 'recorded';
  end if;
  return p_outcome;
end $$;
revoke all on function public.record_github_delivery(text, text, text, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_github_delivery(text, text, text, text, text, text, text, text, text, text, text, timestamptz) to service_role;

-- 5. Keep an installation row current (service role only) -----------------------------------------------------------------------------------
create or replace function public.upsert_github_installation(p_id bigint, p_login text, p_type text, p_selection text, p_action text)
returns void language sql security definer set search_path = public as $$
  insert into public.github_installations (installation_id, account_login, account_type, repository_selection, suspended, removed, updated_at)
  values (p_id, left(coalesce(p_login, ''), 100), left(coalesce(p_type, ''), 20), case when p_selection in ('all', 'selected') then p_selection else '' end, p_action = 'suspend', p_action = 'deleted', now())
  on conflict (installation_id) do update set
    account_login = case when excluded.account_login <> '' then excluded.account_login else public.github_installations.account_login end,
    account_type = case when excluded.account_type <> '' then excluded.account_type else public.github_installations.account_type end,
    repository_selection = case when excluded.repository_selection <> '' then excluded.repository_selection else public.github_installations.repository_selection end,
    suspended = case when p_action = 'suspend' then true when p_action = 'unsuspend' then false else public.github_installations.suspended end,
    removed = case when p_action = 'deleted' then true when p_action in ('created', 'unsuspend') then false else public.github_installations.removed end,
    updated_at = now();
$$;
revoke all on function public.upsert_github_installation(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_github_installation(bigint, text, text, text, text) to service_role;

-- 6. Retention: delivery log and feed are not an archive. Run from a scheduled job; service role only. ------------------------------------------
create or replace function public.prune_github_data(p_days int default 90) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_days < 7 then raise exception 'Keep at least 7 days.'; end if;
  delete from public.github_webhook_deliveries where received_at < now() - make_interval(days => p_days);   -- the feed cascades
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_github_data(int) from public, anon, authenticated;
grant execute on function public.prune_github_data(int) to service_role;
