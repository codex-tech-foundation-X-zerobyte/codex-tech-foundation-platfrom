-- Customer Service completion.
--   1. the customer-facing view/reply/rating functions, fixed and tightened (used by the new support-ticket edge function)
--   2. attachments with secure access (private bucket, signed URLs; customers see only the ones marked public)
--   3. linking a ticket to a Super Monitor incident (engineers link, support sees ref/status/severity only)
--   4. overdue / unassigned / incident-resolved notifications, once each, from support_sweep()
--   5. shifts and a workload view for the Customer Service leads
--   6. callbacks to the connected project's backend: a signed, retried, queue-backed webhook (see part 2 below)
-- Rules kept from the support slice: every write goes through a function behind the support guard; internal notes never leave the
-- building; the customer never sees an internal status (escalated shows as in progress); nothing here invents a business rule
-- (shifts are a roster only: nothing is auto-assigned and no pay is computed from them).

-- ── what a customer may be told about a status ───────────────────────────────────────────────────────────────────────────────
create or replace function public.support_customer_status(p text) returns text language sql immutable as $$
  select case p when 'assigned' then 'open' when 'escalated' then 'in_progress' else p end
$$;

-- ── 2. attachments ───────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.support_attachments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  path        text not null unique,
  file_name   text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type   text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv')),
  size_bytes  integer not null check (size_bytes between 1 and 10485760),
  visibility  text not null default 'internal' check (visibility in ('internal', 'public')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists support_attachments_ticket on public.support_attachments (ticket_id, created_at);
alter table public.support_attachments enable row level security;
drop policy if exists "attachments visible with their ticket" on public.support_attachments;
create policy "attachments visible with their ticket" on public.support_attachments for select to authenticated using (public.can_see_ticket(ticket_id));
revoke all on public.support_attachments from anon, authenticated;
grant select on public.support_attachments to authenticated;
drop trigger if exists guard_support_attachments on public.support_attachments;
create trigger guard_support_attachments before insert or update or delete on public.support_attachments for each row execute function public.guard_support_tables();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('support-attachments', 'support-attachments', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;
drop policy if exists "support attachments readable by those who see the ticket" on storage.objects;
create policy "support attachments readable by those who see the ticket" on storage.objects for select to authenticated using (bucket_id = 'support-attachments' and public.uuid_from_path_segment(name, 1) is not null and public.can_see_ticket(public.uuid_from_path_segment(name, 1)));
drop policy if exists "support attachments added by those who see the ticket" on storage.objects;
create policy "support attachments added by those who see the ticket" on storage.objects for insert to authenticated with check (bucket_id = 'support-attachments' and public.uuid_from_path_segment(name, 1) is not null and public.can_see_ticket(public.uuid_from_path_segment(name, 1)));
-- No update or delete policy on purpose: evidence stays.

-- Registers a file that was just uploaded. The object must exist, be the caller's own, and sit in this ticket's folder, so a path
-- cannot be made up to point at someone else's file. Only Customer Service may make a file visible to the customer.
create or replace function public.support_add_attachment(p_ticket uuid, p_path text, p_name text, p_mime text, p_size integer, p_visibility text default 'internal') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev text := coalesce(nullif(current_setting('ctf.support_rpc', true), ''), 'off');
begin
  if not exists (select 1 from public.support_tickets where id = p_ticket) or not public.can_see_ticket(p_ticket) then raise exception 'Ticket not found.' using errcode = '42501'; end if;
  if p_visibility not in ('internal', 'public') then raise exception 'Visibility must be internal or public.' using errcode = '22023'; end if;
  if p_visibility = 'public' and not public.is_support_agent() then raise exception 'Only Customer Service can share a file with the customer.' using errcode = '42501'; end if;
  if left(coalesce(p_path, ''), 37) <> p_ticket::text || '/' then raise exception 'The file is not in this ticket''s folder.' using errcode = '23514'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'support-attachments' and name = p_path and owner = auth.uid()) then raise exception 'That upload was not found. Upload the file first.' using errcode = 'P0002'; end if;
  if (select count(*) from public.support_attachments where ticket_id = p_ticket) >= 20 then raise exception 'A ticket can hold at most 20 attachments.' using errcode = '23514'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  insert into public.support_attachments (ticket_id, path, file_name, mime_type, size_bytes, visibility, uploaded_by) values (p_ticket, p_path, left(btrim(p_name), 200), p_mime, p_size, p_visibility, auth.uid()) returning id into v_id;
  perform set_config('ctf.support_rpc', v_prev, true);
  perform public.support_note(p_ticket, 'Attachment added: ' || left(btrim(p_name), 120) || case when p_visibility = 'public' then ' (shared with the customer).' else ' (internal).' end, 'internal', 'system', auth.uid());
  return v_id;
end $$;

-- ── 3. tickets and incidents ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.support_ticket_incidents (
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  incident_id uuid not null references public.monitor_incidents (id) on delete cascade,
  linked_by   uuid references public.profiles (id) on delete set null,
  linked_at   timestamptz not null default now(),
  primary key (ticket_id, incident_id)
);
alter table public.support_ticket_incidents enable row level security;
revoke all on public.support_ticket_incidents from anon, authenticated;   -- read and written only through the functions below

-- Linking is for people who may already see that incident (engineers, DevOps, the Main Admin), on a ticket they may see.
-- The reference is looked up inside, and a miss and a no-access look the same: nobody learns which incident references exist.
create or replace function public.support_link_incident(p_ticket uuid, p_incident_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.monitor_incidents; v_prev text := coalesce(nullif(current_setting('ctf.support_rpc', true), ''), 'off'); v_n int;
begin
  if not exists (select 1 from public.support_tickets where id = p_ticket) or not public.can_see_ticket(p_ticket) then raise exception 'Ticket not found.' using errcode = '42501'; end if;
  select * into i from public.monitor_incidents where ref = upper(btrim(p_incident_ref));
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'No incident with that reference that you can link.' using errcode = 'P0002'; end if;
  insert into public.support_ticket_incidents (ticket_id, incident_id, linked_by) values (p_ticket, i.id, auth.uid()) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.support_note(p_ticket, 'Linked to incident ' || i.ref || '.', 'internal', 'system', auth.uid()); end if;
end $$;

create or replace function public.support_unlink_incident(p_ticket uuid, p_incident uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.monitor_incidents; v_n int;
begin
  if not exists (select 1 from public.support_tickets where id = p_ticket) or not public.can_see_ticket(p_ticket) then raise exception 'Ticket not found.' using errcode = '42501'; end if;
  select * into i from public.monitor_incidents where id = p_incident;
  if not found or not public.monitor_can_view(i.project_id) then raise exception 'No incident with that reference that you can link.' using errcode = 'P0002'; end if;
  delete from public.support_ticket_incidents where ticket_id = p_ticket and incident_id = p_incident;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.support_note(p_ticket, 'Unlinked from incident ' || i.ref || '.', 'internal', 'system', auth.uid()); end if;
end $$;

-- What Customer Service may see about a linked incident: its reference, severity, status and project. Never its title, notes or root cause.
create or replace function public.support_ticket_incident_links(p_ticket uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.support_tickets where id = p_ticket) or not public.can_see_ticket(p_ticket) then raise exception 'Ticket not found.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'ref', i.ref, 'status', i.status, 'severity', i.severity, 'project', mp.name, 'linked_at', l.linked_at) order by l.linked_at)
    from public.support_ticket_incidents l join public.monitor_incidents i on i.id = l.incident_id join public.monitor_projects mp on mp.id = i.project_id where l.ticket_id = p_ticket), '[]'::jsonb);
end $$;

-- ── 1. the customer-facing functions (the support-ticket edge function calls these with the service role) ────────────────────
create or replace function public.support_ticket_view(p_key_hash text, p_external_ref text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ticket', jsonb_build_object('ref', t.ref, 'status', public.support_customer_status(t.status), 'subject', t.subject, 'created_at', t.created_at, 'resolved_at', t.resolved_at, 'rating', t.rating,
        'can_reply', t.status <> 'closed', 'can_rate', t.status in ('resolved', 'closed') and t.rating is null),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.author_kind = 'customer' then 'customer' else 'support' end, 'body', m.body, 'at', m.created_at) order by m.created_at)
        from public.support_messages m where m.ticket_id = t.id and m.visibility = 'public'), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes) order by a.created_at)
        from public.support_attachments a where a.ticket_id = t.id and a.visibility = 'public'), '[]'::jsonb))
  from public.support_sources s join public.support_tickets t on t.source_id = s.id and t.external_ref = p_external_ref
  where s.key_hash = p_key_hash and s.active
