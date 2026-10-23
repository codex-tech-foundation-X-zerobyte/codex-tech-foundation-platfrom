-- Codex Tech Foundation Workspace: departments ship WITH the product.
--
-- The company already has these departments. Nobody creates them by hand, and the application resolves each one to its
-- environment definition (dashboard, tools, boards, workflows, channels, metrics) by `slug`. See
-- src/workspaces/definitions.ts and docs/workspace/WORKSPACE_ARCHITECTURE.md.
--
-- This migration is idempotent and non-destructive: departments an admin already created are kept; one whose name matches
-- a Codex department is adopted (gets the slug) rather than duplicated.

-- 1. Identity of a department --------------------------------------------------------------------------------------
alter table public.departments add column if not exists slug text;
alter table public.departments add column if not exists is_system boolean not null default false;
create unique index if not exists departments_slug_key on public.departments (slug) where slug is not null;

-- 2. Seed the Codex departments ------------------------------------------------------------------------------------
-- Adopt an existing row with the same name first...
update public.departments d
   set slug = v.slug, is_system = true
  from (values
    ('Frontend Development', 'frontend-development'),
    ('Backend Development',  'backend-development'),
    ('DevOps',               'devops'),
    ('Cybersecurity',        'cybersecurity'),
    ('UI/UX Design',         'ui-ux-design'),
    ('Graphics & Creative',  'graphics-creative'),
    ('Content',              'content'),
    ('Marketing',            'marketing')
  ) as v(name, slug)
 where d.slug is null
   and lower(d.name) = lower(v.name)
   and not exists (select 1 from public.departments x where x.slug = v.slug);

-- ...then create whatever is still missing.
insert into public.departments (name, slug, is_system)
select v.name, v.slug, true
  from (values
    ('Frontend Development', 'frontend-development'),
    ('Backend Development',  'backend-development'),
    ('DevOps',               'devops'),
    ('Cybersecurity',        'cybersecurity'),
    ('UI/UX Design',         'ui-ux-design'),
    ('Graphics & Creative',  'graphics-creative'),
    ('Content',              'content'),
    ('Marketing',            'marketing')
  ) as v(name, slug)
 where not exists (select 1 from public.departments x where x.slug = v.slug)
on conflict do nothing;

-- 3. Codex departments are part of the product: they can't be deleted or re-identified ------------------------------
create or replace function public.protect_system_departments() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'The % department is part of Codex Workspace and cannot be deleted.', old.name using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.is_system and (new.slug is distinct from old.slug or new.is_system is not true) then
    raise exception 'The % department is part of Codex Workspace; its identity cannot be changed.', old.name using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists protect_system_departments_del on public.departments;
create trigger protect_system_departments_del before delete on public.departments for each row execute procedure public.protect_system_departments();
drop trigger if exists protect_system_departments_upd on public.departments;
create trigger protect_system_departments_upd before update on public.departments for each row execute procedure public.protect_system_departments();

-- 4. Department Admin -----------------------------------------------------------------------------------------------
-- A worker belongs to one department and is either a member or that department's admin. `profiles.role` stays the coarse
-- account class; this column is the department-scoped layer. Only a Main Admin (superadmin) may change it, so a manager
-- holding workers.update cannot promote themselves.
alter table public.worker_profiles add column if not exists department_role text not null default 'member';
alter table public.worker_profiles drop constraint if exists worker_profiles_department_role_check;
alter table public.worker_profiles add constraint worker_profiles_department_role_check check (department_role in ('member', 'admin'));

create or replace function public.guard_department_role() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.department_role is distinct from old.department_role and coalesce(public.current_role()::text, '') <> 'superadmin' then
    raise exception 'Only a Main Admin can assign or remove Department Admins.' using errcode = '42501';
  end if;
  -- An admin needs a department to administer.
  if new.department_role = 'admin' and new.department_id is null then
    raise exception 'A Department Admin must belong to a department.' using errcode = '23514';
  end if;
  -- Moving a worker to another department ends their admin role in the old one.
  if new.department_id is distinct from old.department_id and new.department_role is not distinct from old.department_role and old.department_role = 'admin' then
    new.department_role := 'member';
  end if;
  return new;
end $$;
drop trigger if exists guard_department_role on public.worker_profiles;
create trigger guard_department_role before update on public.worker_profiles for each row execute procedure public.guard_department_role();

-- 5. Who can read departments ----------------------------------------------------------------------------------------
-- Until now only a superadmin could even SELECT from departments, so no worker could resolve their own department
-- environment. Internal accounts may read them (clients may not); writes stay superadmin-only.
drop policy if exists "internal users read departments" on public.departments;
create policy "internal users read departments" on public.departments for select
  using (public.current_role() in ('worker', 'manager', 'superadmin'));
