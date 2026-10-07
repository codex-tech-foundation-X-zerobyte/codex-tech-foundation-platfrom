insert into public.permissions (key, description) values
  ('notifications.broadcast', 'Send a notification to a broad audience (all workers, all managers, or everyone internal)')
on conflict (key) do nothing;

-- Manager gets it by default — consistent with their existing broad
-- operational grants (projects.assign, clients.update, etc.).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key = 'notifications.broadcast'
where r.name = 'manager'
on conflict do nothing;
