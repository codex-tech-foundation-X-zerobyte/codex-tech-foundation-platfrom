-- Pass 4: Client provisioning schema support. Mirrors the Worker ID pattern
-- from Pass 3 (worker_profiles.worker_id) so resolve-client-login can be a
-- straight copy of resolve-worker-login's shape. See /docs/AUTH-RULES.md.

alter table public.clients add column if not exists client_code text unique;
create index if not exists clients_client_code_idx on public.clients(client_code);

-- Bug fix found while wiring this up: a client user had no RLS policy
-- letting them read their OWN company's `clients` row at all — only
-- worker/manager/superadmin (or the internal owner_id) could select from
-- `clients`. The client portal's dashboard would have had no way to show
-- the client's own organization name. Additive, mirrors the existing
-- "members view assigned client projects" pattern on client_projects.
create policy "clients view own company" on public.clients for select using (
  exists (
    select 1 from public.client_users cu
    where cu.client_id = clients.id and cu.user_id = auth.uid() and cu.status = 'active'
  )
);
