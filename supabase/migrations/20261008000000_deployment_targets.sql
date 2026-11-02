-- GitHub Shadow, slice 4: deployment centre (read-only). Maps a linked repository to the Vercel project that deploys it.
-- Idempotent and non-destructive. The Vercel access token is a server secret (Edge Function secret VERCEL_TOKEN), never stored in a table.
-- `provider` is a column with a one-value check so Netlify can be added later without reshaping anything; only Vercel is supported today.

create table if not exists public.deployment_targets (
  repo_full_name text primary key references public.integration_repositories(full_name) on delete cascade,
  provider    text not null default 'vercel' check (provider in ('vercel')),
  project_ref text not null check (project_ref ~ '^[A-Za-z0-9_.-]{1,100}$'),   -- a Vercel project id (prj_...) or name
  team_ref    text check (team_ref is null or team_ref ~ '^[A-Za-z0-9_.-]{1,100}$'),   -- a team id (team_...) or slug, when the project belongs to a team
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.deployment_targets enable row level security;
revoke all on public.deployment_targets from anon, authenticated;
grant select on public.deployment_targets to authenticated;
-- Visible exactly where the repository is visible (the subquery runs under the caller's own row-level security). Not a secret, but not public either.
drop policy if exists "targets follow repository visibility" on public.deployment_targets;
create policy "targets follow repository visibility" on public.deployment_targets for select to authenticated using (
  exists (select 1 from public.integration_repositories r where r.full_name = deployment_targets.repo_full_name)
);

create or replace function public.set_deployment_target(p_repo text, p_provider text, p_project text, p_team text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public."current_role"() is distinct from 'superadmin' then raise exception 'Only the Main Admin can connect deployments.' using errcode = '42501'; end if;
  if p_provider is distinct from 'vercel' then raise exception 'Only Vercel is supported.'; end if;
  if not exists (select 1 from public.integration_repositories where full_name = p_repo) then raise exception 'That repository is not linked to the Workspace.'; end if;
  insert into public.deployment_targets (repo_full_name, provider, project_ref, team_ref, updated_by, updated_at)
  values (p_repo, p_provider, btrim(p_project), nullif(btrim(coalesce(p_team, '')), ''), auth.uid(), now())
  on conflict (repo_full_name) do update set provider = excluded.provider, project_ref = excluded.project_ref, team_ref = excluded.team_ref, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_logs (actor_user_id, action, resource_type, severity, metadata) values (auth.uid(), 'deployment.target.set', 'github_repo', 'info', jsonb_build_object('repo', p_repo, 'provider', p_provider, 'project', btrim(p_project)));
end $$;
revoke all on function public.set_deployment_target(text, text, text, text) from public, anon;
grant execute on function public.set_deployment_target(text, text, text, text) to authenticated;

create or replace function public.clear_deployment_target(p_repo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public."current_role"() is distinct from 'superadmin' then raise exception 'Only the Main Admin can disconnect deployments.' using errcode = '42501'; end if;
  delete from public.deployment_targets where repo_full_name = p_repo;
  if found then
    insert into public.audit_logs (actor_user_id, action, resource_type, severity, metadata) values (auth.uid(), 'deployment.target.cleared', 'github_repo', 'info', jsonb_build_object('repo', p_repo));
  end if;
end $$;
revoke all on function public.clear_deployment_target(text) from public, anon;
grant execute on function public.clear_deployment_target(text) to authenticated;
