-- Company core: meetings, knowledge base, onboarding, department records (the engine behind the real department tools),
-- whiteboards, integrations (secrets stay server-side), webhook inboxes, task links, and department channels.
-- Every table is department-aware: a person sees their own department's material plus what is company-wide.

-- 1. Meetings -----------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.meetings (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 1 and 160),
  project_id    uuid references public.projects(id) on delete set null,
  department_id uuid references public.departments(id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text not null default '',
  agenda        text not null default '' check (length(agenda) <= 5000),
  notes         text not null default '' check (length(notes) <= 20000),
  recording_url text not null default '',
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists meetings_starts_idx on public.meetings (starts_at);
create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null references public.profiles(id),
  primary key (meeting_id, user_id)
);
create table if not exists public.meeting_action_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 500),
  assignee_id uuid references public.profiles(id),
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_action_items enable row level security;

create or replace function public.can_see_meeting(p_meeting uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m where m.id = p_meeting and (
         public."current_role"() = 'superadmin'
      or m.created_by = auth.uid()
      or exists (select 1 from public.meeting_participants mp where mp.meeting_id = m.id and mp.user_id = auth.uid())
      or (m.department_id is not null and m.department_id = public.current_department_id())
      or (m.project_id is not null and public.can_see_project(m.project_id))
    )
  )
$$;
create or replace function public.can_manage_meeting(p_meeting uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m where m.id = p_meeting and (
         public."current_role"() = 'superadmin' or m.created_by = auth.uid() or public.is_department_admin(m.department_id)
    )
  )
$$;
grant execute on function public.can_see_meeting(uuid), public.can_manage_meeting(uuid) to authenticated;

create policy "meetings visible to those involved" on public.meetings for select using (public.can_see_meeting(id));
create policy "meetings scheduled by staff" on public.meetings for insert with check (
  created_by = auth.uid() and public."current_role"() in ('worker', 'manager', 'superadmin')
  and (department_id is null or public."current_role"() = 'superadmin' or department_id = public.current_department_id())
  and (project_id is null or public.can_see_project(project_id))
);
create policy "meetings changed by organiser or department admin" on public.meetings for update using (public.can_manage_meeting(id)) with check (public.can_manage_meeting(id));
create policy "meetings removed by organiser or department admin" on public.meetings for delete using (public.can_manage_meeting(id));
create policy "participants visible with the meeting" on public.meeting_participants for select using (public.can_see_meeting(meeting_id));
create policy "participants invited by organiser" on public.meeting_participants for insert with check (public.can_manage_meeting(meeting_id));
create policy "participants removed by organiser" on public.meeting_participants for delete using (public.can_manage_meeting(meeting_id) or user_id = auth.uid());
create policy "action items visible with the meeting" on public.meeting_action_items for select using (public.can_see_meeting(meeting_id));
create policy "action items added by organiser" on public.meeting_action_items for insert with check (public.can_manage_meeting(meeting_id));
create policy "action items updated by organiser or assignee" on public.meeting_action_items for update using (public.can_manage_meeting(meeting_id) or assignee_id = auth.uid()) with check (public.can_manage_meeting(meeting_id) or assignee_id = auth.uid());
create policy "action items removed by organiser" on public.meeting_action_items for delete using (public.can_manage_meeting(meeting_id));

create or replace function public.stamp_action_item() returns trigger language plpgsql as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now(); elsif not new.done then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists stamp_action_item on public.meeting_action_items;
create trigger stamp_action_item before insert or update on public.meeting_action_items for each row execute procedure public.stamp_action_item();

create or replace function public.notify_meeting_invite() returns trigger language plpgsql security definer set search_path = public as $$
declare m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = new.meeting_id;
  if new.user_id is distinct from m.created_by then
    insert into public.notifications (user_id, title, body) values (new.user_id, 'Meeting invitation', m.title || ' on ' || to_char(m.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
  end if;
  return new;
end $$;
drop trigger if exists notify_meeting_invite on public.meeting_participants;
create trigger notify_meeting_invite after insert on public.meeting_participants for each row execute procedure public.notify_meeting_invite();

create or replace function public.notify_action_item() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) and new.assignee_id is distinct from auth.uid() then
    select title into v_title from public.meetings where id = new.meeting_id;
    insert into public.notifications (user_id, title, body) values (new.assignee_id, 'Action item from ' || v_title, new.body);
  end if;
  return new;
end $$;
drop trigger if exists notify_action_item on public.meeting_action_items;
create trigger notify_action_item after insert or update of assignee_id on public.meeting_action_items for each row execute procedure public.notify_action_item();

-- 2. Knowledge base --------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.knowledge_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) between 1 and 160),
  category      text not null check (category in ('Company', 'Development', 'Security', 'Design', 'Content', 'Marketing', 'Operations', 'Onboarding', 'Technical Documentation', 'Policies')),
  department_id uuid references public.departments(id),
  body          text not null default '' check (length(body) <= 60000),
  author_id     uuid not null default auth.uid() references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists knowledge_category_idx on public.knowledge_documents (category, updated_at desc);