$$;

-- Same signature as before, now refusing a reply to a closed ticket and a flood of replies.
create or replace function public.support_customer_reply(p_key_hash text, p_external_ref text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_prev text := coalesce(nullif(current_setting('ctf.support_rpc', true), ''), 'off');
begin
  select t2.* into t from public.support_sources s join public.support_tickets t2 on t2.source_id = s.id and t2.external_ref = p_external_ref where s.key_hash = p_key_hash and s.active;
  if not found then raise exception 'Ticket not found.' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write something first.' using errcode = '23514'; end if;
  if t.status = 'closed' then raise exception 'This ticket is closed. Open a new one.' using errcode = '23514'; end if;
  if (select count(*) from public.support_messages where ticket_id = t.id and author_kind = 'customer') >= 100 then raise exception 'Too many replies on this ticket.' using errcode = '23514'; end if;
  perform public.support_note(t.id, left(btrim(p_body), 8000), 'public', 'customer', null);
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set status = case when status in ('waiting_for_customer', 'resolved') then 'in_progress' else status end, resolved_at = case when status = 'resolved' then null else resolved_at end where id = t.id;
  perform set_config('ctf.support_rpc', v_prev, true);
  perform public.notify_support(array[t.assignee_id], 'The customer replied', t.ref || ': ' || t.subject);
end $$;

-- Same signature as before, now telling the caller when nothing was recorded (it used to do nothing silently).
create or replace function public.support_customer_rating(p_key_hash text, p_external_ref text, p_rating integer, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_prev text := coalesce(nullif(current_setting('ctf.support_rpc', true), ''), 'off');
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5.' using errcode = '22023'; end if;
  select t2.* into t from public.support_sources s join public.support_tickets t2 on t2.source_id = s.id and t2.external_ref = p_external_ref where s.key_hash = p_key_hash and s.active;
  if not found then raise exception 'Ticket not found.' using errcode = 'P0002'; end if;
  if t.status not in ('resolved', 'closed') then raise exception 'A ticket can be rated once it is resolved.' using errcode = '23514'; end if;
  if t.rating is not null then raise exception 'This ticket has already been rated.' using errcode = '23514'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set rating = p_rating, rating_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '') where id = t.id;
  perform set_config('ctf.support_rpc', v_prev, true);
end $$;

-- The storage path of a file the customer is allowed to download (public, on their own ticket). The edge function turns it into a short-lived link.
create or replace function public.support_attachment_path(p_key_hash text, p_external_ref text, p_attachment uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('path', a.path, 'name', a.file_name, 'mime_type', a.mime_type)
  from public.support_sources s join public.support_tickets t on t.source_id = s.id and t.external_ref = p_external_ref
  join public.support_attachments a on a.ticket_id = t.id and a.id = p_attachment and a.visibility = 'public'
  where s.key_hash = p_key_hash and s.active
$$;

-- ── 4. notifications for what is going wrong, once each ──────────────────────────────────────────────────────────────────────
create table if not exists public.support_notified (
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  dedupe_key text not null,
  sent_at    timestamptz not null default now(),
  primary key (ticket_id, dedupe_key)
);
alter table public.support_notified enable row level security;
revoke all on public.support_notified from anon, authenticated;

create or replace function public.support_notify_once(p_ticket uuid, p_key text, p_users uuid[], p_title text, p_body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.support_notified (ticket_id, dedupe_key) values (p_ticket, p_key) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  perform public.notify_support(p_users, p_title, p_body);
  return true;
end $$;

create or replace function public.support_sweep() returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_l1 int := 0; v_l2 int := 0; v_un int := 0; v_inc int := 0; v_purged int := 0; r record;
begin
  if auth.uid() is not null and not public.is_support_lead() then raise exception 'Only a Customer Service lead or the scheduler can run these checks.' using errcode = '42501'; end if;

  -- a customer still waiting for a FIRST reply past its target (a ticket waiting on the customer is not late)
  for t in select * from public.support_tickets where first_response_at is null and status in ('open', 'assigned', 'in_progress', 'escalated') and due_at < now() loop
    if public.support_notify_once(t.id, 'overdue:1', public.support_leads() || array_remove(array[t.assignee_id], null), 'A customer is still waiting for a first reply', t.ref || ': ' || t.subject || ' (' || t.priority || ')') then v_l1 := v_l1 + 1; end if;
    -- twice the target has gone by: the Main Admins hear about it too
    if now() > t.due_at + (t.due_at - t.created_at) and public.support_notify_once(t.id, 'overdue:2', array(select id from public.profiles where role = 'superadmin'), 'A customer has waited twice the target for a first reply', t.ref || ': ' || t.subject) then v_l2 := v_l2 + 1; end if;
  end loop;

  for t in select * from public.support_tickets where status = 'open' and assignee_id is null and first_response_at is null and created_at < now() - interval '15 minutes' loop
    if public.support_notify_once(t.id, 'unassigned', public.support_leads(), 'A ticket has had nobody assigned for 15 minutes', t.ref || ': ' || t.subject) then v_un := v_un + 1; end if;
  end loop;

  -- the incident behind a ticket is resolved: time to tell the customer
  for r in select l.ticket_id, i.id as incident_id, i.ref as incident_ref, tk.ref as ticket_ref, tk.subject, tk.assignee_id from public.support_ticket_incidents l
        join public.monitor_incidents i on i.id = l.incident_id join public.support_tickets tk on tk.id = l.ticket_id where i.status = 'resolved' and tk.status not in ('resolved', 'closed') loop
    if public.support_notify_once(r.ticket_id, 'incident-resolved:' || r.incident_id, array_remove(array[r.assignee_id], null) || public.support_leads(), 'The incident behind a ticket is resolved', r.ticket_ref || ': ' || r.subject || ' (' || r.incident_ref || ')') then v_inc := v_inc + 1; end if;
  end loop;

  return jsonb_build_object('overdue_notified', v_l1, 'overdue_escalated', v_l2, 'unassigned_notified', v_un, 'incident_resolved_notified', v_inc);
end $$;

-- ── 5. shifts and workload ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.support_shifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  note       text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index if not exists support_shifts_time on public.support_shifts (starts_at, ends_at);
alter table public.support_shifts enable row level security;
drop policy if exists "the support team sees the roster" on public.support_shifts;
create policy "the support team sees the roster" on public.support_shifts for select to authenticated using (public.is_support_agent());
revoke all on public.support_shifts from anon, authenticated;
grant select on public.support_shifts to authenticated;

create or replace function public.support_add_shift(p_user uuid, p_starts timestamptz, p_ends timestamptz, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can set shifts.' using errcode = '42501'; end if;
  if p_ends <= p_starts or p_ends - p_starts > interval '24 hours' then raise exception 'A shift must end after it starts and last at most 24 hours.' using errcode = '23514'; end if;
  if not exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id where wd.user_id = p_user and wp.status = 'active' and wd.department_id = public.department_id_by_slug('customer-service'))
     and not exists (select 1 from public.profiles where id = p_user and role = 'superadmin') then raise exception 'That person is not on the Customer Service team.' using errcode = '23514'; end if;
  if exists (select 1 from public.support_shifts where user_id = p_user and starts_at < p_ends and ends_at > p_starts) then raise exception 'That person already has a shift that overlaps this one.' using errcode = '23514'; end if;
  insert into public.support_shifts (user_id, starts_at, ends_at, note, created_by) values (p_user, p_starts, p_ends, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;
create or replace function public.support_delete_shift(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can change shifts.' using errcode = '42501'; end if;
  delete from public.support_shifts where id = p_id;
  if not found then raise exception 'Shift not found.' using errcode = 'P0002'; end if;
end $$;

-- The roster with names, for the support team: shifts that end after p_from and start before p_to.
create or replace function public.support_roster(p_from timestamptz default now() - interval '12 hours', p_to timestamptz default now() + interval '8 days') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_agent() then raise exception 'Only the Customer Service team can see the roster.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'user_id', s.user_id, 'name', coalesce(nullif(btrim(p.display_name), ''), 'Unnamed'), 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'note', s.note,
    'on_now', s.starts_at <= now() and s.ends_at > now()) order by s.starts_at, p.display_name)
    from public.support_shifts s join public.profiles p on p.id = s.user_id where s.ends_at > p_from and s.starts_at < least(p_to, p_from + interval '31 days')), '[]'::jsonb);
end $$;

-- Per person: what is on their plate and how they are doing. Leads only (ratings and response times are about people).
create or replace function public.support_workload() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can see workload.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'unassigned', (select count(*) from public.support_tickets where status = 'open' and assignee_id is null),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'name', coalesce(nullif(btrim(p.display_name), ''), 'Unnamed'),
      'open', (select count(*) from public.support_tickets t where t.assignee_id = p.id and t.status not in ('resolved', 'closed')),
      'overdue', (select count(*) from public.support_tickets t where t.assignee_id = p.id and t.first_response_at is null and t.status in ('open', 'assigned', 'in_progress', 'escalated') and t.due_at < now()),
      'waiting_for_customer', (select count(*) from public.support_tickets t where t.assignee_id = p.id and t.status = 'waiting_for_customer'),
      'resolved_7d', (select count(*) from public.support_tickets t where t.assignee_id = p.id and t.resolved_at > now() - interval '7 days'),
      'avg_first_response_minutes_7d', (select round(avg(extract(epoch from t.first_response_at - t.created_at) / 60))::int from public.support_tickets t where t.assignee_id = p.id and t.first_response_at > now() - interval '7 days'),
      'avg_rating_30d', (select round(avg(t.rating)::numeric, 1) from public.support_tickets t where t.assignee_id = p.id and t.rating is not null and t.resolved_at > now() - interval '30 days'),
      'on_shift', exists (select 1 from public.support_shifts s where s.user_id = p.id and s.starts_at <= now() and s.ends_at > now())) order by p.display_name)
      from public.profiles p where p.role in ('worker', 'superadmin') and (p.role = 'superadmin' and exists (select 1 from public.support_tickets t where t.assignee_id = p.id)
        or exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id where wd.user_id = p.id and wp.status = 'active' and wd.department_id = public.department_id_by_slug('customer-service')))), '[]'::jsonb));
