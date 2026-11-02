-- Consolidation: audit_log (initial.sql) was superseded by audit_logs
-- (architecture_rebuild.sql), and settings (platform_content.sql) was
-- superseded by system_settings (architecture_rebuild.sql). Both old tables
-- were left behind with nothing reading or writing them — confirmed by
-- grepping the full repository (migrations, edge functions, and src/) before
-- writing this migration. Data is migrated defensively in case either table
-- picked up rows in a live environment between the two migrations landing.

-- audit_log -> audit_logs. Column shapes differ slightly (audit_log has no
-- `success` column; audit_logs does), so map what exists and default the rest.
insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata, created_at)
select actor_id, action, entity_type, entity_id, metadata, created_at
from public.audit_log
on conflict do nothing;

-- settings -> system_settings. `settings` was a simple key/value table;
-- system_settings adds is_secret/updated_by. Preserve existing values.
insert into public.system_settings (key, value, updated_at)
select key, value, coalesce(updated_at, now()) from public.settings
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

drop policy if exists "admins manage settings" on public.settings;
drop table public.settings;

drop policy if exists "audit admins only" on public.audit_log;
drop table public.audit_log;