alter table public.knowledge_documents enable row level security;
create policy "knowledge readable by scope" on public.knowledge_documents for select using (
  public."current_role"() = 'superadmin'
  or (public."current_role"() in ('worker', 'manager') and (department_id is null or department_id = public.current_department_id() or public."current_role"() = 'manager'))
);
create policy "knowledge written by authority" on public.knowledge_documents for insert with check (
  author_id = auth.uid() and (public."current_role"() = 'superadmin' or (department_id is not null and public.is_department_admin(department_id)))
);
create policy "knowledge edited by authority" on public.knowledge_documents for update
  using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id))
  with check (public."current_role"() = 'superadmin' or (department_id is not null and public.is_department_admin(department_id)));
create policy "knowledge removed by authority" on public.knowledge_documents for delete using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id));
create or replace function public.stamp_knowledge() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists stamp_knowledge on public.knowledge_documents;
create trigger stamp_knowledge before update on public.knowledge_documents for each row execute procedure public.stamp_knowledge();

-- 3. Onboarding progress (the checklists themselves live in src/workspaces/definitions.ts) -----------------------------------------------------
create table if not exists public.onboarding_progress (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  item_key text not null check (item_key ~ '^[a-z0-9_.:-]{2,80}$'),
  done_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.onboarding_progress enable row level security;
create policy "onboarding visible to self, Main Admin and department admin" on public.onboarding_progress for select using (
  user_id = auth.uid() or public."current_role"() = 'superadmin'
  or exists (select 1 from public.worker_profiles w where w.user_id = onboarding_progress.user_id and public.is_department_admin(w.department_id))
);
create policy "tick your own onboarding items" on public.onboarding_progress for insert with check (user_id = auth.uid() and public."current_role"() in ('worker', 'manager', 'superadmin'));
create policy "untick your own onboarding items" on public.onboarding_progress for delete using (user_id = auth.uid());

-- 4. Department records: bugs, incidents, vulnerabilities, briefs, scripts, campaigns... --------------------------------------------------------
-- One department-scoped table; what a "kind" means (its stages and fields) is defined in src/workspaces/definitions.ts, so a
-- new department tool is a definition, not a migration.
create table if not exists public.department_records (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  kind          text not null check (kind ~ '^[a-z_]{2,40}$'),
  title         text not null check (length(btrim(title)) between 1 and 200),
  stage         text not null check (length(stage) between 1 and 60),
  fields        jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object' and pg_column_size(fields) < 60000),
  assignee_id   uuid references public.profiles(id),
  project_id    uuid references public.projects(id) on delete set null,
  due_date      date,
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists department_records_lookup on public.department_records (department_id, kind, stage);
alter table public.department_records enable row level security;
create policy "records visible to the department" on public.department_records for select using (
  public."current_role"() = 'superadmin' or department_id = public.current_department_id()
);
create policy "records filed by department members" on public.department_records for insert with check (
  created_by = auth.uid() and (public."current_role"() = 'superadmin' or department_id = public.current_department_id())
);
create policy "records edited by owner, assignee or admin" on public.department_records for update
  using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id) or (department_id = public.current_department_id() and (created_by = auth.uid() or assignee_id = auth.uid())))
  with check (public."current_role"() = 'superadmin' or public.is_department_admin(department_id) or (department_id = public.current_department_id() and (created_by = auth.uid() or assignee_id = auth.uid())));
create policy "records removed by admin" on public.department_records for delete using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id));
create or replace function public.guard_department_record() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.department_id, new.kind, new.created_by) is distinct from (old.department_id, old.kind, old.created_by) then
    raise exception 'A record cannot change department, kind or author.' using errcode = '23514';
  end if;
  if new.assignee_id is not null and not exists (select 1 from public.worker_profiles where user_id = new.assignee_id and department_id = new.department_id) then
    raise exception 'Assign records to someone in that department.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists guard_department_record on public.department_records;
create trigger guard_department_record before insert or update on public.department_records for each row execute procedure public.guard_department_record();
create or replace function public.notify_record_assignment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid() and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications (user_id, title, body) values (new.assignee_id, 'Assigned to you', new.title);
  end if;
  return new;
end $$;
drop trigger if exists notify_record_assignment on public.department_records;
create trigger notify_record_assignment after insert or update of assignee_id on public.department_records for each row execute procedure public.notify_record_assignment();

