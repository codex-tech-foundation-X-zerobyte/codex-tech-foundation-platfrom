-- Team Files (§21/§34 of the brief), built on Supabase Storage as instructed
-- — no Cloudflare R2 in this pass. Extends the existing `resources` table
-- rather than creating a second, competing "files" table: folders are just
-- resources rows with is_folder = true and no storage_path, matching the
-- brief's own "one canonical structure per concept" rule.

alter table public.resources add column if not exists parent_id uuid references public.resources(id) on delete cascade;
alter table public.resources add column if not exists is_folder boolean not null default false;
alter table public.resources add column if not exists size_bytes bigint;
alter table public.resources add column if not exists mime_type text;
alter table public.resources add column if not exists download_count integer not null default 0;
alter table public.resources add column if not exists current_version integer not null default 1;
-- `deleted_at`: trash state. Distinct from the existing `archived_at`, which
-- previously did double duty as "hidden AND storage object already
-- removed" (see resourceFiles.ts before this pass — deleteResource() called
-- storage.remove() immediately, so "archived" files were not actually
-- recoverable despite looking like a soft delete). Now: `deleted_at` set =
-- in trash, file object still exists, restorable. Permanent delete (from
-- the trash view) is the only path that removes the storage object.
alter table public.resources add column if not exists deleted_at timestamptz;

create index if not exists resources_parent_idx on public.resources(parent_id);
create index if not exists resources_deleted_idx on public.resources(deleted_at);

create table if not exists public.resource_versions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  version integer not null,
  storage_path text not null,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (resource_id, version)
);
alter table public.resource_versions enable row level security;

-- Same access model as `resources` itself (see "admins manage resources"
-- from the Pass 3 migration) — team-wide library, not project- or
-- client-scoped, so version history follows the parent table's policy shape.
create policy "team manages resource versions" on public.resource_versions for all using (
  public.current_role() in ('worker', 'manager', 'superadmin')
) with check (
  public.current_role() in ('worker', 'manager', 'superadmin')
);

-- audit_logs had NO insert policy at all — only "admins view audit logs"
-- (select) exists. Every write to audit_logs up to this point has gone
-- through an Edge Function's service-role client, which bypasses RLS
-- entirely. Team Files activity logging (file.uploaded/downloaded/trashed/
-- restored/permanently_deleted) is written directly from the browser, so it
-- needs an actual insert policy — without this, resourceFiles.ts's
-- logFileActivity() would fail silently on every call and nothing would
-- ever be logged, despite the code looking like it works.
-- Scoped deliberately narrow: only these five file-specific actions, only
-- resource_type = 'resources', and actor_user_id must equal the caller's
-- own auth.uid() (no spoofing another actor). This does NOT open the door
-- to inserting arbitrary security-critical entries like 'role.assigned' or
-- 'worker.created' — those remain writable only via service-role Edge
-- Functions, exactly as before.
create policy "team logs their own file activity" on public.audit_logs for insert to authenticated with check (
  actor_user_id = auth.uid()
  and resource_type = 'resources'
  and action in ('file.uploaded', 'file.version_uploaded', 'file.trashed', 'file.restored', 'file.permanently_deleted', 'file.downloaded')
);
