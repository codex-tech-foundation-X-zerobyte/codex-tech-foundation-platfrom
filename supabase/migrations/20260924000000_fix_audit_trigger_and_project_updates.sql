-- Fixes for two production errors, each traced to its root cause (not guessed):
--
--  A. PATCH worker_profiles -> 400.  Root cause: audit_row_change() (20260918000001) built its audit entry from
--     `new.id` / `old.id`, but worker_profiles and client_users have NO `id` column — their primary key is `user_id`.
--     The AFTER UPDATE trigger on each fires whenever `status` changes (Suspend / Reactivate), raised
--     SQLSTATE 42703 `record "old" has no field "id"`, and the whole UPDATE rolled back. PostgREST reports 42703 as HTTP 400.
--     Every status change on a worker or client account has therefore failed since that trigger was added.
--
--  B. POST project_updates -> 403.  Root cause: project_updates has RLS enabled (20260912000001) and only ever received
--     SELECT policies. With RLS on and no INSERT policy, Postgres denies the insert for EVERY role (superadmin included).
--     Publishing a project update was never grantable.
--
-- Neither fix loosens an existing restriction. (A) only changes how the audit row finds its resource id. (B) adds the
-- same role model every sibling table uses: worker/superadmin, or a manager holding `projects.update`.

-- ─── A. Audit trigger: resource id from `id` OR `user_id` ────────────────────
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text := tg_argv[0]; -- e.g. 'project.created', passed per-trigger
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_resource_id uuid;
  v_meta jsonb := '{}'::jsonb;
begin
  -- Most audited tables are keyed by `id`; worker_profiles and client_users are keyed by `user_id`.
  v_resource_id := coalesce(nullif(v_row ->> 'id', '')::uuid, nullif(v_row ->> 'user_id', '')::uuid);

  if tg_op = 'UPDATE'
     and tg_table_name in ('projects', 'leads', 'applications', 'worker_profiles', 'client_users')
     and (v_old ->> 'status') is distinct from (v_new ->> 'status') then
    v_meta := jsonb_build_object('from_status', v_old ->> 'status', 'to_status', v_new ->> 'status');
  end if;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata)
  values (auth.uid(), v_action, tg_table_name, v_resource_id, 'info', v_meta);
  return null; -- AFTER trigger, return value ignored
end;
$$;

-- ─── B. project_updates: who may publish ─────────────────────────────────────
drop policy if exists "staff publish project updates" on public.project_updates;
create policy "staff publish project updates" on public.project_updates
  for insert with check (
    author_id = auth.uid() -- an author can only publish as themselves
    and (public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update'))
  );

-- Reading: whoever may publish must also be able to read what they published (a manager with projects.update but
-- not projects.view/ownership would otherwise post into a list they cannot see). Mirrors "permission-scoped project reads".
drop policy if exists "staff and owners read updates" on public.project_updates;
create policy "staff and owners read updates" on public.project_updates
  for select using (
    public.current_role() in ('worker', 'superadmin')
    or public.has_permission('projects.view')
    or public.has_permission('projects.update')
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );
-- ("linked clients read published updates" from 20260923000000 is unchanged: clients still see published updates only.)