end $$;

-- ── 6. callbacks to the connected project's backend ──────────────────────────────────────────────────────────────────────────
-- When Customer Service answers, or a ticket's status changes in a way the customer would notice, the project's own backend is told,
-- so it can show the customer. Each message is SIGNED (HMAC-SHA256 with a per-project secret), delivered from a queue, retried with
-- growing delays, and given up on after six attempts (the leads are told). It is a nudge, not a source of truth: the project should
-- confirm by asking the support-ticket endpoint. Payloads carry the ticket reference, the project's own reference and the customer-safe
-- status and text only: never an internal note, an assignee, or an escalation.
create or replace function public.support_callback_url_ok(p_url text) returns boolean language sql immutable as $$
  select p_url is not null
     and char_length(p_url) <= 300
     and lower(btrim(p_url)) ~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(:(443|8443))?(/[^[:space:]#]*)?$'      -- https, a real domain name (so no IP address), port 443/8443 only, no user:pass@
     and lower(btrim(p_url)) !~ '^https://[^/:]*\.(local|localhost|internal|lan|home|corp|intranet|private|test|invalid|example)(:|/|$)'
$$;

create sequence if not exists public.support_callback_seq;
create table if not exists public.support_callbacks (
  source_id  uuid primary key references public.support_sources (id) on delete cascade,
  url        text not null check (public.support_callback_url_ok(url)),
  secret     text not null check (char_length(secret) = 64),
  enabled    boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
create table if not exists public.support_callback_events (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint not null default nextval('public.support_callback_seq'),   -- increases with every event: a receiver ignores anything older than what it has applied
  source_id       uuid not null references public.support_sources (id) on delete cascade,
  ticket_id       uuid not null references public.support_tickets (id) on delete cascade,
  event           text not null check (event in ('ticket.acknowledged', 'ticket.reply', 'ticket.status')),
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'delivering', 'delivered', 'dead')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_http       integer,
  last_error      text check (last_error is null or char_length(last_error) <= 200),
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
alter table public.support_callback_events add column if not exists seq bigint not null default nextval('public.support_callback_seq');
create index if not exists support_callback_events_due on public.support_callback_events (status, next_attempt_at) where status in ('pending', 'delivering');
create index if not exists support_callback_events_source on public.support_callback_events (source_id, created_at desc);
alter table public.support_callbacks enable row level security;
alter table public.support_callback_events enable row level security;
revoke all on public.support_callbacks, public.support_callback_events from anon, authenticated;   -- the secret is never readable by a signed-in user; leads read a summary through a function

create or replace function public.support_enqueue_callback(p_ticket uuid, p_event text, p_extra jsonb) returns void language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_seq bigint := nextval('public.support_callback_seq');
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found or t.source_id is null or t.external_ref is null then return; end if;
  if not exists (select 1 from public.support_callbacks c where c.source_id = t.source_id and c.enabled) then return; end if;
  -- Only a status event carries a status. A reply or acknowledgement is queued a moment BEFORE the ticket's status is updated, so any status
  -- on it could be stale, and events can arrive out of order. `sequence` lets the receiver keep the newest it has seen.
  insert into public.support_callback_events (source_id, ticket_id, event, payload, seq)
  values (t.source_id, t.id, p_event, jsonb_build_object('event', p_event, 'sequence', v_seq, 'ticket_ref', t.ref, 'external_ref', t.external_ref, 'occurred_at', now())
     || case when p_event = 'ticket.status' then jsonb_build_object('status', public.support_customer_status(t.status)) else '{}'::jsonb end || coalesce(p_extra, '{}'::jsonb), v_seq);
end $$;

create or replace function public.support_cb_on_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'public' and new.author_kind = 'agent' then
    perform public.support_enqueue_callback(new.ticket_id, 'ticket.reply', jsonb_build_object('message', jsonb_build_object('body', new.body, 'at', new.created_at)));
  end if;
  return new;
end $$;
drop trigger if exists support_callback_on_message on public.support_messages;
create trigger support_callback_on_message after insert on public.support_messages for each row execute function public.support_cb_on_message();

create or replace function public.support_cb_on_ticket() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.first_response_at is null and new.first_response_at is not null then
    perform public.support_enqueue_callback(new.id, 'ticket.acknowledged', jsonb_build_object('acknowledged_at', new.first_response_at));
  end if;
  if public.support_customer_status(old.status) is distinct from public.support_customer_status(new.status) then   -- open to assigned, or in progress to escalated, is not news to a customer
    perform public.support_enqueue_callback(new.id, 'ticket.status', '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists support_callback_on_ticket on public.support_tickets;
create trigger support_callback_on_ticket after update of status, first_response_at on public.support_tickets for each row execute function public.support_cb_on_ticket();

-- Main Admin: set or rotate the callback. The secret is made here, returned ONCE to the caller, and never shown again.
create or replace function public.support_set_callback(p_source uuid, p_url text) returns text language plpgsql security definer set search_path = public as $$
declare v_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if public."current_role"() <> 'superadmin' then raise exception 'Only a Main Admin can set a callback.' using errcode = '42501'; end if;
  if not exists (select 1 from public.support_sources where id = p_source) then raise exception 'Connected project not found.' using errcode = 'P0002'; end if;
  if not public.support_callback_url_ok(p_url) then raise exception 'The callback address must be an https:// web address with a real domain name (no IP addresses, no internal names, port 443 or 8443).' using errcode = '23514'; end if;
  insert into public.support_callbacks (source_id, url, secret, created_by) values (p_source, btrim(p_url), v_secret, auth.uid())
  on conflict (source_id) do update set url = excluded.url, secret = excluded.secret, enabled = true, rotated_at = now();
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), 'support.callback.set', 'support_source', p_source, 'info', jsonb_build_object('host', split_part(split_part(btrim(p_url), '://', 2), '/', 1)));
  return v_secret;
end $$;

create or replace function public.support_clear_callback(p_source uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if public."current_role"() <> 'superadmin' then raise exception 'Only a Main Admin can remove a callback.' using errcode = '42501'; end if;
  delete from public.support_callbacks where source_id = p_source;
  update public.support_callback_events set status = 'dead', last_error = 'Callback removed' where source_id = p_source and status in ('pending', 'delivering');
  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, severity, metadata) values (auth.uid(), 'support.callback.clear', 'support_source', p_source, 'warning', '{}');
end $$;

-- Leads see only the host (a callback address may carry a secret in its path), never the secret.
create or replace function public.support_callbacks_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can see callbacks.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('source_id', s.id, 'name', s.name, 'configured', c.source_id is not null, 'enabled', coalesce(c.enabled, false),
      'host', split_part(split_part(c.url, '://', 2), '/', 1),
      'pending', (select count(*) from public.support_callback_events e where e.source_id = s.id and e.status in ('pending', 'delivering')),
      'dead', (select count(*) from public.support_callback_events e where e.source_id = s.id and e.status = 'dead'),
      'delivered_24h', (select count(*) from public.support_callback_events e where e.source_id = s.id and e.status = 'delivered' and e.delivered_at > now() - interval '24 hours'),
      'last_delivery_at', (select max(e.delivered_at) from public.support_callback_events e where e.source_id = s.id),
      'last_error', (select e.last_error from public.support_callback_events e where e.source_id = s.id and e.last_error is not null order by e.created_at desc limit 1)) order by s.name)
    from public.support_sources s left join public.support_callbacks c on c.source_id = s.id), '[]'::jsonb);
