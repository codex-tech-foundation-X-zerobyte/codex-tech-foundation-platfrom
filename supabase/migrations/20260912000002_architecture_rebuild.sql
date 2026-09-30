-- V2 architecture: normalized identities, RBAC, lifecycle states and least-privilege access.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists publication_status text not null default 'draft'
  check (publication_status in ('draft','review','published','unpublished','archived'));
alter table public.projects add column if not exists published_at timestamptz;
alter table public.projects add column if not exists public_visibility boolean not null default false;
create unique index if not exists projects_slug_unique_idx on public.projects(slug) where slug is not null;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(), name text unique not null,
  description text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(), key text unique not null,
  description text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, role_id)
);
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(), name text unique not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.worker_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  worker_id text unique not null, department_id uuid references public.departments(id),
  position text not null default '', phone text, bio text not null default '',
  skills text[] not null default '{}', status text not null default 'active' check (status in ('active','suspended','banned','inactive')),
  join_date date, avatar_path text, must_change_password boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.client_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.client_projects (
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  created_at timestamptz not null default now(), primary key (client_id, project_id)
);
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  title text not null, description text not null default '', status text not null default 'planned',
  percentage integer not null default 0 check (percentage between 0 and 100), target_date date,
  completed_date date, display_order integer not null default 0,
  is_public boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.case_studies (
  id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null,
  summary text not null default '', client_id uuid references public.clients(id), project_id uuid references public.projects(id),
  problem text not null default '', goals text not null default '', approach text not null default '',
  challenges text not null default '', solution text not null default '', results text not null default '',
  metrics jsonb not null default '[]', technologies text[] not null default '{}', cover_path text,
  gallery jsonb not null default '[]', author_id uuid references auth.users(id),
  publication_status text not null default 'draft' check (publication_status in ('draft','review','published','unpublished','archived')),
  featured boolean not null default false, seo_title text, seo_description text, published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.team_profiles (
  id uuid primary key default gen_random_uuid(), worker_user_id uuid references public.worker_profiles(user_id),
  display_name text not null, public_title text not null default '', bio text not null default '',
  photo_path text, skills text[] not null default '{}', social_links jsonb not null default '{}',
  display_order integer not null default 0, featured boolean not null default false, is_public boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references auth.users(id),
  action text not null, resource_type text not null, resource_id uuid, metadata jsonb not null default '{}',
  ip_address inet, user_agent text, success boolean not null default true, severity text not null default 'info',
  created_at timestamptz not null default now()
);
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app boolean not null default true, email boolean not null default true, push boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text unique not null, subscription jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.system_settings (
  key text primary key, value jsonb not null default '{}', is_secret boolean not null default false,
  updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function public.has_permission(permission_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.key = permission_key
  ) or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'superadmin'
  )
$$;

create or replace function public.provision_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', '')) on conflict (id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.provision_profile();

do $$ declare t text; begin
  foreach t in array array['roles','permissions','departments','worker_profiles','client_users','client_projects','project_milestones','case_studies','team_profiles','audit_logs','notification_preferences','push_subscriptions','system_settings'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "published case studies are public" on public.case_studies for select using (publication_status = 'published');
create policy "published projects are public" on public.projects for select using (publication_status = 'published' and public_visibility = true and archived_at is null);
create policy "published team profiles are public" on public.team_profiles for select using (is_public = true);
create policy "members view assigned client projects" on public.client_projects for select using (
  exists (select 1 from public.client_users cu where cu.client_id = client_projects.client_id and cu.user_id = auth.uid() and cu.status = 'active')
  or public.has_permission('projects.view')
);
create policy "users view own worker record" on public.worker_profiles for select using (user_id = auth.uid() or public.has_permission('workers.view'));
create policy "users view own client record" on public.client_users for select using (user_id = auth.uid() or public.has_permission('clients.view'));
create policy "users view own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "users update own notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins view audit logs" on public.audit_logs for select using (public.has_permission('audit_logs.view'));
create policy "users manage own notification preferences" on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users manage own push subscriptions" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists worker_profiles_worker_id_idx on public.worker_profiles(worker_id);
create index if not exists case_studies_publication_idx on public.case_studies(publication_status, published_at desc);
create index if not exists project_milestones_project_idx on public.project_milestones(project_id, display_order);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

do $$ declare t text; begin
  foreach t in array array['roles','permissions','departments','worker_profiles','client_users','project_milestones','case_studies','team_profiles','notification_preferences','push_subscriptions','system_settings'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', t, t);
  end loop;
end $$;
