-- Expanded operational, publishing, and lead-generation schema.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization text not null,
  contact_name text,
  contact_email text,
  status text not null default 'active' check (status in ('prospect','active','paused','archived')),
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.projects add column if not exists client_account_id uuid references public.clients(id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  assignee_id uuid references public.profiles(id),
  title text not null,
  description text not null default '',
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null default 'general',
  url text,
  storage_path text,
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id),
  title text not null,
  body text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requester_id uuid references public.profiles(id),
  title text not null,
  body text not null default '',
  status text not null default 'open' check (status in ('open','in_review','approved','declined','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid references public.profiles(id),
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table public.content_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  page_type text not null default 'page' check (page_type in ('page','service','project','case_study')),
  cover_path text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  author_id uuid references public.profiles(id),
  cover_path text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.careers (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  team text not null default '',
  location text not null default '',
  employment_type text not null default 'full_time',
  description text not null default '',
  requirements text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.careers(id) on delete cascade,
  name text not null,
  email text not null,
  resume_path text,
  cover_note text not null default '',
  status text not null default 'received' check (status in ('received','reviewing','interview','declined','hired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  message text not null default '',
  source text not null default 'website',
  status text not null default 'new' check (status in ('new','qualified','contacted','converted','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index projects_client_account_idx on public.projects(client_account_id);
create index tasks_project_status_idx on public.tasks(project_id,status);
create index tasks_assignee_due_idx on public.tasks(assignee_id,due_date);
create index project_updates_project_published_idx on public.project_updates(project_id,published_at desc);
create index project_requests_project_status_idx on public.project_requests(project_id,status);
create index project_files_project_idx on public.project_files(project_id);
create index content_pages_type_published_idx on public.content_pages(page_type,published_at desc);
create index blog_posts_published_idx on public.blog_posts(published_at desc);
create index careers_published_idx on public.careers(published_at desc);
create index applications_career_status_idx on public.applications(career_id,status);
create index leads_status_created_idx on public.leads(status,created_at desc);

alter table public.clients enable row level security;
alter table public.tasks enable row level security;
alter table public.resources enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_requests enable row level security;
alter table public.project_files enable row level security;
alter table public.content_pages enable row level security;
alter table public.blog_posts enable row level security;
alter table public.careers enable row level security;
alter table public.applications enable row level security;
alter table public.leads enable row level security;
alter table public.settings enable row level security;

create policy "published pages are public" on public.content_pages for select using (published_at is not null and archived_at is null);
create policy "published posts are public" on public.blog_posts for select using (published_at is not null and archived_at is null);
create policy "published careers are public" on public.careers for select using (published_at is not null and archived_at is null);
create policy "admins manage content" on public.content_pages for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage posts" on public.blog_posts for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage careers" on public.careers for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "public may submit leads" on public.leads for insert with check (true);
create policy "admins manage leads" on public.leads for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "public may submit applications" on public.applications for insert with check (true);
create policy "admins manage applications" on public.applications for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "admins manage settings" on public.settings for all using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');
create policy "project members read tasks" on public.tasks for select using (exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid() or p.client_account_id in (select id from public.clients where owner_id = auth.uid()))));
create policy "workers manage tasks" on public.tasks for all using (public.current_role() in ('worker','superadmin')) with check (public.current_role() in ('worker','superadmin'));
create policy "project members read updates" on public.project_updates for select using (exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or p.client_id = auth.uid())) or public.current_role() = 'superadmin');
create policy "project members read requests" on public.project_requests for select using (requester_id = auth.uid() or public.current_role() in ('worker','superadmin'));
create policy "project members read files" on public.project_files for select using (uploaded_by = auth.uid() or public.current_role() in ('worker','superadmin'));
create policy "admins read clients" on public.clients for select using (public.current_role() in ('worker','superadmin') or owner_id = auth.uid());
create policy "admins manage resources" on public.resources for all using (public.current_role() in ('worker','superadmin')) with check (public.current_role() in ('worker','superadmin'));

insert into storage.buckets (id, name, public) values ('public-content', 'public-content', true), ('private-project-files', 'private-project-files', false), ('applications', 'applications', false) on conflict (id) do nothing;
create policy "published content objects are public" on storage.objects for select using (bucket_id = 'public-content');
create policy "admins upload public content" on storage.objects for insert to authenticated with check (bucket_id = 'public-content' and public.current_role() = 'superadmin');
create policy "project files isolated by project" on storage.objects for select to authenticated using (bucket_id = 'private-project-files' and (split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid()) or public.current_role() in ('worker','superadmin')));
create policy "project members upload files" on storage.objects for insert to authenticated with check (bucket_id = 'private-project-files' and (split_part(name, '/', 1) in (select p.id::text from public.projects p where p.owner_id = auth.uid() or p.client_id = auth.uid()) or public.current_role() in ('worker','superadmin')));
create policy "admins manage applications storage" on storage.objects for all to authenticated using (bucket_id = 'applications' and public.current_role() = 'superadmin') with check (bucket_id = 'applications' and public.current_role() = 'superadmin');
