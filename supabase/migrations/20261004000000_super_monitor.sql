-- Super Monitor: shared INTERNAL monitoring for the company's own projects (and nothing else: no customers, no external tenants).
--
-- A registered project sends error / latency / heartbeat events through the monitor-ingest edge function, authenticated by a scoped,
-- revocable key. Events are redacted, de-duplicated and counted into hourly aggregates; dashboards read the aggregates, never the raw
-- events. Repeated errors, a fatal error or a silent heartbeat open an incident that a person acknowledges, investigates and resolves.
--
-- Rules enforced here, not in the UI:
--  * Only the SHA-256 of a key is stored. A key can ingest (scopes: events, heartbeat) and nothing else, and it can be revoked or expire.
--  * Three tiers of access: Main Admin controls (projects, keys); devops / cybersecurity staff see every project; a project's owning
--    department sees its own project. Seeing or investigating an incident grants nothing else: no table here holds a secret, a
--    customer record or a production control, and everything stored from an event has been redacted first.
--  * Nobody writes these tables directly. Changes go through functions that check who may do what and leave a trail in the notes.
--  * Incident history is append-only; status changes follow a fixed lifecycle; resolving needs a root cause.
--  * A retried request cannot double-count: (project, event_id) is unique, and a notification for the same reason is sent once.

create sequence if not exists public.monitor_incident_seq;

-- ── who may do what ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.monitor_user_is_platform(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.profiles where id = p_user and role = 'superadmin')
    or exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
                where wd.user_id = p_user and wp.status = 'active'
                  and wd.department_id in (public.department_id_by_slug('devops'), public.department_id_by_slug('cybersecurity'))))
$$;
create or replace function public.monitor_is_platform() returns boolean language sql stable security definer set search_path = public as $$
  select public.monitor_user_is_platform(auth.uid())
$$;
create or replace function public.monitor_can_control() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public."current_role"() = 'superadmin'
$$;

create table if not exists public.monitor_projects (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique check (char_length(btrim(name)) between 2 and 80),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  kind                 text not null default 'web' check (kind in ('web', 'api', 'worker', 'mobile', 'other')),
  owner_department_id  uuid references public.departments (id) on delete set null,
  workspace_project_id uuid references public.projects (id) on delete set null,
  heartbeat_seconds    integer not null default 300 check (heartbeat_seconds between 30 and 86400),
  event_quota_per_minute integer not null default 600 check (event_quota_per_minute between 10 and 6000),
  error_burst_threshold  integer not null default 10 check (error_burst_threshold between 1 and 1000),
  active               boolean not null default true,
  last_event_at        timestamptz,
  last_heartbeat_at    timestamptz,
  last_sdk_name        text,
  last_sdk_version     text,
  last_release         text,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);

create or replace function public.monitor_user_can_view(p_user uuid, p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    public.monitor_user_is_platform(p_user)
    or exists (select 1 from public.monitor_projects mp join public.worker_departments wd on wd.department_id = mp.owner_department_id
                join public.worker_profiles wp on wp.user_id = wd.user_id
               where mp.id = p_project and wd.user_id = p_user and wp.status = 'active'))
$$;
create or replace function public.monitor_can_view(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.monitor_user_can_view(auth.uid(), p_project)
$$;

-- A credential for one project. Only its hash is stored; the key itself is shown once, when it is made.
create table if not exists public.monitor_keys (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.monitor_projects (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix  text not null check (char_length(key_prefix) between 4 and 12),
  scopes      text[] not null default array['events', 'heartbeat'] check (cardinality(scopes) >= 1 and scopes <@ array['events', 'heartbeat']),
  active      boolean not null default true,
  expires_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null,
  last_used_at timestamptz
);
create index if not exists monitor_keys_project on public.monitor_keys (project_id);

-- Raw events: short-lived (the sweep deletes them after 14 days). Nothing reads these in bulk; screens use the aggregates below.
create table if not exists public.monitor_events (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.monitor_projects (id) on delete cascade,
  key_id      uuid references public.monitor_keys (id) on delete set null,
  event_id    text not null check (char_length(event_id) between 1 and 100),
  kind        text not null check (kind in ('error', 'message', 'latency', 'heartbeat')),
  level       text not null check (level in ('fatal', 'error', 'warning', 'info')),
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{8,32}$'),
  message     text not null default '' check (char_length(message) <= 500),
  stack       text not null default '' check (char_length(stack) <= 4000),
  environment text not null default 'production' check (char_length(environment) between 1 and 40),
  release     text check (release is null or char_length(release) <= 80),
  sdk_name    text check (sdk_name is null or char_length(sdk_name) <= 40),
  sdk_version text check (sdk_version is null or char_length(sdk_version) <= 40),
  route       text check (route is null or char_length(route) <= 200),
  status_code integer check (status_code is null or status_code between 100 and 599),
  latency_ms  integer check (latency_ms is null or latency_ms between 0 and 600000),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (project_id, event_id)
);
create index if not exists monitor_events_recent on public.monitor_events (project_id, received_at desc);
create index if not exists monitor_events_fp on public.monitor_events (project_id, fingerprint, received_at desc) where fingerprint is not null;

-- Hourly aggregates: what the dashboards read. latency_hist counts samples in 8 bands: <=50, <=100, <=250, <=500, <=1000, <=2500, <=5000 ms, slower.
create table if not exists public.monitor_hourly (
  project_id  uuid not null references public.monitor_projects (id) on delete cascade,
  environment text not null,
  bucket      timestamptz not null,
  events      integer not null default 0,
  errors      integer not null default 0,
  fatals      integer not null default 0,
  warnings    integer not null default 0,
  heartbeats  integer not null default 0,
  latency_n   integer not null default 0,
  latency_sum bigint not null default 0,
  latency_max integer not null default 0,
  latency_hist integer[] not null default array_fill(0, array[8]) check (cardinality(latency_hist) = 8),
  primary key (project_id, environment, bucket)
);

-- One row per distinct error (by fingerprint) per project.
create table if not exists public.monitor_error_groups (
  project_id   uuid not null references public.monitor_projects (id) on delete cascade,
  fingerprint  text not null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  occurrences  bigint not null default 0,
  last_message text not null default '',
  last_level   text not null default 'error',
  last_release text,
  primary key (project_id, fingerprint)
);

-- ── incidents ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.monitor_incidents (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('INC-' || lpad(nextval('public.monitor_incident_seq')::text, 6, '0')),
  project_id       uuid not null references public.monitor_projects (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 3 and 200),
  severity         text not null default 'medium' check (severity in ('critical', 'high', 'medium', 'low')),
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'investigating', 'fix_in_progress', 'monitoring', 'resolved', 'reopened')),
  source           text not null check (source in ('auto_errors', 'auto_down', 'manual')),
  fingerprint      text,
  assignee_id      uuid references public.profiles (id) on delete set null,
  root_cause       text check (root_cause is null or char_length(root_cause) <= 4000),
  duplicate_of     uuid references public.monitor_incidents (id) on delete set null,
  opened_by        uuid references public.profiles (id) on delete set null,
  opened_at        timestamptz not null default now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  reopen_count     integer not null default 0,
  escalation_level integer not null default 0 check (escalation_level between 0 and 2),
  ack_due_at       timestamptz,
  next_escalation_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (duplicate_of is null or duplicate_of <> id)
);
create index if not exists monitor_incidents_project on public.monitor_incidents (project_id, status);
create index if not exists monitor_incidents_escalation on public.monitor_incidents (next_escalation_at) where next_escalation_at is not null;
-- Never two live incidents for the same error in the same project, nor two live "no heartbeat" incidents for one project.
create unique index if not exists monitor_incident_live_error on public.monitor_incidents (project_id, fingerprint) where fingerprint is not null and status <> 'resolved' and duplicate_of is null;
create unique index if not exists monitor_incident_live_down on public.monitor_incidents (project_id) where source = 'auto_down' and status <> 'resolved';

