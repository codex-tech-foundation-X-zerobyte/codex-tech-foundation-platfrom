-- The `resources` table (platform_content migration) has a storage_path column
-- but no bucket was ever created for it — the file manager UI has nothing to
-- upload to without this.

insert into storage.buckets (id, name, public) values ('resources', 'resources', false) on conflict (id) do nothing;

create policy "workers read resources storage" on storage.objects for select to authenticated using (
  bucket_id = 'resources' and public.current_role() in ('worker', 'superadmin')
);
create policy "workers upload resources storage" on storage.objects for insert to authenticated with check (
  bucket_id = 'resources' and public.current_role() in ('worker', 'superadmin')
);
create policy "workers delete resources storage" on storage.objects for delete to authenticated using (
  bucket_id = 'resources' and public.current_role() in ('worker', 'superadmin')
);
