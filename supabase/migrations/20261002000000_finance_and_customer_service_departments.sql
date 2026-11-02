-- Two more built-in departments, shipped with the product like the original eight: Finance and Customer Service.
-- Idempotent and non-destructive: an existing department with the same name is adopted (gets the slug) rather than duplicated.

update public.departments d set slug = v.slug, is_system = true
  from (values ('Finance', 'finance'), ('Customer Service', 'customer-service')) as v(name, slug)
 where d.slug is null and lower(d.name) = lower(v.name) and not exists (select 1 from public.departments x where x.slug = v.slug);

insert into public.departments (name, slug, is_system)
select v.name, v.slug, true from (values ('Finance', 'finance'), ('Customer Service', 'customer-service')) as v(name, slug)
 where not exists (select 1 from public.departments x where x.slug = v.slug)
on conflict do nothing;

-- Department chat channels, same naming as the others ("Finance · #general").
insert into public.chat_channels (type, name, department_id)
select 'group', d.name || ' · ' || c.channel, d.id
  from public.departments d
  join (values ('finance', '#general'), ('finance', '#requests'), ('finance', '#reconciliation'),
               ('customer-service', '#general'), ('customer-service', '#escalations'), ('customer-service', '#quality')) as c(slug, channel) on c.slug = d.slug
 where not exists (select 1 from public.chat_channels x where x.department_id = d.id and x.name = d.name || ' · ' || c.channel);

-- Members who are already in these departments (none yet, but a re-run must be safe) get their channels.
select public.sync_department_channels(user_id) from public.worker_departments wd join public.departments d on d.id = wd.department_id where d.slug in ('finance', 'customer-service');

create or replace function public.department_id_by_slug(p_slug text) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.departments where slug = p_slug
$$;