create table if not exists public.monitor_incident_notes (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.monitor_incidents (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('note', 'status', 'assignment', 'escalation', 'system', 'root_cause', 'link', 'severity')),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists monitor_incident_notes_incident on public.monitor_incident_notes (incident_id, created_at);

-- A notification for the same reason is recorded once, however many times the code path runs.
create table if not exists public.monitor_notified (
  incident_id uuid not null references public.monitor_incidents (id) on delete cascade,
  dedupe_key  text not null,
  sent_at     timestamptz not null default now(),
  primary key (incident_id, dedupe_key)
);

-- ── guard: only the workflow functions below write these tables ─────────────────────────────────────────────────────────────
create or replace function public.guard_monitor_tables() returns trigger language plpgsql as $$
declare v_flag text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off');
begin
  if tg_op = 'DELETE' then
    -- Raw events and hourly figures age out (the sweep sets the flag to 'retention'); incident history and notes are never deleted.
    if tg_table_name in ('monitor_events', 'monitor_hourly') and v_flag = 'retention' then return old; end if;
    raise exception 'Monitoring history cannot be deleted.' using errcode = '42501';
  end if;
  if v_flag not in ('on', 'retention') then raise exception 'Monitoring data changes only through the monitoring workflow.' using errcode = '42501'; end if;
  if tg_table_name = 'monitor_incident_notes' and tg_op = 'UPDATE' then raise exception 'Incident notes cannot be edited.' using errcode = '42501'; end if;
  if tg_table_name = 'monitor_incidents' and tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['monitor_projects', 'monitor_keys', 'monitor_events', 'monitor_hourly', 'monitor_error_groups', 'monitor_incidents', 'monitor_incident_notes', 'monitor_notified'] loop
    execute format('drop trigger if exists guard_%1$s on public.%1$s', t);
    execute format('create trigger guard_%1$s before insert or update or delete on public.%1$s for each row execute function public.guard_monitor_tables()', t);
  end loop;
end $$;

-- ── row level security: read what you may see, write nothing ───────────────────────────────────────────────────────────────
alter table public.monitor_projects enable row level security;
alter table public.monitor_keys enable row level security;
alter table public.monitor_events enable row level security;
alter table public.monitor_hourly enable row level security;
alter table public.monitor_error_groups enable row level security;
alter table public.monitor_incidents enable row level security;
alter table public.monitor_incident_notes enable row level security;
alter table public.monitor_notified enable row level security;

drop policy if exists "monitor projects visible to those who may see them" on public.monitor_projects;
create policy "monitor projects visible to those who may see them" on public.monitor_projects for select to authenticated using (public.monitor_can_view(id));
drop policy if exists "only the Main Admin sees credentials" on public.monitor_keys;
create policy "only the Main Admin sees credentials" on public.monitor_keys for select to authenticated using (public.monitor_can_control());
drop policy if exists "hourly figures follow the project" on public.monitor_hourly;
create policy "hourly figures follow the project" on public.monitor_hourly for select to authenticated using (public.monitor_can_view(project_id));
drop policy if exists "error groups follow the project" on public.monitor_error_groups;
create policy "error groups follow the project" on public.monitor_error_groups for select to authenticated using (public.monitor_can_view(project_id));
drop policy if exists "incidents follow the project" on public.monitor_incidents;
create policy "incidents follow the project" on public.monitor_incidents for select to authenticated using (public.monitor_can_view(project_id));
drop policy if exists "notes follow their incident" on public.monitor_incident_notes;
create policy "notes follow their incident" on public.monitor_incident_notes for select to authenticated using (exists (select 1 from public.monitor_incidents i where i.id = incident_id and public.monitor_can_view(i.project_id)));
-- monitor_events and monitor_notified: no policy for anyone. Raw events leave only through the bounded functions below.

revoke all on public.monitor_projects, public.monitor_keys, public.monitor_events, public.monitor_hourly, public.monitor_error_groups, public.monitor_incidents, public.monitor_incident_notes, public.monitor_notified from anon, authenticated;
grant select on public.monitor_projects, public.monitor_hourly, public.monitor_error_groups, public.monitor_incidents, public.monitor_incident_notes to authenticated;
grant select (id, project_id, label, key_prefix, scopes, active, expires_at, created_by, created_at, revoked_at, revoked_by, last_used_at) on public.monitor_keys to authenticated;   -- never key_hash

-- ── pure helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Everything stored from an event passes through this first, so an investigator is never shown a secret or a customer's details:
-- tokens, provider keys, our own keys, password-like assignments, bearer headers, e-mail addresses and card-length digit runs.
create or replace function public.monitor_redact(p text) returns text language sql immutable as $$
  -- innermost rule runs first: bearer tokens BEFORE the generic "authorization: ..." rule, which would otherwise swallow the word "Bearer" and leave the token
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
    'bearer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [redacted]', 'gi'),
    'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', '[token]', 'g'),
    '\m(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}', '[key]', 'g'),
    'ctf[sm]_[0-9a-f]{48}', '[key]', 'g'),
    '(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;&"'']+', '\1=[redacted]', 'gi'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
    '\m(?:\d[ -]?){13,19}\M', '[number]', 'g')
$$;
create or replace function public.monitor_ack_minutes(p_severity text) returns integer language sql immutable as $$
  select case p_severity when 'critical' then 5 when 'high' then 15 when 'medium' then 60 else 240 end
$$;
create or replace function public.monitor_sev_rank(p_severity text) returns integer language sql immutable as $$
  select case p_severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end
$$;
create or replace function public.monitor_latency_bin(p_ms integer) returns integer language sql immutable as $$
  select case when p_ms <= 50 then 1 when p_ms <= 100 then 2 when p_ms <= 250 then 3 when p_ms <= 500 then 4 when p_ms <= 1000 then 5 when p_ms <= 2500 then 6 when p_ms <= 5000 then 7 else 8 end
$$;
-- The slowest 5% start above this many ms (upper edge of the band holding the 95th percentile; 10000 means "slower than 5 s").
create or replace function public.monitor_hist_p95(p_hist integer[]) returns integer language plpgsql immutable as $$
declare v_total bigint := 0; v_run bigint := 0; v_edges integer[] := array[50, 100, 250, 500, 1000, 2500, 5000, 10000]; i int;
begin
  if p_hist is null then return null; end if;
  for i in 1..8 loop v_total := v_total + coalesce(p_hist[i], 0); end loop;
  if v_total = 0 then return null; end if;
  for i in 1..8 loop v_run := v_run + coalesce(p_hist[i], 0); if v_run * 100 >= v_total * 95 then return v_edges[i]; end if; end loop;
  return 10000;
end $$;
create or replace function public.monitor_hist_sum(p_project uuid, p_since timestamptz) returns integer[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(c order by i) from (select i, coalesce(sum(h.latency_hist[i]), 0)::int as c
    from generate_series(1, 8) i left join public.monitor_hourly h on h.project_id = p_project and h.bucket >= p_since group by i) q), array_fill(0, array[8]))
$$;

