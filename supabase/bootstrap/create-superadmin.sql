-- ═══════════════════════════════════════════════════════════════════════
-- Super Admin bootstrap — RUN MANUALLY, EXACTLY ONCE, PER ENVIRONMENT.
--
-- This file is intentionally NOT in supabase/migrations/, so it never runs
-- automatically via `supabase db push`. It promotes an already-existing
-- Supabase Auth user to superadmin — it does not create the Auth user and
-- it never contains a password.
--
-- STEP 1 — create the Auth user first, outside of SQL:
--   Supabase Dashboard -> Authentication -> Users -> Add user
--   (or `supabase auth admin create-user` via the CLI / Admin API)
--   Set a strong password there. Do not put it in this file, a migration,
--   a commit, or anywhere else in this repository.
--
-- STEP 2 — copy that user's UUID (shown in the dashboard next to their
-- email) and paste it in place of the placeholder below.
--
-- STEP 3 — run this file's contents in the Supabase SQL editor, or via:
--   supabase db execute -f supabase/bootstrap/create-superadmin.sql
-- against the target project. Review the output of the final SELECT to
-- confirm the promotion succeeded before closing the session.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  -- REPLACE THIS with the Auth user's UUID from Step 2 before running.
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_exists boolean;
begin
  select exists(select 1 from auth.users where id = v_user_id) into v_exists;
  if not v_exists then
    raise exception 'No auth.users row for %. Create the Auth user first (Step 1) and paste the correct UUID.', v_user_id;
  end if;

  -- provision_profile() (architecture_rebuild.sql) already created a
  -- 'client'-role profile row for this user via the on_auth_user_created
  -- trigger. Promote it rather than inserting a second row.
  update public.profiles set role = 'superadmin' where id = v_user_id;

  if not found then
    raise exception 'No profiles row for %. Expected the on_auth_user_created trigger to have created one — check that trigger exists.', v_user_id;
  end if;

  -- The on_profile_role_set trigger (20260914000002_manager_rbac_and_security_fixes.sql)
  -- fires on this UPDATE and syncs user_roles automatically — no manual
  -- user_roles insert needed here.

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata)
  values (v_user_id, 'role.assigned', 'profiles', v_user_id, 'warning', jsonb_build_object('role', 'superadmin', 'via', 'bootstrap script'));
end $$;

-- Confirm the result before closing this session.
select p.id, p.display_name, p.role, ur.role_id, r.name as synced_role_name
from public.profiles p
left join public.user_roles ur on ur.user_id = p.id
left join public.roles r on r.id = ur.role_id
where p.id = '00000000-0000-0000-0000-000000000000'; -- match the UUID used above
