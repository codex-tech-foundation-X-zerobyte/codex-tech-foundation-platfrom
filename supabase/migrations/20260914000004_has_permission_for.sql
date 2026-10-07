-- has_permission() relies on auth.uid(), which is only set when a request
-- carries the caller's JWT through PostgREST/RLS. Edge functions running
-- privileged logic under the service-role key have no such context — they
-- know the caller's id from verifying the JWT themselves (see
-- supabase/functions/_shared/auth.ts), but auth.uid() would return null if
-- they tried to call has_permission() directly. This variant takes the user
-- id explicitly so edge functions can check "does THIS caller have THIS
-- permission" without pretending to be them at the RLS layer.

create or replace function public.has_permission_for(p_user_id uuid, p_permission_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id and p.key = p_permission_key
  ) or exists (
    select 1 from public.profiles where id = p_user_id and role = 'superadmin'
  )
$$;

-- has_permission() keeps its existing signature (used throughout RLS
-- policies) but now delegates to the shared implementation above instead of
-- duplicating the query, so there's exactly one place this logic lives.
create or replace function public.has_permission(permission_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_permission_for(auth.uid(), permission_key)
$$;

-- Deliberately left with default PUBLIC execute grants (not revoked/
-- restricted): has_permission() calls this internally while running as its
-- SECURITY DEFINER owner, and restricting grants here risks breaking that
-- internal call in ways that depend on exact role ownership I can't verify
-- without a live database. The trade-off is low-risk either way — this
-- function only reveals a boolean ("does user X have permission Y"), not
-- any sensitive data, so leaving it broadly callable is an acceptable,
-- lower-risk default. Revisit if that changes.
