-- Frontend writes made directly against RLS (project creation, lead status
-- updates, etc.) had no audit trail — only edge-function-mediated actions
-- (worker/client creation, logins) were logged, because audit_logs
-- correctly has no INSERT policy for authenticated/anon roles (nothing
-- should be able to write an audit entry as an arbitrary actor). A generic
-- security-definer trigger closes this without relaxing that policy: it
-- runs with elevated privilege regardless of the row-level caller, and
-- always records auth.uid() as the actor, not anything the client supplies.

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_resource_id uuid;
begin
  v_action := tg_argv[0]; -- e.g. 'project.created', passed per-trigger below
  v_resource_id := case when tg_op = 'DELETE' then old.id else new.id end;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata)
  values (
    auth.uid(), v_action, tg_table_name, v_resource_id, 'info',
    case
      when tg_op = 'UPDATE' and tg_table_name = 'projects' and old.status is distinct from new.status
        then jsonb_build_object('from_status', old.status, 'to_status', new.status)
      when tg_op = 'UPDATE' and tg_table_name = 'leads' and old.status is distinct from new.status
        then jsonb_build_object('from_status', old.status, 'to_status', new.status)
      when tg_op = 'UPDATE' and tg_table_name = 'applications' and old.status is distinct from new.status
        then jsonb_build_object('from_status', old.status, 'to_status', new.status)
      when tg_op = 'UPDATE' and tg_table_name = 'worker_profiles' and old.status is distinct from new.status
        then jsonb_build_object('from_status', old.status, 'to_status', new.status)
      when tg_op = 'UPDATE' and tg_table_name = 'client_users' and old.status is distinct from new.status
        then jsonb_build_object('from_status', old.status, 'to_status', new.status)
      else '{}'::jsonb
    end
  );
  return null; -- AFTER trigger, return value ignored
end;
$$;

create trigger audit_project_created after insert on public.projects
  for each row execute procedure public.audit_row_change('project.created');
create trigger audit_project_updated after update on public.projects
  for each row execute procedure public.audit_row_change('project.updated');

create trigger audit_lead_status_changed after update on public.leads
  for each row when (old.status is distinct from new.status)
  execute procedure public.audit_row_change('lead.status_changed');

create trigger audit_application_status_changed after update on public.applications
  for each row when (old.status is distinct from new.status)
  execute procedure public.audit_row_change('application.status_changed');

-- worker_profiles/client_users status changes are already logged when done
-- via the create-worker/create-client edge functions' own audit_logs
-- inserts at creation time, but NOT for later status changes (e.g. the
-- admin "Suspend"/"Reactivate" button, which writes directly via RLS).
create trigger audit_worker_status_changed after update on public.worker_profiles
  for each row when (old.status is distinct from new.status)
  execute procedure public.audit_row_change('worker.status_changed');

create trigger audit_client_status_changed after update on public.client_users
  for each row when (old.status is distinct from new.status)
  execute procedure public.audit_row_change('client.status_changed');