-- live health of one project, computed when asked (nothing stored, so it cannot drift)
create or replace function public.monitor_health_of(p_project uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when not mp.active then 'paused'
    when mp.last_heartbeat_at is not null and mp.last_heartbeat_at < now() - make_interval(secs => mp.heartbeat_seconds * 3) then 'down'
    when exists (select 1 from public.monitor_incidents i where i.project_id = mp.id and i.status <> 'resolved' and i.duplicate_of is null and i.severity <> 'low') then 'degraded'
    when mp.last_heartbeat_at is null and mp.last_event_at is null then 'unknown'
    else 'healthy' end
  from public.monitor_projects mp where mp.id = p_project
$$;

-- ── internal workflow helpers (nobody outside the database can call these) ─────────────────────────────────────────────────
create or replace function public.monitor_note(p_incident uuid, p_kind text, p_body text, p_author uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off');
begin
  perform set_config('ctf.monitor_rpc', 'on', true);
  insert into public.monitor_incident_notes (incident_id, author_id, kind, body) values (p_incident, p_author, p_kind, left(btrim(p_body), 4000));
  perform set_config('ctf.monitor_rpc', v_prev, true);   -- restore, never force off: the caller may still have writes to make
end $$;

-- Who is told about a project's incident. Level 0: the owning department's admins and DevOps admins. Level 1 adds Cybersecurity admins.
-- Level 2 adds every Main Admin. If nobody at all qualifies, the Main Admins are told so an incident is never silent.
create or replace function public.monitor_responders(p_project uuid, p_level integer) returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into v from (
    select wd.user_id as u from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
     where wp.status = 'active' and wd.department_role = 'admin' and (
           wd.department_id = (select owner_department_id from public.monitor_projects where id = p_project)
        or wd.department_id = public.department_id_by_slug('devops')
        or (p_level >= 1 and wd.department_id = public.department_id_by_slug('cybersecurity')))
    union select id from public.profiles where role = 'superadmin' and p_level >= 2) q where u is not null;
  if cardinality(v) = 0 then select coalesce(array_agg(id), '{}') into v from public.profiles where role = 'superadmin'; end if;
  return v;
end $$;

create or replace function public.monitor_notify(p_incident uuid, p_key text, p_users uuid[], p_title text, p_body text) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); v_n integer;
begin
  if p_users is null or cardinality(p_users) = 0 then return; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  insert into public.monitor_notified (incident_id, dedupe_key) values (p_incident, p_key) on conflict do nothing;
  get diagnostics v_n = row_count;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  if v_n = 0 then return; end if;   -- this reason was already announced
  insert into public.notifications (user_id, title, body, kind)
  select distinct u, p_title, left(p_body, 300), 'monitor' from unnest(p_users) as u where u is not null and u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
end $$;

create or replace function public.monitor_create_incident(p_project uuid, p_title text, p_severity text, p_source text, p_fingerprint text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); v_id uuid; v_ref text; v_name text; v_due timestamptz := now() + make_interval(mins => public.monitor_ack_minutes(p_severity));
begin
  perform set_config('ctf.monitor_rpc', 'on', true);
  begin
    insert into public.monitor_incidents (project_id, title, severity, source, fingerprint, opened_by, ack_due_at, next_escalation_at)
    values (p_project, left(btrim(p_title), 200), p_severity, p_source, p_fingerprint, p_actor, v_due, v_due) returning id, ref into v_id, v_ref;
  exception when unique_violation then   -- someone else opened the same live incident a moment ago: use theirs
    perform set_config('ctf.monitor_rpc', v_prev, true);
    select id into v_id from public.monitor_incidents where project_id = p_project and status <> 'resolved' and duplicate_of is null
       and ((p_fingerprint is not null and fingerprint = p_fingerprint) or (p_fingerprint is null and p_source = 'auto_down' and source = 'auto_down')) order by opened_at desc limit 1;
    return v_id;
  end;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  perform public.monitor_note(v_id, 'system', case p_source when 'manual' then 'Opened by hand.' when 'auto_down' then 'Opened automatically: the project stopped sending heartbeats.' else 'Opened automatically: the same error kept repeating.' end, p_actor);
  select name into v_name from public.monitor_projects where id = p_project;
  perform public.monitor_notify(v_id, 'opened', public.monitor_responders(p_project, 0),
    initcap(p_severity) || ' incident ' || v_ref, v_name || ': ' || left(btrim(p_title), 160));
  return v_id;
end $$;

-- A repeating error (or any fatal one) opens an incident; if its incident was resolved within a week, that incident is REOPENED instead.
create or replace function public.monitor_raise_error_incident(p_project uuid, p_fingerprint text, p_count integer, p_fatal boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); mp public.monitor_projects; i public.monitor_incidents; g public.monitor_error_groups; v_sev text; v_due timestamptz;
begin
  select * into mp from public.monitor_projects where id = p_project;
  select * into g from public.monitor_error_groups where project_id = p_project and fingerprint = p_fingerprint;
  v_sev := case when p_fatal then 'critical' when p_count >= mp.error_burst_threshold * 5 then 'high' else 'medium' end;
  select * into i from public.monitor_incidents where project_id = p_project and fingerprint = p_fingerprint and duplicate_of is null order by opened_at desc limit 1;
  if found and i.status <> 'resolved' then
    if public.monitor_sev_rank(v_sev) > public.monitor_sev_rank(i.severity) then   -- it got worse: say so, once per level
      perform set_config('ctf.monitor_rpc', 'on', true);
      update public.monitor_incidents set severity = v_sev where id = i.id;
      perform set_config('ctf.monitor_rpc', v_prev, true);
      perform public.monitor_note(i.id, 'severity', 'Severity raised from ' || i.severity || ' to ' || v_sev || ' automatically (' || p_count || ' occurrences in 10 minutes).', null);
      perform public.monitor_notify(i.id, 'worse:' || v_sev || ':' || i.reopen_count, public.monitor_responders(p_project, 0), 'Incident ' || i.ref || ' is now ' || v_sev, left(i.title, 200));
    end if;
  elsif found and i.resolved_at is not null and i.resolved_at > now() - interval '7 days' then
    v_due := now() + make_interval(mins => public.monitor_ack_minutes(v_sev));
    perform set_config('ctf.monitor_rpc', 'on', true);
    update public.monitor_incidents set status = 'reopened', reopen_count = reopen_count + 1, resolved_at = null, severity = v_sev, escalation_level = 0, ack_due_at = v_due, next_escalation_at = v_due where id = i.id;
    perform set_config('ctf.monitor_rpc', v_prev, true);
    perform public.monitor_note(i.id, 'status', 'Reopened automatically: the same error is back (' || p_count || ' in 10 minutes).', null);
    perform public.monitor_notify(i.id, 'reopened:' || (i.reopen_count + 1), public.monitor_responders(p_project, 0), 'Incident ' || i.ref || ' reopened', left(i.title, 200));
  else
    perform public.monitor_create_incident(p_project, 'Errors in ' || mp.name || ': ' || left(coalesce(nullif(g.last_message, ''), 'unknown error'), 120), v_sev, 'auto_errors', p_fingerprint, null);
  end if;
end $$;

-- A heartbeat after silence: the "no heartbeat" incident moves to Monitoring (a person still decides when it is resolved).
create or replace function public.monitor_recover(p_project uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents;
begin
  for i in select * from public.monitor_incidents where project_id = p_project and source = 'auto_down' and status in ('open', 'acknowledged', 'investigating', 'fix_in_progress', 'reopened') loop
    perform set_config('ctf.monitor_rpc', 'on', true);
    update public.monitor_incidents set status = 'monitoring', acknowledged_at = coalesce(acknowledged_at, now()), next_escalation_at = null where id = i.id;
    perform set_config('ctf.monitor_rpc', v_prev, true);
    perform public.monitor_note(i.id, 'system', 'Heartbeats resumed. Moved to Monitoring: someone should confirm and resolve it.', null);
    perform public.monitor_notify(i.id, 'recovered:' || i.reopen_count, array_remove(array[i.assignee_id], null) || public.monitor_responders(p_project, 0), 'Incident ' || i.ref || ': heartbeats are back', left(i.title, 200));
  end loop;
end $$;

-- ── Main Admin controls: projects and keys ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.monitor_register_project(p_name text, p_slug text, p_kind text, p_owner_department_slug text, p_workspace_project uuid default null,
  p_heartbeat_seconds integer default 300, p_error_burst_threshold integer default 10, p_event_quota_per_minute integer default 600) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); v_id uuid; v_dept uuid;
begin
  if not public.monitor_can_control() then raise exception 'Only a Main Admin can register a project.' using errcode = '42501'; end if;
  if nullif(btrim(p_owner_department_slug), '') is not null then
    v_dept := public.department_id_by_slug(p_owner_department_slug);
    if v_dept is null then raise exception 'Unknown department.' using errcode = '23503'; end if;
  end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  insert into public.monitor_projects (name, slug, kind, owner_department_id, workspace_project_id, heartbeat_seconds, error_burst_threshold, event_quota_per_minute, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), coalesce(p_kind, 'web'), v_dept, p_workspace_project, p_heartbeat_seconds, p_error_burst_threshold, p_event_quota_per_minute, auth.uid()) returning id into v_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), 'monitor.project.register', 'monitor_project', v_id, 'info', jsonb_build_object('name', btrim(p_name)));
  return v_id;