-- 5. Whiteboards (UI/UX design studio) ------------------------------------------------------------------------------------------------------------
create table if not exists public.whiteboards (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  title         text not null check (length(btrim(title)) between 1 and 120),
  data          jsonb not null default '{"shapes":[]}'::jsonb check (pg_column_size(data) < 900000),
  version       int not null default 1,
  created_by    uuid not null default auth.uid() references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.whiteboards enable row level security;
create policy "whiteboards visible to the department" on public.whiteboards for select using (public."current_role"() = 'superadmin' or department_id = public.current_department_id());
create policy "whiteboards created by department members" on public.whiteboards for insert with check (created_by = auth.uid() and (public."current_role"() = 'superadmin' or department_id = public.current_department_id()));
create policy "whiteboards edited by department members" on public.whiteboards for update using (public."current_role"() = 'superadmin' or department_id = public.current_department_id()) with check (public."current_role"() = 'superadmin' or department_id = public.current_department_id());
create policy "whiteboards removed by admin" on public.whiteboards for delete using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id));
-- Optimistic locking: a save must be based on the version the editor loaded, so two people never silently overwrite each other.
create or replace function public.guard_whiteboard() returns trigger language plpgsql as $$
begin
  if new.department_id is distinct from old.department_id then raise exception 'A whiteboard cannot move department.' using errcode = '23514'; end if;
  if new.version is distinct from old.version + 1 then raise exception 'This whiteboard changed while you were editing. Reload to see the latest.' using errcode = '40001'; end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists guard_whiteboard on public.whiteboards;
create trigger guard_whiteboard before update on public.whiteboards for each row execute procedure public.guard_whiteboard();
alter publication supabase_realtime add table public.whiteboards;

-- 6. Integrations ----------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.integrations (
  provider        text primary key check (provider in ('github', 'figma', 'canva', 'analytics')),
  status          text not null default 'not_connected' check (status in ('not_connected', 'needs_authorization', 'connected', 'error')),
  config          jsonb not null default '{}'::jsonb,   -- NON-secret settings only (account name, workspace URL)
  connected_by    uuid references public.profiles(id),
  connected_at    timestamptz,
  last_checked_at timestamptz,
  last_error      text not null default ''
);
insert into public.integrations (provider) values ('github'), ('figma'), ('canva'), ('analytics') on conflict do nothing;
alter table public.integrations enable row level security;
create policy "integrations visible to staff" on public.integrations for select using (public."current_role"() in ('worker', 'manager', 'superadmin'));
create policy "integrations managed by main admin" on public.integrations for update using (public."current_role"() = 'superadmin') with check (public."current_role"() = 'superadmin');

