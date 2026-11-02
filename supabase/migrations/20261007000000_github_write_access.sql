-- GitHub Shadow, slice 3: who may WRITE to GitHub through the Workspace, an audit trail of every write, and a safety net against
-- double submits and runaway scripts. Idempotent and non-destructive: new tables and functions only.
--
-- Principles (from the owner's brief): being able to VIEW a repository never implies being able to change it; every write is OFF until
-- the Main Admin turns it on for that repository; authorisation is decided on the server (never trusted from the browser); every
-- attempt, allowed or refused, leaves a row.

-- 1. Per-repository write policy (Main Admin sets it; default is off for everything) ---------------------------------------------------------
create table if not exists public.github_repo_policy (
  repo_full_name text primary key references public.integration_repositories(full_name) on delete cascade,
  comment_level  text not null default 'off' check (comment_level in ('off', 'admins', 'members')),
  issue_level    text not null default 'off' check (issue_level in ('off', 'admins', 'members')),
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table public.github_repo_policy enable row level security;
revoke all on public.github_repo_policy from anon, authenticated;
grant select on public.github_repo_policy to authenticated;
drop policy if exists "policy visible to main admin" on public.github_repo_policy;
create policy "policy visible to main admin" on public.github_repo_policy for select to authenticated using (public."current_role"() = 'superadmin');

create or replace function public.set_github_repo_policy(p_repo text, p_comment text, p_issue text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public."current_role"() is distinct from 'superadmin' then raise exception 'Only the Main Admin can change GitHub write access.' using errcode = '42501'; end if;
  if p_comment not in ('off', 'admins', 'members') or p_issue not in ('off', 'admins', 'members') then raise exception 'Unknown access level.'; end if;
  if not exists (select 1 from public.integration_repositories where full_name = p_repo) then raise exception 'That repository is not linked to the Workspace.'; end if;
  insert into public.github_repo_policy (repo_full_name, comment_level, issue_level, updated_by, updated_at) values (p_repo, p_comment, p_issue, auth.uid(), now())
  on conflict (repo_full_name) do update set comment_level = excluded.comment_level, issue_level = excluded.issue_level, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_logs (actor_user_id, action, resource_type, severity, metadata) values (auth.uid(), 'github.policy', 'github_repo', 'warning', jsonb_build_object('repo', p_repo, 'comment', p_comment, 'issue', p_issue));
end $$;
revoke all on function public.set_github_repo_policy(text, text, text) from public, anon;
grant execute on function public.set_github_repo_policy(text, text, text) to authenticated;

-- 2. The decision: may the CALLER do this to this repository? ---------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: the lookup of integration_repositories runs under the caller's own row-level security, so a repository the
-- caller cannot see is simply "no". Levels: off = nobody (a kill switch that also stops the Main Admin); admins = the Main Admin, the admins of the
-- repository's department, or the owner of the project it is linked to; members = any internal user who can see the repository. Clients never.
-- The policy table itself is Main Admin only, so the level is read through this one narrow helper (it returns a single word, nothing else).
create or replace function public.github_policy_level(p_repo text, p_capability text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case p_capability when 'comment' then comment_level when 'issue' then issue_level end from public.github_repo_policy where repo_full_name = p_repo), 'off')
$$;
revoke all on function public.github_policy_level(text, text) from public, anon;
grant execute on function public.github_policy_level(text, text) to authenticated;

create or replace function public.github_can(p_repo text, p_capability text) returns boolean
language plpgsql stable set search_path = public as $$
declare v_dept uuid; v_project uuid; v_level text;
begin
  if auth.uid() is null or public."current_role"()::text not in ('superadmin', 'manager', 'worker') then return false; end if;
  select department_id, project_id into v_dept, v_project from public.integration_repositories where full_name = p_repo;
  if not found then return false; end if;
  v_level := public.github_policy_level(p_repo, p_capability);
  if p_capability not in ('comment', 'issue') or v_level = 'off' then return false; end if;
  if v_level = 'members' then return true; end if;
  return public."current_role"() = 'superadmin'
      or public.is_department_admin(v_dept)
      or (v_project is not null and exists (select 1 from public.projects p where p.id = v_project and p.owner_id = auth.uid()));
end $$;
revoke all on function public.github_can(text, text) from public, anon;
grant execute on function public.github_can(text, text) to authenticated;

create or replace function public.github_capabilities(p_repo text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('comment', public.github_can(p_repo, 'comment'), 'issue', public.github_can(p_repo, 'issue'))
$$;
revoke all on function public.github_capabilities(text) from public, anon;
grant execute on function public.github_capabilities(text) to authenticated;

-- 3. Audit trail of every write attempt (service role writes; the Main Admin and the actor can read) -----------------------------------------------
create table if not exists public.github_actions (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique,
  actor_id      uuid not null references public.profiles(id) on delete cascade,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  action        text not null check (action in ('comment', 'create_issue')),
  target        integer check (target is null or target > 0),
  outcome       text not null default 'pending' check (outcome in ('pending', 'success', 'failed', 'denied')),
  detail        text not null default '' check (length(detail) <= 300),
  result_url    text check (result_url is null or result_url ~ '^https://github\.com/'),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists github_actions_actor_time on public.github_actions (actor_id, created_at desc);
create index if not exists github_actions_repo_time on public.github_actions (repo_full_name, created_at desc);
alter table public.github_actions enable row level security;
revoke all on public.github_actions from anon, authenticated;
grant select on public.github_actions to authenticated;
drop policy if exists "actions visible to main admin and actor" on public.github_actions;
create policy "actions visible to main admin and actor" on public.github_actions for select to authenticated using (public."current_role"() = 'superadmin' or actor_id = auth.uid());

-- 4. Begin an action: refuse a repeat of the same request id and cap the rate. Service role only: the Edge Function passes the actor it
--    verified from the caller's token, after asking github_can with the caller's own session. ------------------------------------------------------
create or replace function public.begin_github_action(p_request uuid, p_actor uuid, p_repo text, p_action text, p_target integer, p_denied boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_recent int;
begin
  if p_denied then
    insert into public.github_actions (request_id, actor_id, repo_full_name, action, target, outcome, detail, finished_at) values (p_request, p_actor, p_repo, p_action, p_target, 'denied', 'Not allowed for this repository.', now()) on conflict (request_id) do nothing;
    return 'denied';
  end if;
  if exists (select 1 from public.github_actions where request_id = p_request) then return 'duplicate'; end if;
  select count(*) into v_recent from public.github_actions where actor_id = p_actor and outcome <> 'denied' and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then return 'rate_limited'; end if;
  insert into public.github_actions (request_id, actor_id, repo_full_name, action, target) values (p_request, p_actor, p_repo, p_action, p_target);
  return 'ok';
end $$;
revoke all on function public.begin_github_action(uuid, uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.begin_github_action(uuid, uuid, text, text, integer, boolean) to service_role;

-- 5. Finish an action. Only a pending row can be finished, once; success also writes the workspace audit log (audit_logs). ------------------------------------------
create or replace function public.finish_github_action(p_request uuid, p_outcome text, p_detail text, p_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.github_actions;
begin
  if p_outcome not in ('success', 'failed') then raise exception 'Bad outcome.'; end if;
  update public.github_actions set outcome = p_outcome, detail = left(coalesce(p_detail, ''), 300), result_url = p_url, finished_at = now()
   where request_id = p_request and outcome = 'pending' returning * into a;
  if not found then return false; end if;
  if p_outcome = 'success' then
    insert into public.audit_logs (actor_user_id, action, resource_type, severity, metadata) values (a.actor_id, 'github.' || a.action, 'github_repo', 'info', jsonb_build_object('repo', a.repo_full_name, 'target', a.target, 'url', a.result_url));
  end if;
  return true;
end $$;
revoke all on function public.finish_github_action(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_github_action(uuid, text, text, text) to service_role;

-- 6. A crash between begin and finish must not leave a row "pending" forever: the sweep calls this (it is part of prune_github_data's caller). ------
create or replace function public.expire_github_actions() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.github_actions set outcome = 'failed', detail = 'No answer was recorded. Check GitHub before trying again.', finished_at = now() where outcome = 'pending' and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_github_actions() from public, anon, authenticated;
grant execute on function public.expire_github_actions() to service_role;