end $$;

create or replace function public.monitor_update_project(p_id uuid, p_owner_department_slug text, p_heartbeat_seconds integer, p_error_burst_threshold integer, p_event_quota_per_minute integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); v_dept uuid;
begin
  if not public.monitor_can_control() then raise exception 'Only a Main Admin can change a project.' using errcode = '42501'; end if;
  if nullif(btrim(p_owner_department_slug), '') is not null then
    v_dept := public.department_id_by_slug(p_owner_department_slug);
    if v_dept is null then raise exception 'Unknown department.' using errcode = '23503'; end if;
  end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_projects set owner_department_id = v_dept, heartbeat_seconds = p_heartbeat_seconds, error_burst_threshold = p_error_burst_threshold, event_quota_per_minute = p_event_quota_per_minute where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  if not found then raise exception 'Project not found.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.monitor_set_project_active(p_id uuid, p_active boolean) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off');
begin
  if not public.monitor_can_control() then raise exception 'Only a Main Admin can pause or resume a project.' using errcode = '42501'; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_projects set active = p_active where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), case when p_active then 'monitor.project.resume' else 'monitor.project.pause' end, 'monitor_project', p_id, 'info', '{}');
end $$;

create or replace function public.monitor_create_key(p_project uuid, p_label text, p_key_hash text, p_key_prefix text, p_scopes text[] default array['events', 'heartbeat'], p_expires_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); v_id uuid;
begin
  if not public.monitor_can_control() then raise exception 'Only a Main Admin can create a key.' using errcode = '42501'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'The expiry must be in the future.' using errcode = '22023'; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  insert into public.monitor_keys (project_id, label, key_hash, key_prefix, scopes, expires_at, created_by) values (p_project, btrim(p_label), p_key_hash, p_key_prefix, p_scopes, p_expires_at, auth.uid()) returning id into v_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), 'monitor.key.create', 'monitor_key', v_id, 'info', jsonb_build_object('project_id', p_project, 'scopes', p_scopes));
  return v_id;
end $$;

create or replace function public.monitor_revoke_key(p_key uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off');
begin
  if not public.monitor_can_control() then raise exception 'Only a Main Admin can revoke a key.' using errcode = '42501'; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_keys set active = false, revoked_at = now(), revoked_by = auth.uid() where id = p_key and revoked_at is null;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), 'monitor.key.revoke', 'monitor_key', p_key, 'warning', '{}');
end $$;

-- ── incidents: what people do ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.monitor_open_incident(p_project uuid, p_title text, p_severity text default 'medium', p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.monitor_can_view(p_project) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  if p_severity not in ('critical', 'high', 'medium', 'low') then raise exception 'Severity must be critical, high, medium or low.' using errcode = '22023'; end if;
  v_id := public.monitor_create_incident(p_project, p_title, p_severity, 'manual', null, auth.uid());
  if nullif(btrim(p_note), '') is not null then perform public.monitor_note(v_id, 'note', p_note, auth.uid()); end if;
  return v_id;
end $$;

create or replace function public.monitor_set_incident_status(p_id uuid, p_status text, p_root_cause text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents; v_ok boolean; v_cause text; v_due timestamptz;
begin
  select * into i from public.monitor_incidents where id = p_id for update;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  v_ok := case i.status
    when 'open' then p_status in ('acknowledged', 'investigating', 'resolved')
    when 'acknowledged' then p_status in ('investigating', 'fix_in_progress', 'resolved')
    when 'investigating' then p_status in ('fix_in_progress', 'monitoring', 'resolved')
    when 'fix_in_progress' then p_status in ('investigating', 'monitoring', 'resolved')
    when 'monitoring' then p_status in ('investigating', 'resolved', 'reopened')
    when 'resolved' then p_status = 'reopened'
    when 'reopened' then p_status in ('acknowledged', 'investigating', 'fix_in_progress', 'resolved') end;
  if not coalesce(v_ok, false) then raise exception 'An incident that is % cannot move to %.', replace(i.status, '_', ' '), replace(p_status, '_', ' ') using errcode = '23514'; end if;
  if p_status = 'resolved' then
    v_cause := coalesce(nullif(btrim(p_root_cause), ''), i.root_cause);
    if v_cause is null or char_length(btrim(v_cause)) < 10 then raise exception 'Say what caused it (at least 10 characters) before resolving.' using errcode = '23514'; end if;
  end if;
  v_due := now() + make_interval(mins => public.monitor_ack_minutes(i.severity));
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_incidents set
    status = p_status,
    root_cause = case when p_status = 'resolved' then v_cause else root_cause end,
    resolved_at = case when p_status = 'resolved' then now() when p_status = 'reopened' then null else resolved_at end,
    reopen_count = reopen_count + case when p_status = 'reopened' then 1 else 0 end,
    acknowledged_at = case when p_status in ('acknowledged', 'investigating', 'fix_in_progress', 'monitoring', 'resolved') then coalesce(acknowledged_at, now()) else acknowledged_at end,
    assignee_id = case when p_status in ('acknowledged', 'investigating', 'fix_in_progress') then coalesce(assignee_id, auth.uid()) else assignee_id end,
    escalation_level = case when p_status = 'reopened' then 0 else escalation_level end,
    ack_due_at = case when p_status = 'reopened' then v_due else ack_due_at end,
    next_escalation_at = case when p_status = 'reopened' then v_due else null end
  where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  perform public.monitor_note(p_id, 'status', 'Status changed from ' || replace(i.status, '_', ' ') || ' to ' || replace(p_status, '_', ' ') || '.', auth.uid());
  if p_status = 'resolved' and v_cause is distinct from i.root_cause then perform public.monitor_note(p_id, 'root_cause', v_cause, auth.uid()); end if;
  if p_status = 'resolved' then
    perform public.monitor_notify(p_id, 'resolved:' || i.reopen_count, array_remove(array[i.assignee_id, i.opened_by], null), 'Incident ' || i.ref || ' resolved', left(i.title, 200));
  elsif p_status = 'reopened' then
    perform public.monitor_notify(p_id, 'reopened:' || (i.reopen_count + 1), public.monitor_responders(i.project_id, 0), 'Incident ' || i.ref || ' reopened', left(i.title, 200));
  end if;
end $$;

create or replace function public.monitor_assign_incident(p_id uuid, p_assignee uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents; v_name text;
begin
  select * into i from public.monitor_incidents where id = p_id for update;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if i.status = 'resolved' then raise exception 'A resolved incident cannot be reassigned. Reopen it first.' using errcode = '23514'; end if;
  if p_assignee is not null and not public.monitor_user_can_view(p_assignee, i.project_id) then
    raise exception 'That person cannot see this project, so they cannot be given its incidents.' using errcode = '42501';
  end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_incidents set assignee_id = p_assignee where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  select coalesce(nullif(btrim(display_name), ''), 'a colleague') into v_name from public.profiles where id = p_assignee;
  perform public.monitor_note(p_id, 'assignment', case when p_assignee is null then 'Unassigned.' else 'Assigned to ' || v_name || '.' end, auth.uid());
  if p_assignee is not null then perform public.monitor_notify(p_id, 'assigned:' || p_assignee || ':' || extract(epoch from now())::bigint, array[p_assignee], 'Incident ' || i.ref || ' assigned to you', left(i.title, 200)); end if;
end $$;

create or replace function public.monitor_set_root_cause(p_id uuid, p_text text) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents;
begin
  select * into i from public.monitor_incidents where id = p_id for update;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_text, ''))) < 10 then raise exception 'Describe the root cause in at least 10 characters.' using errcode = '23514'; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_incidents set root_cause = left(btrim(p_text), 4000) where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  perform public.monitor_note(p_id, 'root_cause', p_text, auth.uid());
