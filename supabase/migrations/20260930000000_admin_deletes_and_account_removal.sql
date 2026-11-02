-- Deleting things that have history.
--
-- Why "I can't delete" happened (traced, not guessed):
--   1. blog_posts, leads, careers, case_studies, team_profiles and applications all HAVE superadmin delete policies, but the
--      UI never called them (blog/careers only archived, leads/applications only changed status, team had a service
--      function nobody used). So there was simply no delete button.
--   2. Where a delete WAS possible it would have failed on a foreign key: projects is referenced by client_projects and
--      project_milestones with ON DELETE RESTRICT, clients by client_users/client_projects, and a worker's user id is
--      referenced by ~40 columns (tasks.created_by, meetings.created_by, chat_messages.sender_id, ...) with no ON DELETE
--      action at all. Removing a worker, project or client with any history therefore raised 23503.
--
-- This migration adds ONE generic helper that clears exactly those blocking references, plus Main-Admin-only wrappers.
-- It never loosens who may delete: every entry point is superadmin-only.

-- ─── 1. detach_references: make a row deletable without hand-listing every table ──────────────────────────────────────
-- For every single-column foreign key that points at `p_table` with NO ACTION / RESTRICT and currently references `p_id`:
--   • nullable column            → set to NULL (history is kept, attribution is dropped)
--   • NOT NULL "shared work" col → hand over to `p_reassign_to` (created_by, author_id, assigned_by ...), so a meeting a
--                                  worker organised, or a record they authored, survives them
--   • any other NOT NULL column  → the row is the person's own (their messages, call records, task watches) and is removed
-- Cascading foreign keys are left to Postgres. Looked up from pg_constraint, so tables added later are covered too.
create or replace function public.detach_references(p_table text, p_id uuid, p_reassign_to uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fk record;
  shared_cols constant text[] := array['created_by', 'updated_by', 'author_id', 'requested_by', 'assigned_by', 'decided_by', 'added_by', 'connected_by', 'owner_id', 'uploaded_by'];
begin
  for fk in
    select c.conrelid::regclass as child, a.attname as col, a.attnotnull as not_null,
           (select n.nspname from pg_class k join pg_namespace n on n.oid = k.relnamespace where k.oid = c.conrelid) as child_schema
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = p_table::regclass
      and c.confdeltype in ('a', 'r')          -- NO ACTION / RESTRICT: the ones that block a delete
      and array_length(c.conkey, 1) = 1
  loop
    begin
      if not fk.not_null then
        execute format('update %s set %I = null where %I = $1', fk.child, fk.col, fk.col) using p_id;
      elsif p_reassign_to is not null and fk.col = any (shared_cols) then
        begin
          execute format('update %s set %I = $2 where %I = $1', fk.child, fk.col, fk.col) using p_id, p_reassign_to;
        exception when unique_violation then
          -- the replacement already has an equivalent row (e.g. already a member): the duplicate can go
          execute format('delete from %s where %I = $1', fk.child, fk.col) using p_id;
        end;
      else
        execute format('delete from %s where %I = $1', fk.child, fk.col) using p_id;
      end if;
    exception when others then
      -- Our own tables: fail loudly (the caller's transaction rolls back and nothing is half-deleted).
      -- Platform tables (e.g. storage.objects.owner on older projects) may not be ours to touch: warn and carry on.
      if fk.child_schema = 'public' then raise; end if;
      raise warning 'detach_references: could not clear %.% (%)', fk.child, fk.col, sqlerrm;
    end;
  end loop;
end;
$$;

-- Only the service role (edge functions) and the Main-Admin wrappers below may call it. Never a signed-in user directly.
revoke all on function public.detach_references(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.detach_references(text, uuid, uuid) to service_role;

-- ─── 2. Projects ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_delete_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public."current_role"() is distinct from 'superadmin' then
    raise exception 'Only the Main Admin can delete a project.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'That project no longer exists.' using errcode = 'P0002';
  end if;
  perform public.detach_references('public.projects', p_project);
  delete from public.projects where id = p_project;
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata)
  values (auth.uid(), 'project.deleted', 'projects', p_project, 'warning', '{}'::jsonb);
end;
$$;
revoke all on function public.admin_delete_project(uuid) from public, anon;
grant execute on function public.admin_delete_project(uuid) to authenticated;

-- ─── 3. Client organisations ─────────────────────────────────────────────────────────────────────────────────────────
-- Removes the organisation and its portal logins' links. Projects are kept (only the link to the client is removed); the
-- portal login accounts themselves are removed by the manage-account edge function, which owns auth.users.
create or replace function public.admin_delete_client_org(p_client uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public."current_role"() is distinct from 'superadmin' then
    raise exception 'Only the Main Admin can delete a client.' using errcode = '42501';
  end if;
  if exists (select 1 from public.client_users where client_id = p_client) then
    raise exception 'This client still has portal logins. Remove them first.' using errcode = '23503';
  end if;
  perform public.detach_references('public.clients', p_client);
  delete from public.clients where id = p_client;
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata)
  values (auth.uid(), 'client.deleted', 'clients', p_client, 'warning', '{}'::jsonb);
end;
$$;
revoke all on function public.admin_delete_client_org(uuid) from public, anon;
grant execute on function public.admin_delete_client_org(uuid) to authenticated;

-- ─── 4. Policies that were missing or redundant (idempotent; superadmin only — nothing is loosened) ───────────────────
drop policy if exists "superadmin deletes applications" on public.applications;
create policy "superadmin deletes applications" on public.applications for delete using (public."current_role"() = 'superadmin');

drop policy if exists "superadmin deletes project updates" on public.project_updates;
create policy "superadmin deletes project updates" on public.project_updates for delete using (public."current_role"() = 'superadmin');

-- A message's sender may remove it for everyone; the Main Admin may moderate any message.
drop policy if exists "senders or main admin delete messages" on public.chat_messages;
create policy "senders or main admin delete messages" on public.chat_messages for delete using (sender_id = auth.uid() or public."current_role"() = 'superadmin');