-- Secrets: RLS ON with NO policies, so no browser session can ever read or write them. Only Edge Functions using the service
-- role touch this table.
create table if not exists public.integration_secrets (
  provider   text primary key references public.integrations(provider) on delete cascade,
  secret     text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

create table if not exists public.integration_repositories (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null unique check (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  department_id uuid references public.departments(id),
  project_id    uuid references public.projects(id) on delete set null,
  added_by      uuid default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now()
);
alter table public.integration_repositories enable row level security;
create policy "repositories visible to their department" on public.integration_repositories for select using (
  public."current_role"() = 'superadmin' or department_id = public.current_department_id() or (project_id is not null and public.can_see_project(project_id))
);
create policy "repositories linked by main admin" on public.integration_repositories for insert with check (public."current_role"() = 'superadmin');
create policy "repositories relinked by main admin" on public.integration_repositories for update using (public."current_role"() = 'superadmin') with check (public."current_role"() = 'superadmin');
create policy "repositories unlinked by main admin" on public.integration_repositories for delete using (public."current_role"() = 'superadmin');

create table if not exists public.task_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  kind       text not null check (kind in ('pull_request', 'issue', 'branch', 'commit', 'design', 'other')),
  url        text not null check (url ~ '^https://' and length(url) <= 500),
  label      text not null default '' check (length(label) <= 160),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.task_links enable row level security;
create policy "task links readable with the task" on public.task_links for select using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "task links added by people working the task" on public.task_links for insert with check (public.can_work_task(task_id));
create policy "task links removed by people working the task" on public.task_links for delete using (public.can_work_task(task_id));

-- 7. Webhook inboxes (Backend webhook tester) -----------------------------------------------------------------------------------------------------
create table if not exists public.webhook_inboxes (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  name          text not null check (length(btrim(name)) between 1 and 80),
  token         text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now()
);
create table if not exists public.webhook_requests (
  id          uuid primary key default gen_random_uuid(),
  inbox_id    uuid not null references public.webhook_inboxes(id) on delete cascade,
  method      text not null,
  path        text not null default '',
  query       text not null default '',
  headers     jsonb not null default '{}'::jsonb,
  body        text not null default '',
  received_at timestamptz not null default now()
);
create index if not exists webhook_requests_inbox_idx on public.webhook_requests (inbox_id, received_at desc);
alter table public.webhook_inboxes enable row level security;
alter table public.webhook_requests enable row level security;
create policy "inboxes visible to the department" on public.webhook_inboxes for select using (public."current_role"() = 'superadmin' or department_id = public.current_department_id());
create policy "inboxes created by department members" on public.webhook_inboxes for insert with check (created_by = auth.uid() and (public."current_role"() = 'superadmin' or department_id = public.current_department_id()));
create policy "inboxes removed by admin or creator" on public.webhook_inboxes for delete using (public."current_role"() = 'superadmin' or public.is_department_admin(department_id) or created_by = auth.uid());
create policy "captured requests visible with the inbox" on public.webhook_requests for select using (exists (select 1 from public.webhook_inboxes i where i.id = inbox_id));
create policy "captured requests cleared with the inbox" on public.webhook_requests for delete using (exists (select 1 from public.webhook_inboxes i where i.id = inbox_id));
-- Rows are inserted only by the webhook-inbox Edge Function (service role). Keep each inbox to its latest 200.
create or replace function public.trim_webhook_requests() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.webhook_requests where inbox_id = new.inbox_id and id in (select id from public.webhook_requests where inbox_id = new.inbox_id order by received_at desc offset 200);
  return new;
end $$;
drop trigger if exists trim_webhook_requests on public.webhook_requests;
create trigger trim_webhook_requests after insert on public.webhook_requests for each row execute procedure public.trim_webhook_requests();
alter publication supabase_realtime add table public.webhook_requests;

-- 8. Department channels ----------------------------------------------------------------------------------------------------------------------------
alter table public.chat_channels add column if not exists department_id uuid references public.departments(id);
create unique index if not exists chat_channels_department_name on public.chat_channels (department_id, name) where department_id is not null;

insert into public.chat_channels (type, name, department_id)
select 'group', d.name || ' · ' || c.channel, d.id
  from (values
    ('frontend-development', '#general'), ('frontend-development', '#development'), ('frontend-development', '#bugs'),
    ('backend-development', '#general'), ('backend-development', '#api'), ('backend-development', '#database'),
    ('devops', '#general'), ('devops', '#deployments'), ('devops', '#incidents'),
    ('cybersecurity', '#general'), ('cybersecurity', '#security-ops'), ('cybersecurity', '#security-lab'), ('cybersecurity', '#incidents'),
    ('ui-ux-design', '#general'), ('ui-ux-design', '#design-review'), ('ui-ux-design', '#research'),
    ('graphics-creative', '#general'), ('graphics-creative', '#requests'), ('graphics-creative', '#creative-review'),
    ('content', '#general'), ('content', '#scripts'), ('content', '#content-review'),
    ('marketing', '#general'), ('marketing', '#campaigns'), ('marketing', '#growth')
  ) as c(slug, channel)
  join public.departments d on d.slug = c.slug
on conflict do nothing;

-- Membership follows the person: their department's channels while they are in good standing, every department channel for a Main Admin.
create or replace function public.sync_department_channels(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_role app_role; v_dept uuid; v_ok boolean;
begin
  select role into v_role from public.profiles where id = p_user;
  select department_id, status in ('invited', 'active', 'suspension_pending') into v_dept, v_ok from public.worker_profiles where user_id = p_user;
  delete from public.chat_channel_members m using public.chat_channels c
   where m.user_id = p_user and c.id = m.channel_id and c.department_id is not null
     and not (v_role = 'superadmin' or (coalesce(v_ok, false) and c.department_id = v_dept));
  insert into public.chat_channel_members (channel_id, user_id)
    select c.id, p_user from public.chat_channels c
     where c.department_id is not null and (v_role = 'superadmin' or (coalesce(v_ok, false) and c.department_id = v_dept))
    on conflict do nothing;
end $$;
create or replace function public.trg_sync_department_channels() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- worker_profiles rows carry user_id; profiles rows carry id. (Field access is resolved at plan time, so go through JSON.)
  perform public.sync_department_channels(coalesce((to_jsonb(new) ->> 'user_id')::uuid, (to_jsonb(new) ->> 'id')::uuid));
  return new;
end $$;
drop trigger if exists sync_channels_worker on public.worker_profiles;
create trigger sync_channels_worker after insert or update of department_id, status on public.worker_profiles for each row execute procedure public.trg_sync_department_channels();
drop trigger if exists sync_channels_profile on public.profiles;
create trigger sync_channels_profile after update of role on public.profiles for each row when (new.role = 'superadmin' or old.role = 'superadmin') execute procedure public.trg_sync_department_channels();
select public.sync_department_channels(id) from public.profiles where role = 'superadmin' or id in (select user_id from public.worker_profiles);
