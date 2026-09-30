-- Found while building the Lead CRM UI: `leads` only had an "admins manage
-- leads" (superadmin-only) policy. Manager's leads.view/leads.manage grants
-- (seeded in 20260914000002) had nothing to attach to, and the worker Leads
-- nav item has never actually had data access. Extend consistently with the
-- content-table fix in 20260915000001.

drop policy if exists "admins manage leads" on public.leads;

create policy "permission-scoped lead reads" on public.leads for select using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('leads.view')
);
create policy "permission-scoped lead updates" on public.leads for update using (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('leads.manage')
) with check (
  public.current_role() in ('worker', 'superadmin') or public.has_permission('leads.manage')
);
create policy "admins delete leads" on public.leads for delete using (public.current_role() = 'superadmin');