end $$;

create or replace function public.support_callback_events_list(p_source uuid, p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can see callbacks.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event', e.event, 'ticket_ref', t.ref, 'status', e.status, 'attempts', e.attempts, 'last_http', e.last_http, 'last_error', e.last_error, 'created_at', e.created_at, 'delivered_at', e.delivered_at) order by e.created_at desc)
    from (select * from public.support_callback_events where source_id = p_source order by created_at desc limit greatest(1, least(coalesce(p_limit, 25), 100))) e join public.support_tickets t on t.id = e.ticket_id), '[]'::jsonb);
end $$;

create or replace function public.support_callback_retry(p_event uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_support_lead() then raise exception 'Only a Customer Service lead can retry a delivery.' using errcode = '42501'; end if;
  update public.support_callback_events set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where id = p_event and status = 'dead';
  if not found then raise exception 'Only a delivery that was given up on can be retried.' using errcode = '23514'; end if;
end $$;

-- ── the worker side (service role only): claim due deliveries, then report how each went ───────────────────────────────────
-- A claimed delivery is leased for two minutes; if the worker dies, it is picked up again. Two workers can never take the same one.
create or replace function public.support_callbacks_claim(p_limit integer default 20) returns table (event_id uuid, url text, secret text, event text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select e.id from public.support_callback_events e join public.support_callbacks c on c.source_id = e.source_id and c.enabled
     where (e.status = 'pending' or e.status = 'delivering') and e.next_attempt_at <= now() order by e.next_attempt_at limit greatest(1, least(coalesce(p_limit, 20), 50)) for update of e skip locked),
  taken as (update public.support_callback_events e set status = 'delivering', next_attempt_at = now() + interval '2 minutes' from due where e.id = due.id returning e.id, e.source_id, e.event, e.payload, e.attempts)
  select taken.id, c.url, c.secret, taken.event, taken.payload, taken.attempts from taken join public.support_callbacks c on c.source_id = taken.source_id;
end $$;

create or replace function public.support_callback_report(p_event uuid, p_ok boolean, p_http integer, p_error text) returns void language plpgsql security definer set search_path = public as $$
declare e public.support_callback_events; v_next interval; v_ref text; v_name text;
begin
  select * into e from public.support_callback_events where id = p_event for update;
  if not found or e.status <> 'delivering' then return; end if;   -- already settled (a late report after a lease expiry): nothing to do
  if p_ok then
    update public.support_callback_events set status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_http = p_http, last_error = null where id = p_event;
    return;
  end if;
  v_next := case e.attempts + 1 when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes' when 4 then interval '2 hours' when 5 then interval '12 hours' end;
  if v_next is null then
    update public.support_callback_events set status = 'dead', attempts = attempts + 1, last_http = p_http, last_error = left(coalesce(p_error, 'Failed'), 200) where id = p_event;
    select t.ref, s.name into v_ref, v_name from public.support_tickets t join public.support_sources s on s.id = e.source_id where t.id = e.ticket_id;
    perform public.notify_support(public.support_leads(), 'A callback to ' || v_name || ' was given up on', v_ref || ': ' || e.event || ' could not be delivered after 6 tries. You can retry it from Connected projects.');
  else
    update public.support_callback_events set status = 'pending', attempts = attempts + 1, next_attempt_at = now() + v_next, last_http = p_http, last_error = left(coalesce(p_error, 'Failed'), 200) where id = p_event;
  end if;
end $$;

-- housekeeping, called by the sweep: finished deliveries are kept for 30 days
create or replace function public.support_callbacks_purge() returns integer language plpgsql security definer set search_path = public as $$
declare v int;
begin
  delete from public.support_callback_events where status in ('delivered', 'dead') and created_at < now() - interval '30 days';
  get diagnostics v = row_count;
  return v;
end $$;

-- ── who may call what ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['support_add_attachment(uuid, text, text, text, integer, text)', 'support_link_incident(uuid, text)', 'support_unlink_incident(uuid, uuid)', 'support_ticket_incident_links(uuid)',
    'support_sweep()', 'support_roster(timestamptz, timestamptz)', 'support_add_shift(uuid, timestamptz, timestamptz, text)', 'support_delete_shift(uuid)', 'support_workload()',
    'support_set_callback(uuid, text)', 'support_clear_callback(uuid)', 'support_callbacks_overview()', 'support_callback_events_list(uuid, integer)', 'support_callback_retry(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- the sweep is also run by the scheduler (service role, no user)
  execute 'grant execute on function public.support_sweep() to service_role';
  foreach f in array array['support_ticket_view(text, text)', 'support_customer_reply(text, text, text)', 'support_customer_rating(text, text, integer, text)', 'support_attachment_path(text, text, uuid)',
    'support_callbacks_claim(integer)', 'support_callback_report(uuid, boolean, integer, text)', 'support_callbacks_purge()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['support_customer_status(text)', 'support_callback_url_ok(text)'] loop   -- pure, harmless
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['support_notify_once(uuid, text, uuid[], text, text)', 'support_enqueue_callback(uuid, text, jsonb)', 'support_cb_on_message()', 'support_cb_on_ticket()'] loop   -- plumbing
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