end $$;

create or replace function public.monitor_add_note(p_id uuid, p_body text) returns void language plpgsql security definer set search_path = public as $$
declare i public.monitor_incidents;
begin
  select * into i from public.monitor_incidents where id = p_id;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write something first.' using errcode = '23514'; end if;
  perform public.monitor_note(p_id, 'note', p_body, auth.uid());
end $$;

create or replace function public.monitor_set_severity(p_id uuid, p_severity text) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents; v_due timestamptz;
begin
  select * into i from public.monitor_incidents where id = p_id for update;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if p_severity not in ('critical', 'high', 'medium', 'low') then raise exception 'Severity must be critical, high, medium or low.' using errcode = '22023'; end if;
  if i.status = 'resolved' then raise exception 'A resolved incident cannot change severity. Reopen it first.' using errcode = '23514'; end if;
  v_due := now() + make_interval(mins => public.monitor_ack_minutes(p_severity));
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_incidents set severity = p_severity,
    ack_due_at = case when status in ('open', 'reopened') then v_due else ack_due_at end,
    next_escalation_at = case when status in ('open', 'reopened') and escalation_level < 2 then v_due else next_escalation_at end where id = p_id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  perform public.monitor_note(p_id, 'severity', 'Severity changed from ' || i.severity || ' to ' || p_severity || '.', auth.uid());
end $$;

create or replace function public.monitor_mark_duplicate(p_id uuid, p_of uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); i public.monitor_incidents; t public.monitor_incidents;
begin
  select * into i from public.monitor_incidents where id = p_id for update;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  select * into t from public.monitor_incidents where id = p_of;
  if not found or not public.monitor_can_view(t.project_id) then raise exception 'The incident to link to was not found.' using errcode = 'P0002'; end if;
  if i.id = t.id then raise exception 'An incident cannot be a duplicate of itself.' using errcode = '23514'; end if;
  if i.project_id <> t.project_id then raise exception 'Duplicates must belong to the same project.' using errcode = '23514'; end if;
  if t.duplicate_of is not null then raise exception 'That incident is itself a duplicate. Link to the original.' using errcode = '23514'; end if;
  perform set_config('ctf.monitor_rpc', 'on', true);
  update public.monitor_incidents set duplicate_of = t.id where duplicate_of = i.id;   -- anything that pointed at this one now points at the original
  update public.monitor_incidents set duplicate_of = t.id, status = 'resolved', resolved_at = now(), acknowledged_at = coalesce(acknowledged_at, now()), root_cause = 'Duplicate of ' || t.ref, next_escalation_at = null where id = i.id;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  perform public.monitor_note(i.id, 'link', 'Closed as a duplicate of ' || t.ref || '.', auth.uid());
  perform public.monitor_note(t.id, 'link', i.ref || ' was closed as a duplicate of this incident.', auth.uid());
end $$;

