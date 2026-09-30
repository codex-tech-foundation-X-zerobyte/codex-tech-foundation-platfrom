-- Functional gap fixes found while tracing the client, chat and calls flows end to end.
--
--  1. Clients could never see the projects they were provisioned for. create-client links a client
--     user via client_users -> client_projects (and projects.client_account_id), but every policy only
--     tested projects.client_id = auth.uid(), a column nothing ever sets. New helper is_project_client().
--  2. project_requests had a SELECT policy and NOTHING else: every client "Submit request" was rejected by
--     RLS (and requester_id was never populated, so even a success would have been invisible to its author).
--  3. project_milestones had no client SELECT policy at all.
--  4. project_updates: clients matched by client_id could read UNPUBLISHED drafts.
--  5. profiles were readable only by their owner or a superadmin, so chat/call name lookups returned nothing
--     for workers and managers ("Team member" for everyone).
--  6. calls: "participants update own calls" allowed either side to rewrite caller_id/callee_id/type, and to
--     set any status. A guard trigger now enforces immutable columns and who may make which transition.
--  7. notifications were not in the realtime publication, so the bell could never update live.

-- ─── 1. Client <-> project linkage ───────────────────────────────────────────
create or replace function public.is_project_client(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and (
        p.client_id = auth.uid()
        or exists (
          select 1
          from public.client_users cu
          where cu.user_id = auth.uid()
            and cu.status = 'active'
            and (
              cu.client_id = p.client_account_id
              or exists (select 1 from public.client_projects cp where cp.project_id = p.id and cp.client_id = cu.client_id)
            )
        )
      )
  )
$$;
revoke all on function public.is_project_client(uuid) from public, anon;
grant execute on function public.is_project_client(uuid) to authenticated;

-- Additive (permissive policies OR together), so nothing that worked before stops working.
drop policy if exists "linked clients read their projects" on public.projects;
create policy "linked clients read their projects" on public.projects
  for select using (public.is_project_client(id));

-- The client's own project list, without the public showcase projects RLS also lets everyone read.
create or replace function public.my_client_projects()
returns setof public.projects
language sql stable security invoker set search_path = public as $$
  select p.* from public.projects p
  where p.archived_at is null and public.is_project_client(p.id)
  order by p.updated_at desc
$$;
revoke all on function public.my_client_projects() from public, anon;
grant execute on function public.my_client_projects() to authenticated;

-- ─── 3. Milestones visible to the client of that project ─────────────────────
drop policy if exists "linked clients read milestones" on public.project_milestones;
create policy "linked clients read milestones" on public.project_milestones
  for select using (public.is_project_client(project_id));

-- ─── 4. Updates: staff/owner see everything, clients only what has been published ─
drop policy if exists "project members read updates" on public.project_updates;
drop policy if exists "staff and owners read updates" on public.project_updates;
drop policy if exists "linked clients read published updates" on public.project_updates;
create policy "staff and owners read updates" on public.project_updates
  for select using (
    public.current_role() in ('worker', 'superadmin')
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );
create policy "linked clients read published updates" on public.project_updates
  for select using (published_at is not null and public.is_project_client(project_id));

-- Files shared on a project are deliverables for that project's client.
drop policy if exists "linked clients read project files" on public.project_files;
create policy "linked clients read project files" on public.project_files
  for select using (public.is_project_client(project_id));

-- ─── 2. Requests: clients can file them, staff can triage them ───────────────
alter table public.project_requests
  add column if not exists priority text not null default 'normal',
  add column if not exists kind text not null default 'request';
alter table public.project_requests drop constraint if exists project_requests_priority_check;
alter table public.project_requests add constraint project_requests_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.project_requests drop constraint if exists project_requests_kind_check;
alter table public.project_requests add constraint project_requests_kind_check check (kind in ('request', 'change', 'bug', 'maintenance'));

create or replace function public.project_requests_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requester_id := coalesce(auth.uid(), new.requester_id);
    -- A client cannot file a request that is already "approved" or "complete".
    if public.current_role() = 'client' then new.status := 'open'; end if;
  else
    new.project_id := old.project_id;
    new.requester_id := old.requester_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists project_requests_before_write on public.project_requests;
create trigger project_requests_before_write before insert or update on public.project_requests
  for each row execute function public.project_requests_before_write();

drop policy if exists "project members read requests" on public.project_requests;
drop policy if exists "requests readable by author, client and staff" on public.project_requests;
drop policy if exists "clients and staff file requests" on public.project_requests;
drop policy if exists "staff triage requests" on public.project_requests;

create policy "requests readable by author, client and staff" on public.project_requests
  for select using (
    requester_id = auth.uid()
    or public.is_project_client(project_id)
    or public.current_role() in ('worker', 'superadmin')
    or public.has_permission('projects.update')
  );
create policy "clients and staff file requests" on public.project_requests
  for insert with check (
    requester_id = auth.uid()
    and (
      public.is_project_client(project_id)
      or public.current_role() in ('worker', 'superadmin')
      or public.has_permission('projects.update')
    )
  );
create policy "staff triage requests" on public.project_requests
  for update using (
    public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
  ) with check (
    public.current_role() in ('worker', 'superadmin') or public.has_permission('projects.update')
  );

-- ─── 5. Internal staff directory ─────────────────────────────────────────────
-- profiles holds only id, display_name, role, organization, avatar_path — no contact details.
drop policy if exists "internal users read internal profiles" on public.profiles;
create policy "internal users read internal profiles" on public.profiles
  for select using (
    public.current_role() in ('worker', 'manager', 'superadmin')
    and role in ('worker', 'manager', 'superadmin')
  );

-- ─── 6. Calls: immutable parties, and only the right person may make each transition ─
create or replace function public.calls_guard_update()
returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance

  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.type is distinct from old.type
     or new.started_at is distinct from old.started_at then
    raise exception 'A call''s participants, type and start time cannot be changed';
  end if;

  -- Finished calls stay finished; a late duplicate update is ignored rather than erroring.
  if old.status in ('declined', 'missed', 'ended', 'cancelled') then
    new.status := old.status;
    new.answered_at := old.answered_at;
    new.ended_at := old.ended_at;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('accepted', 'declined') and auth.uid() is distinct from old.callee_id then
      raise exception 'Only the person being called can accept or decline';
    end if;
    if new.status = 'cancelled' and auth.uid() is distinct from old.caller_id then
      raise exception 'Only the caller can cancel';
    end if;
    if new.status in ('accepted', 'declined', 'cancelled', 'missed') and old.status <> 'ringing' then
      raise exception 'That transition is only valid while the call is ringing';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists calls_guard_update on public.calls;
create trigger calls_guard_update before update on public.calls
  for each row execute function public.calls_guard_update();

-- ─── 7. Live notifications ───────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
