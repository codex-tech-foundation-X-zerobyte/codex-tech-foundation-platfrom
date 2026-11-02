-- Presentation board: a worker presents their work live to their department (or the whole company). A progressive web app cannot share the
-- screen to the outside, so presenters use an in-app stage that matches their craft: a browser for frontend, a console for backend, a
-- dashboard for marketing, a cinema for video, slides for text. Everyone watching sees the same stage, live.
--
-- Live sync: the presenter updates `state`; viewers get the change over Realtime (RLS decides who may subscribe) and the row also lets
-- someone who joins late catch up on what is on stage right now.

create table if not exists public.presentation_sessions (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  presenter_id  uuid not null references public.profiles (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  kind          text not null check (kind in ('browser', 'console', 'dashboard', 'cinema', 'slides')),
  visibility    text not null default 'department' check (visibility in ('department', 'company')),
  status        text not null default 'live' check (status in ('live', 'ended')),
  state         jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 262144),
  state_version bigint not null default 0,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  updated_at    timestamptz not null default now(),
  constraint presentation_department_for_department_visibility check (visibility = 'company' or department_id is not null)
);
create index if not exists presentation_sessions_live_idx on public.presentation_sessions (status, updated_at desc);
create index if not exists presentation_sessions_department_idx on public.presentation_sessions (department_id, started_at desc);
create index if not exists presentation_sessions_presenter_idx on public.presentation_sessions (presenter_id);

create or replace function public.can_see_presentation(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.presentation_sessions s
     where s.id = p_session
       and (
            s.presenter_id = auth.uid()
         or public."current_role"() = 'superadmin'
         or (public."current_role"() in ('worker', 'manager') and (
               s.visibility = 'company'
            or (s.department_id is not null and s.department_id = any (public.current_department_ids()))
         ))
       )
  )
$$;

create or replace function public.is_presentation_presenter(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.presentation_sessions where id = p_session and presenter_id = auth.uid())
$$;

alter table public.presentation_sessions enable row level security;
drop policy if exists "presentations readable by their audience" on public.presentation_sessions;
create policy "presentations readable by their audience" on public.presentation_sessions for select to authenticated using (
     presenter_id = auth.uid()
  or public."current_role"() = 'superadmin'
  or (public."current_role"() in ('worker', 'manager') and (
        visibility = 'company'
     or (department_id is not null and department_id = any (public.current_department_ids()))
  ))
);   -- reads the row's own columns: a lookup-by-id function cannot see a row that INSERT ... RETURNING is still creating
drop policy if exists "staff start presentations for their departments" on public.presentation_sessions;
create policy "staff start presentations for their departments" on public.presentation_sessions for insert to authenticated with check (
  presenter_id = auth.uid()
  and public."current_role"() in ('worker', 'manager', 'superadmin')
  and (public."current_role"() = 'superadmin' or department_id is null or department_id = any (public.current_department_ids()))
);
drop policy if exists "presenters run their presentation; Main Admins can end any" on public.presentation_sessions;
create policy "presenters run their presentation; Main Admins can end any" on public.presentation_sessions for update to authenticated
  using (presenter_id = auth.uid() or public."current_role"() = 'superadmin') with check (presenter_id = auth.uid() or public."current_role"() = 'superadmin');
drop policy if exists "presenters and Main Admins delete presentations" on public.presentation_sessions;
create policy "presenters and Main Admins delete presentations" on public.presentation_sessions for delete to authenticated
  using (presenter_id = auth.uid() or public."current_role"() = 'superadmin');
grant select, insert, update, delete on public.presentation_sessions to authenticated;

-- A session's identity never changes; only the presenter changes what is on stage (a Main Admin may only end it).
create or replace function public.guard_presentation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- someone presents one thing at a time: starting a new one ends their previous live session
    update public.presentation_sessions set status = 'ended', ended_at = now(), updated_at = now() where presenter_id = new.presenter_id and status = 'live';
    new.status := 'live'; new.ended_at := null; new.state_version := 0; new.started_at := now(); new.updated_at := now();
    return new;
  end if;
  if (new.id, new.presenter_id, new.department_id, new.kind) is distinct from (old.id, old.presenter_id, old.department_id, old.kind) then
    raise exception 'A presentation''s presenter, department and stage type cannot change.' using errcode = '23514';
  end if;
  if old.status = 'ended' and new.status = 'live' then raise exception 'An ended presentation cannot be restarted. Start a new one.' using errcode = '23514'; end if;
  if auth.uid() is not null and auth.uid() <> old.presenter_id and (new.state, new.title, new.visibility) is distinct from (old.state, old.title, old.visibility) then
    raise exception 'Only the presenter controls the stage. A Main Admin can end a presentation.' using errcode = '42501';
  end if;
  if new.state is distinct from old.state then new.state_version := old.state_version + 1; end if;
  if new.status = 'ended' and old.status = 'live' then new.ended_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_presentation on public.presentation_sessions;
create trigger guard_presentation before insert or update on public.presentation_sessions for each row execute function public.guard_presentation();

-- Tell the audience when someone goes live.
create or replace function public.notify_presentation_started() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select coalesce(display_name, 'A teammate') into v_name from public.profiles where id = new.presenter_id;
  insert into public.notifications (user_id, title, body, kind)
    select p.id, v_name || ' is presenting', new.title, 'presentation'
      from public.profiles p left join public.worker_profiles wp on wp.user_id = p.id
     where p.id <> new.presenter_id
       and (p.role = 'superadmin'
         or (p.role in ('worker', 'manager') and wp.status = 'active' and (new.visibility = 'company'
              or exists (select 1 from public.worker_departments wd where wd.user_id = p.id and wd.department_id = new.department_id))));
  return new;
end $$;
drop trigger if exists notify_presentation_started on public.presentation_sessions;
create trigger notify_presentation_started after insert on public.presentation_sessions for each row execute function public.notify_presentation_started();

do $$ begin
  alter publication supabase_realtime add table public.presentation_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Server clock, so a viewer who joins late can line a video up with the presenter without trusting their own device clock.
create or replace function public.server_time_ms() returns bigint language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
grant execute on function public.server_time_ms() to authenticated;

-- Video and image files the presenter shows. Objects live at <session_id>/<file>. 50 MB is Supabase's default per-file ceiling.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (
  'presentations', 'presentations', false, 52428800, array['video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
) on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "audience reads presentation files" on storage.objects;
drop policy if exists "audience reads presentation files" on storage.objects;
create policy "audience reads presentation files" on storage.objects for select to authenticated using (
  bucket_id = 'presentations' and public.uuid_from_path_segment(name, 1) is not null and public.can_see_presentation(public.uuid_from_path_segment(name, 1))
);
drop policy if exists "presenters upload presentation files" on storage.objects;
drop policy if exists "presenters upload presentation files" on storage.objects;
create policy "presenters upload presentation files" on storage.objects for insert to authenticated with check (
  bucket_id = 'presentations' and public.uuid_from_path_segment(name, 1) is not null and public.is_presentation_presenter(public.uuid_from_path_segment(name, 1))
);
drop policy if exists "presenters remove presentation files" on storage.objects;
drop policy if exists "presenters remove presentation files" on storage.objects;
create policy "presenters remove presentation files" on storage.objects for delete to authenticated using (
  bucket_id = 'presentations' and public.uuid_from_path_segment(name, 1) is not null and public.is_presentation_presenter(public.uuid_from_path_segment(name, 1))
);