-- ── ingestion: called ONLY by the monitor-ingest edge function, with the service role ──────────────────────────────────────
create or replace function public.monitor_ingest(p_key_hash text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k public.monitor_keys; p public.monitor_projects; e jsonb;
  v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off');
  v_kind text; v_level text; v_msg text; v_stack text; v_fp text; v_env text; v_occ timestamptz; v_route text; v_eid text; v_rel text; v_sdkn text; v_sdkv text; v_code int; v_lat int;
  v_hist int[]; v_n int; v_recent int; v_incoming int;
  n_acc int := 0; n_dup int := 0; n_bad int := 0; n_scope int := 0; v_hb boolean := false;
  fps text[] := '{}'; fp text; v_cnt int; v_fatal boolean; l_sdkn text; l_sdkv text; l_rel text;
begin
  select * into k from public.monitor_keys where key_hash = p_key_hash and active and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then raise exception 'Unknown, revoked or expired key.' using errcode = '28000'; end if;
  select * into p from public.monitor_projects where id = k.project_id and active;
  if not found then raise exception 'Unknown, revoked or expired key.' using errcode = '28000'; end if;   -- same message: a caller learns nothing about which part failed
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array.' using errcode = '23514'; end if;
  v_incoming := jsonb_array_length(p_events);
  if v_incoming = 0 then return jsonb_build_object('accepted', 0, 'duplicates', 0, 'rejected', 0, 'out_of_scope', 0); end if;
  if v_incoming > 50 then raise exception 'At most 50 events per request.' using errcode = '23514'; end if;
  select count(*) into v_recent from public.monitor_events where project_id = p.id and received_at > now() - interval '1 minute';
  if v_recent + v_incoming > p.event_quota_per_minute then raise exception 'Event quota exceeded for this project.' using errcode = '54000'; end if;

  perform set_config('ctf.monitor_rpc', 'on', true);
  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e) <> 'object' then n_bad := n_bad + 1; continue; end if;
    v_kind := lower(coalesce(e ->> 'kind', ''));
    if v_kind not in ('error', 'message', 'latency', 'heartbeat') then n_bad := n_bad + 1; continue; end if;
    v_eid := left(btrim(coalesce(e ->> 'event_id', '')), 100);
    if v_eid = '' then n_bad := n_bad + 1; continue; end if;
    if (v_kind = 'heartbeat' and not ('heartbeat' = any (k.scopes))) or (v_kind <> 'heartbeat' and not ('events' = any (k.scopes))) then n_scope := n_scope + 1; continue; end if;

    v_level := lower(coalesce(e ->> 'level', ''));
    if v_level not in ('fatal', 'error', 'warning', 'info') then v_level := case v_kind when 'error' then 'error' else 'info' end; end if;
    v_msg := left(public.monitor_redact(coalesce(e ->> 'message', '')), 500);
    v_stack := left(public.monitor_redact(coalesce(e ->> 'stack', '')), 4000);
    v_route := left(public.monitor_redact(split_part(coalesce(e ->> 'route', ''), '?', 1)), 200);   -- query strings often carry ids and tokens: dropped
    v_env := lower(left(coalesce(nullif(btrim(e ->> 'environment'), ''), 'production'), 40));
    v_rel := nullif(left(btrim(coalesce(e ->> 'release', '')), 80), '');
    v_sdkn := nullif(left(btrim(coalesce(e ->> 'sdk_name', '')), 40), '');
    v_sdkv := nullif(left(btrim(coalesce(e ->> 'sdk_version', '')), 40), '');
    v_lat := case when (e ->> 'latency_ms') ~ '^[0-9]{1,7}(\.[0-9]+)?$' then least(round((e ->> 'latency_ms')::numeric), 600000)::int end;
    v_code := case when (e ->> 'status_code') ~ '^[0-9]{3}$' and (e ->> 'status_code')::int between 100 and 599 then (e ->> 'status_code')::int end;
    begin v_occ := (e ->> 'occurred_at')::timestamptz; exception when others then v_occ := null; end;
    v_occ := least(greatest(coalesce(v_occ, now()), now() - interval '24 hours'), now());

    v_fp := null;
    if v_kind = 'error' then
      v_fp := lower(regexp_replace(coalesce(e ->> 'fingerprint', ''), '[^0-9a-fA-F]', '', 'g'));
      if char_length(v_fp) < 8 then v_fp := substr(md5(regexp_replace(lower(v_msg), '[0-9]+', '#', 'g') || '|' || split_part(v_stack, E'\n', 2)), 1, 16); end if;
      v_fp := left(v_fp, 32);
    end if;

    insert into public.monitor_events (project_id, key_id, event_id, kind, level, fingerprint, message, stack, environment, release, sdk_name, sdk_version, route, status_code, latency_ms, occurred_at)
    values (p.id, k.id, v_eid, v_kind, v_level, v_fp, v_msg, v_stack, v_env, v_rel, v_sdkn, v_sdkv, nullif(v_route, ''), v_code, v_lat, v_occ)
    on conflict (project_id, event_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then n_dup := n_dup + 1; continue; end if;
    n_acc := n_acc + 1;

    v_hist := array_fill(0, array[8]);
    if v_lat is not null and v_kind in ('latency', 'heartbeat') then v_hist[public.monitor_latency_bin(v_lat)] := 1; end if;
    insert into public.monitor_hourly as h (project_id, environment, bucket, events, errors, fatals, warnings, heartbeats, latency_n, latency_sum, latency_max, latency_hist)
    values (p.id, v_env, date_trunc('hour', v_occ), 1, (v_level = 'error')::int, (v_level = 'fatal')::int, (v_level = 'warning')::int, (v_kind = 'heartbeat')::int,
            case when v_lat is not null and v_kind in ('latency', 'heartbeat') then 1 else 0 end, case when v_kind in ('latency', 'heartbeat') then coalesce(v_lat, 0) else 0 end,
            case when v_kind in ('latency', 'heartbeat') then coalesce(v_lat, 0) else 0 end, v_hist)
    on conflict (project_id, environment, bucket) do update set
      events = h.events + excluded.events, errors = h.errors + excluded.errors, fatals = h.fatals + excluded.fatals, warnings = h.warnings + excluded.warnings,
      heartbeats = h.heartbeats + excluded.heartbeats, latency_n = h.latency_n + excluded.latency_n, latency_sum = h.latency_sum + excluded.latency_sum,
      latency_max = greatest(h.latency_max, excluded.latency_max),
      latency_hist = (select array_agg(a + b order by o) from unnest(h.latency_hist, excluded.latency_hist) with ordinality as t(a, b, o));

    if v_kind = 'error' then
      insert into public.monitor_error_groups as g (project_id, fingerprint, first_seen, last_seen, occurrences, last_message, last_level, last_release)
      values (p.id, v_fp, v_occ, v_occ, 1, v_msg, v_level, v_rel)
      on conflict (project_id, fingerprint) do update set last_seen = greatest(g.last_seen, excluded.last_seen), occurrences = g.occurrences + 1,
        last_message = excluded.last_message, last_level = excluded.last_level, last_release = coalesce(excluded.last_release, g.last_release);
      if not (v_fp = any (fps)) then fps := fps || v_fp; end if;
    end if;
    if v_kind = 'heartbeat' then v_hb := true; end if;
    l_sdkn := coalesce(v_sdkn, l_sdkn); l_sdkv := coalesce(v_sdkv, l_sdkv); l_rel := coalesce(v_rel, l_rel);
  end loop;

  if n_acc > 0 then
    update public.monitor_projects set last_event_at = now(), last_heartbeat_at = case when v_hb then now() else last_heartbeat_at end,
      last_sdk_name = coalesce(l_sdkn, last_sdk_name), last_sdk_version = coalesce(l_sdkv, last_sdk_version), last_release = coalesce(l_rel, last_release) where id = p.id;
  end if;
  update public.monitor_keys set last_used_at = now() where id = k.id;
  if v_hb then perform public.monitor_recover(p.id); end if;

  foreach fp in array fps loop   -- repeated errors (or any fatal one) become an incident
    select count(*), bool_or(level = 'fatal') into v_cnt, v_fatal from public.monitor_events where project_id = p.id and fingerprint = fp and kind = 'error' and received_at > now() - interval '10 minutes';
    if v_cnt >= p.error_burst_threshold or coalesce(v_fatal, false) then perform public.monitor_raise_error_incident(p.id, fp, v_cnt, coalesce(v_fatal, false)); end if;
  end loop;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  return jsonb_build_object('accepted', n_acc, 'duplicates', n_dup, 'rejected', n_bad, 'out_of_scope', n_scope);
end $$;

-- ── the sweep: silence detection, escalation, retention. Scheduler (service role) or the Main Admin ("Run checks now") ────────
create or replace function public.monitor_sweep() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(nullif(current_setting('ctf.monitor_rpc', true), ''), 'off'); p public.monitor_projects; i public.monitor_incidents; v_lvl int; v_due timestamptz;
  n_down int := 0; n_esc int := 0; n_ev bigint := 0; n_h bigint := 0;
begin
  if auth.uid() is not null and public."current_role"() <> 'superadmin' then raise exception 'Only the Main Admin or the scheduler can run checks.' using errcode = '42501'; end if;

  for p in select * from public.monitor_projects where active and last_heartbeat_at is not null and last_heartbeat_at < now() - make_interval(secs => heartbeat_seconds * 3) loop
    if not exists (select 1 from public.monitor_incidents where project_id = p.id and source = 'auto_down' and status <> 'resolved') then
      perform public.monitor_create_incident(p.id, 'No heartbeat from ' || p.name || ' for ' || (extract(epoch from now() - p.last_heartbeat_at) / 60)::int || ' minutes', 'critical', 'auto_down', null, null);
      n_down := n_down + 1;
    end if;
  end loop;

  for i in select * from public.monitor_incidents where status in ('open', 'reopened') and duplicate_of is null and next_escalation_at is not null and next_escalation_at <= now() and escalation_level < 2 loop
    v_lvl := i.escalation_level + 1;
    v_due := now() + make_interval(mins => public.monitor_ack_minutes(i.severity));
    perform set_config('ctf.monitor_rpc', 'on', true);
    update public.monitor_incidents set escalation_level = v_lvl, next_escalation_at = case when v_lvl >= 2 then null else v_due end where id = i.id;
    perform set_config('ctf.monitor_rpc', v_prev, true);
    perform public.monitor_note(i.id, 'escalation', 'Not acknowledged in time. Escalated to level ' || v_lvl || case when v_lvl = 2 then ' (Main Admins told).' else '.' end, null);
    -- escalation widens the audience: only the people newly added at this level are told (those from lower levels already know)
    perform public.monitor_notify(i.id, 'esc:' || i.reopen_count || ':' || v_lvl,
      array(select unnest(public.monitor_responders(i.project_id, v_lvl)) except select unnest(public.monitor_responders(i.project_id, v_lvl - 1))),
      'Unacknowledged: incident ' || i.ref, left(i.title, 200));
    n_esc := n_esc + 1;
  end loop;

  perform set_config('ctf.monitor_rpc', 'retention', true);
  delete from public.monitor_events where id in (select id from public.monitor_events where received_at < now() - interval '14 days' limit 50000);
  get diagnostics n_ev = row_count;
  delete from public.monitor_hourly where bucket < now() - interval '400 days';
  get diagnostics n_h = row_count;
  perform set_config('ctf.monitor_rpc', v_prev, true);
  return jsonb_build_object('silent_projects_opened', n_down, 'escalated', n_esc, 'events_deleted', n_ev, 'hourly_deleted', n_h);
end $$;

-- ── reading: aggregates and bounded lists, never raw events in bulk ────────────────────────────────────────────────────────
create or replace function public.monitor_overview() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.row order by x.name), '[]'::jsonb) from (
    select mp.name, jsonb_build_object(
      'id', mp.id, 'name', mp.name, 'slug', mp.slug, 'kind', mp.kind, 'active', mp.active,
      'owner_department', (select d.name from public.departments d where d.id = mp.owner_department_id),
      'health', public.monitor_health_of(mp.id), 'heartbeat_seconds', mp.heartbeat_seconds,
      'last_heartbeat_at', mp.last_heartbeat_at, 'last_event_at', mp.last_event_at,
      'sdk_name', mp.last_sdk_name, 'sdk_version', mp.last_sdk_version, 'release', mp.last_release,
      'open_incidents', (select count(*) from public.monitor_incidents i where i.project_id = mp.id and i.status <> 'resolved' and i.duplicate_of is null),
      'worst_severity', (select i.severity from public.monitor_incidents i where i.project_id = mp.id and i.status <> 'resolved' and i.duplicate_of is null order by public.monitor_sev_rank(i.severity) desc limit 1),
      'events_24h', coalesce((select sum(h.events) from public.monitor_hourly h where h.project_id = mp.id and h.bucket >= date_trunc('hour', now()) - interval '23 hours'), 0),
      'errors_24h', coalesce((select sum(h.errors + h.fatals) from public.monitor_hourly h where h.project_id = mp.id and h.bucket >= date_trunc('hour', now()) - interval '23 hours'), 0),
      'p95_ms_24h', public.monitor_hist_p95(public.monitor_hist_sum(mp.id, date_trunc('hour', now()) - interval '23 hours'))
    ) as row from public.monitor_projects mp where public.monitor_can_view(mp.id)) x
$$;

create or replace function public.monitor_series(p_project uuid, p_hours integer default 24) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz; v jsonb;
begin
  if not public.monitor_can_view(p_project) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  v_since := date_trunc('hour', now()) - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)) - 1);
  with b as (select bucket, sum(events)::int ev, sum(errors)::int er, sum(fatals)::int fa, sum(heartbeats)::int hb, sum(latency_n)::int n, sum(latency_sum) s, max(latency_max) mx
               from public.monitor_hourly where project_id = p_project and bucket >= v_since group by bucket),
       h as (select bucket, array_agg(c order by i) hist from (select hh.bucket, i, coalesce(sum(hh.latency_hist[i]), 0)::int c
               from public.monitor_hourly hh cross join generate_series(1, 8) i where hh.project_id = p_project and hh.bucket >= v_since group by hh.bucket, i) q group by bucket)
  select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'events', b.ev, 'errors', b.er, 'fatals', b.fa, 'heartbeats', b.hb,
           'avg_ms', case when b.n > 0 then round(b.s::numeric / b.n) end, 'p95_ms', case when b.n > 0 then public.monitor_hist_p95(h.hist) end, 'max_ms', case when b.n > 0 then b.mx end) order by b.bucket), '[]'::jsonb)
    into v from b left join h on h.bucket = b.bucket;
  return v;
end $$;

create or replace function public.monitor_top_errors(p_project uuid, p_limit integer default 10) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.monitor_can_view(p_project) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(x.row order by x.last_seen desc), '[]'::jsonb) into v from (
    select g.last_seen, jsonb_build_object('fingerprint', g.fingerprint, 'message', g.last_message, 'level', g.last_level, 'occurrences', g.occurrences,
      'first_seen', g.first_seen, 'last_seen', g.last_seen, 'release', g.last_release,
      'incident_ref', (select i.ref from public.monitor_incidents i where i.project_id = g.project_id and i.fingerprint = g.fingerprint and i.duplicate_of is null order by i.opened_at desc limit 1)) as row
    from public.monitor_error_groups g where g.project_id = p_project order by g.last_seen desc limit greatest(1, least(coalesce(p_limit, 10), 50))) x;
  return v;
end $$;

-- The few most recent occurrences of one error. Already redacted at ingestion; at most 20; no key, header or request body is ever stored.
create or replace function public.monitor_recent_occurrences(p_project uuid, p_fingerprint text, p_limit integer default 10) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.monitor_can_view(p_project) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('occurred_at', occurred_at, 'level', level, 'message', message, 'stack', stack, 'route', route, 'release', release, 'environment', environment, 'sdk_version', sdk_version) order by occurred_at desc), '[]'::jsonb) into v
  from (select * from public.monitor_events where project_id = p_project and fingerprint = p_fingerprint and kind = 'error' order by occurred_at desc limit greatest(1, least(coalesce(p_limit, 10), 20))) q;
  return v;
end $$;

create or replace function public.monitor_incidents_list(p_scope text default 'live', p_project uuid default null, p_limit integer default 100) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.row order by x.sort desc, x.opened_at desc), '[]'::jsonb) from (
    select i.opened_at, public.monitor_sev_rank(i.severity) as sort, jsonb_build_object(
      'id', i.id, 'ref', i.ref, 'title', i.title, 'severity', i.severity, 'status', i.status, 'source', i.source,
      'project_id', i.project_id, 'project_name', mp.name, 'assignee_id', i.assignee_id,
      'assignee_name', (select nullif(btrim(pr.display_name), '') from public.profiles pr where pr.id = i.assignee_id),
      'opened_at', i.opened_at, 'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at, 'ack_due_at', i.ack_due_at,
      'escalation_level', i.escalation_level, 'reopen_count', i.reopen_count,
      'duplicate_of_ref', (select d.ref from public.monitor_incidents d where d.id = i.duplicate_of)) as row
    from public.monitor_incidents i join public.monitor_projects mp on mp.id = i.project_id
    where public.monitor_can_view(i.project_id) and (p_project is null or i.project_id = p_project)
      and case coalesce(p_scope, 'live') when 'live' then i.status <> 'resolved' when 'resolved' then i.status = 'resolved' else true end
    order by i.opened_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) x
$$;

create or replace function public.monitor_incident_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i public.monitor_incidents; v jsonb;
begin
  select * into i from public.monitor_incidents where id = p_id;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'incident', jsonb_build_object('id', i.id, 'ref', i.ref, 'title', i.title, 'severity', i.severity, 'status', i.status, 'source', i.source, 'fingerprint', i.fingerprint,
      'project_id', i.project_id, 'project_name', (select name from public.monitor_projects where id = i.project_id),
      'assignee_id', i.assignee_id, 'assignee_name', (select nullif(btrim(display_name), '') from public.profiles where id = i.assignee_id),
      'root_cause', i.root_cause, 'opened_at', i.opened_at, 'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at, 'ack_due_at', i.ack_due_at,
      'escalation_level', i.escalation_level, 'reopen_count', i.reopen_count, 'duplicate_of_ref', (select ref from public.monitor_incidents where id = i.duplicate_of)),
    'duplicates', (select coalesce(jsonb_agg(d.ref order by d.opened_at), '[]'::jsonb) from public.monitor_incidents d where d.duplicate_of = i.id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'created_at', n.created_at,
                'author_name', (select nullif(btrim(display_name), '') from public.profiles where id = n.author_id)) order by n.created_at), '[]'::jsonb)
              from public.monitor_incident_notes n where n.incident_id = i.id)) into v;
  return v;
end $$;

-- People who can be given this project's incidents: exactly those who can see it.
create or replace function public.monitor_assignable(p_project uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.monitor_can_view(p_project) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(btrim(pr.display_name), ''), 'Unnamed')) order by pr.display_name), '[]'::jsonb) into v
  from public.profiles pr where pr.role in ('superadmin', 'worker') and public.monitor_user_can_view(pr.id, p_project);
  return v;
end $$;

-- ── the Super Dashboard: one read-only summary; every section is gated by the permission that governs its own data ───────
-- A section the caller may not see is absent (not empty), so no total leaks. Every figure says what kind of figure it is:
--   actual (money that was paid), reconciled (paid and matched to a statement), pending (waiting on a decision or on payment),
--   estimated (a renewal's recorded amount: the real bill may differ).
create or replace function public.super_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := jsonb_build_object('generated_at', now()); v_sections text[] := '{}'; v_main boolean := public."current_role"() = 'superadmin';
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

  if public.monitor_is_platform() then
    v_sections := array_append(v_sections, 'monitoring');
    v := v || jsonb_build_object('monitoring', jsonb_build_object(
      'projects', (select jsonb_build_object('total', count(*),
          'healthy', count(*) filter (where public.monitor_health_of(id) = 'healthy'), 'degraded', count(*) filter (where public.monitor_health_of(id) = 'degraded'),
          'down', count(*) filter (where public.monitor_health_of(id) = 'down'), 'unknown', count(*) filter (where public.monitor_health_of(id) = 'unknown'),
          'paused', count(*) filter (where public.monitor_health_of(id) = 'paused')) from public.monitor_projects),
      'incidents', (select jsonb_build_object('open', count(*), 'critical', count(*) filter (where severity = 'critical'), 'high', count(*) filter (where severity = 'high'),
          'unacknowledged', count(*) filter (where status in ('open', 'reopened')),
          'oldest_unacknowledged_minutes', (extract(epoch from now() - min(opened_at) filter (where status in ('open', 'reopened'))) / 60)::int)
          from public.monitor_incidents where status <> 'resolved' and duplicate_of is null),
      'errors_24h', coalesce((select sum(errors + fatals) from public.monitor_hourly where bucket >= date_trunc('hour', now()) - interval '23 hours'), 0)));
  end if;

  if public.is_support_lead() or v_main then
    v_sections := array_append(v_sections, 'support');
    v := v || jsonb_build_object('support', (select jsonb_build_object(
      'open', count(*) filter (where status not in ('resolved', 'closed')),
      'overdue', count(*) filter (where status not in ('resolved', 'closed') and due_at < now()),
      'unassigned', count(*) filter (where status = 'open' and assignee_id is null),
      'urgent', count(*) filter (where status not in ('resolved', 'closed') and priority = 'urgent')) from public.support_tickets));
  end if;

  if public.can_view_finance() then
    v_sections := array_append(v_sections, 'finance');
    v := v || jsonb_build_object('finance', jsonb_build_object(
      'needs_attention', (select count(*) from public.fund_requests where status in ('payment_failed', 'payment_reversed', 'reconciliation_required')),
      'pending_decision', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', a, 'count', n, 'basis', 'pending') order by currency), '[]'::jsonb)
          from (select currency, sum(amount) a, count(*) n from public.fund_requests where status in ('finance_review', 'department_review', 'awaiting_super_admin') group by currency) q),
      'approved_unpaid', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', a, 'count', n, 'basis', 'pending') order by currency), '[]'::jsonb)
          from (select currency, sum(amount) a, count(*) n from public.fund_requests where status in ('approved', 'payment_processing') group by currency) q),
      'paid_30d', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', a, 'count', n, 'basis', 'actual') order by currency), '[]'::jsonb)
          from (select currency, sum(amount_paid) a, count(*) n from public.fund_requests where status = 'paid' and paid_on >= current_date - 30 group by currency) q),
      'reconciled_30d', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', a, 'count', n, 'basis', 'reconciled') order by currency), '[]'::jsonb)
          from (select currency, sum(amount_paid) a, count(*) n from public.fund_requests where status = 'reconciled' and paid_on >= current_date - 30 group by currency) q)));
    v_sections := array_append(v_sections, 'renewals');
    v := v || jsonb_build_object('renewals', jsonb_build_object(
      'due_30d_count', (select count(*) from public.finance_renewals where status = 'active' and next_due between current_date and current_date + 30),
      'critical_due_30d', (select count(*) from public.finance_renewals where status = 'active' and critical and next_due between current_date and current_date + 30),
      'overdue', (select count(*) from public.finance_renewals where status = 'active' and next_due < current_date),
      'due_30d_amount', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', a, 'basis', 'estimated') order by currency), '[]'::jsonb)
          from (select currency, sum(amount) a from public.finance_renewals where status = 'active' and next_due between current_date and current_date + 30 group by currency) q)));
  end if;

  if v_main then
    v_sections := array_append(v_sections, 'audit');
    v := v || jsonb_build_object('audit', jsonb_build_object(
      'events_24h', (select count(*) from public.audit_logs where created_at > now() - interval '24 hours'),
      'warnings_24h', (select count(*) from public.audit_logs where severity = 'warning' and created_at > now() - interval '24 hours'),
      'critical_24h', (select count(*) from public.audit_logs where severity = 'critical' and created_at > now() - interval '24 hours'),
      'failed_24h', (select count(*) from public.audit_logs where success = false and created_at > now() - interval '24 hours'),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'severity', severity, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
          from (select action, severity, created_at from public.audit_logs where severity in ('warning', 'critical') order by created_at desc limit 5) q)));
  end if;

  return v || jsonb_build_object('sections', to_jsonb(v_sections));
end $$;

-- ── who may call what ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array[
    'monitor_register_project(text, text, text, text, uuid, integer, integer, integer)', 'monitor_update_project(uuid, text, integer, integer, integer)', 'monitor_set_project_active(uuid, boolean)',
    'monitor_create_key(uuid, text, text, text, text[], timestamptz)', 'monitor_revoke_key(uuid)',
    'monitor_open_incident(uuid, text, text, text)', 'monitor_set_incident_status(uuid, text, text)', 'monitor_assign_incident(uuid, uuid)', 'monitor_set_root_cause(uuid, text)',
    'monitor_add_note(uuid, text)', 'monitor_set_severity(uuid, text)', 'monitor_mark_duplicate(uuid, uuid)',
    'monitor_overview()', 'monitor_series(uuid, integer)', 'monitor_top_errors(uuid, integer)', 'monitor_recent_occurrences(uuid, text, integer)',
    'monitor_incidents_list(text, uuid, integer)', 'monitor_incident_detail(uuid)', 'monitor_assignable(uuid)', 'super_dashboard()', 'monitor_sweep()',
    'monitor_is_platform()', 'monitor_can_control()', 'monitor_can_view(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- ingestion and the sweep also run as the service role (the scheduler has no user)
  foreach f in array array['monitor_ingest(text, jsonb)', 'monitor_sweep()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public.monitor_ingest(text, jsonb) from authenticated';
  -- internal plumbing: callable only by other functions in the database
  foreach f in array array['monitor_note(uuid, text, text, uuid)', 'monitor_notify(uuid, text, uuid[], text, text)', 'monitor_responders(uuid, integer)', 'monitor_create_incident(uuid, text, text, text, text, uuid)',
    'monitor_raise_error_incident(uuid, text, integer, boolean)', 'monitor_recover(uuid)', 'monitor_health_of(uuid)', 'monitor_hist_sum(uuid, timestamptz)',
    'monitor_user_can_view(uuid, uuid)', 'monitor_user_is_platform(uuid)', 'guard_monitor_tables()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
