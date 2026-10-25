-- Customer Service: one central ticket system. Tickets come from two places: a support agent logging one for a customer, and a connected
-- project's backend forwarding a customer's report (through the support-intake edge function, which calls support_intake() with the
-- service role). Customers never touch these tables: they only ever receive what the *_public functions choose to return.
--
-- Rules enforced here, not in the UI:
--  * Internal notes and customer-visible replies are different rows (visibility) and the customer-facing functions return only 'public'.
--  * A retried webhook cannot create a second ticket: (source, external_ref) is unique and a repeat returns the existing ticket.
--  * Support staff see support tickets and nothing else they weren't given. Technical departments see a ticket only once it is escalated to them.
--  * Nobody writes the tables directly; changes go through functions that check who may do what and leave a trail.

create sequence if not exists public.support_ticket_seq;

-- A connected project allowed to send tickets. Only the SHA-256 of its key is stored; the key itself is shown once, when it is made.
create table if not exists public.support_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  project_id  uuid references public.projects (id) on delete set null,
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix  text not null check (char_length(key_prefix) between 4 and 12),
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('TKT-' || lpad(nextval('public.support_ticket_seq')::text, 6, '0')),
  source_id     uuid references public.support_sources (id) on delete set null,
  external_ref  text check (external_ref is null or char_length(external_ref) between 1 and 200),
  customer_ref  text not null default '' check (char_length(customer_ref) <= 200),
  customer_name text not null default '' check (char_length(customer_name) <= 120),
  subject       text not null check (char_length(btrim(subject)) between 3 and 200),
  description   text not null default '' check (char_length(description) <= 8000),
  category      text not null default 'other' check (category in ('bug', 'billing', 'account', 'how_to', 'feedback', 'other')),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status        text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'waiting_for_customer', 'escalated', 'resolved', 'closed')),
  assignee_id   uuid references public.profiles (id) on delete set null,
  escalated_department_id uuid references public.departments (id),
  escalated_record_id     uuid,
  created_by    uuid references public.profiles (id) on delete set null,
  due_at        timestamptz not null,
  first_response_at timestamptz,
  resolved_at   timestamptz,
  rating        smallint check (rating between 1 and 5),
  rating_note   text check (rating_note is null or char_length(rating_note) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists support_tickets_dedupe on public.support_tickets (source_id, external_ref) where source_id is not null and external_ref is not null;
create index if not exists support_tickets_status_idx on public.support_tickets (status, due_at);
create index if not exists support_tickets_assignee_idx on public.support_tickets (assignee_id) where assignee_id is not null;

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  author_kind text not null check (author_kind in ('agent', 'customer', 'system')),
  visibility  text not null check (visibility in ('public', 'internal')),
  body        text not null check (char_length(btrim(body)) between 1 and 8000),
  created_at  timestamptz not null default now(),
  check (author_kind <> 'customer' or visibility = 'public')   -- a customer's words are never "internal"
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- Targets for the first response, by priority. These are defaults, not policy: change the interval here to change the target.
create or replace function public.support_due_at(p_priority text, p_from timestamptz default now()) returns timestamptz language sql immutable as $$
  select p_from + case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '24 hours' when 'low' then interval '96 hours' else interval '48 hours' end
$$;

-- ── who is who ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_support_agent() returns boolean language sql stable security definer set search_path = public as $$
  select public."current_role"() = 'superadmin' or exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
        where wd.user_id = auth.uid() and wp.status = 'active' and wd.department_id = public.department_id_by_slug('customer-service'))
$$;
create or replace function public.is_support_lead() returns boolean language sql stable security definer set search_path = public as $$
  select public."current_role"() = 'superadmin' or public.is_department_admin(public.department_id_by_slug('customer-service'))
$$;
create or replace function public.can_see_ticket(p_ticket uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_support_agent() or exists (select 1 from public.support_tickets t where t.id = p_ticket and t.escalated_department_id is not null and t.escalated_department_id = any (public.current_department_ids()))
$$;

alter table public.support_sources enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
drop policy if exists "support leads see connected projects" on public.support_sources;
create policy "support leads see connected projects" on public.support_sources for select to authenticated using (public.is_support_lead());
drop policy if exists "tickets visible to support and the department they were escalated to" on public.support_tickets;
create policy "tickets visible to support and the department they were escalated to" on public.support_tickets for select to authenticated using (public.can_see_ticket(id));
drop policy if exists "messages visible with their ticket" on public.support_messages;
create policy "messages visible with their ticket" on public.support_messages for select to authenticated using (public.can_see_ticket(ticket_id));
revoke all on public.support_sources, public.support_tickets, public.support_messages from anon, authenticated;
grant select on public.support_sources, public.support_tickets, public.support_messages to authenticated;
grant select (id, name, project_id, key_prefix, active, created_by, created_at, last_used_at) on public.support_sources to authenticated;
revoke select on public.support_sources from authenticated; grant select (id, name, project_id, key_prefix, active, created_by, created_at, last_used_at) on public.support_sources to authenticated;

drop trigger if exists audit_ticket_changes on public.support_tickets;
create trigger audit_ticket_changes after update of status, assignee_id, escalated_department_id on public.support_tickets for each row execute function public.audit_row_change('support_ticket.changed');

create or replace function public.guard_support_tables() returns trigger language plpgsql as $$
begin
  if current_setting('ctf.support_rpc', true) is distinct from 'on' then raise exception 'Support tickets change only through the support workflow.' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then raise exception 'Support history cannot be deleted.' using errcode = '42501'; end if;
  if tg_table_name = 'support_tickets' and tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_support_tickets on public.support_tickets;
create trigger guard_support_tickets before insert or update or delete on public.support_tickets for each row execute function public.guard_support_tables();
drop trigger if exists guard_support_messages on public.support_messages;
create trigger guard_support_messages before insert or update or delete on public.support_messages for each row execute function public.guard_support_tables();

create or replace function public.support_note(p_ticket uuid, p_body text, p_visibility text, p_kind text, p_author uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('ctf.support_rpc', 'on', true);   -- this is the workflow: the guard on support_messages needs the flag for this insert
  insert into public.support_messages (ticket_id, author_id, author_kind, visibility, body) values (p_ticket, p_author, p_kind, p_visibility, p_body);
  perform set_config('ctf.support_rpc', 'off', true);
end $$;
create or replace function public.notify_support(p_users uuid[], p_title text, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, kind) select distinct u, p_title, p_body, 'support' from unnest(p_users) as u where u is not null and u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
$$;
create or replace function public.support_leads() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select wd.user_id as x from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id where wd.department_id = public.department_id_by_slug('customer-service') and wd.department_role = 'admin' and wp.status = 'active'
    union select id from public.profiles where role = 'superadmin') q
$$;

-- ── agents ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.create_support_ticket(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_pri text := coalesce(nullif(p_data ->> 'priority', ''), 'normal');
begin
  if not public.is_support_agent() then raise exception 'Only Customer Service staff can log tickets.' using errcode = '42501'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  insert into public.support_tickets (customer_ref, customer_name, subject, description, category, priority, created_by, due_at)
  values (coalesce(p_data ->> 'customer_ref', ''), coalesce(p_data ->> 'customer_name', ''), coalesce(p_data ->> 'subject', ''), coalesce(p_data ->> 'description', ''),
          coalesce(nullif(p_data ->> 'category', ''), 'other'), v_pri, auth.uid(), public.support_due_at(v_pri))
  returning id into v_id;
  perform set_config('ctf.support_rpc', 'off', true);
  perform public.support_note(v_id, 'Ticket logged by a support agent.', 'internal', 'system', auth.uid());
  return v_id;
end $$;

create or replace function public.assign_ticket(p_id uuid, p_assignee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_name text;
begin
  select * into t from public.support_tickets where id = p_id for update;
  if not found or not public.is_support_agent() then raise exception 'Ticket not found, or you are not Customer Service staff.' using errcode = '42501'; end if;
  -- an agent may take an unassigned ticket for themselves; moving it to someone else is a lead's call
  if not (public.is_support_lead() or (t.assignee_id is null and p_assignee = auth.uid())) then raise exception 'Only a Customer Service lead can assign tickets to other people.' using errcode = '42501'; end if;
  if p_assignee is not null and not exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
        where wd.user_id = p_assignee and wp.status = 'active' and wd.department_id = public.department_id_by_slug('customer-service')) and not exists (select 1 from public.profiles where id = p_assignee and role = 'superadmin') then
    raise exception 'That person is not on the Customer Service team.' using errcode = '23514';
  end if;
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set assignee_id = p_assignee, status = case when p_assignee is null then 'open' when status = 'open' then 'assigned' else status end where id = p_id returning * into t;
  perform set_config('ctf.support_rpc', 'off', true);
  select coalesce(display_name, 'someone') into v_name from public.profiles where id = p_assignee;
  perform public.support_note(p_id, case when p_assignee is null then 'Unassigned.' else 'Assigned to ' || v_name || '.' end, 'internal', 'system', auth.uid());
  perform public.notify_support(array[p_assignee], 'A ticket was assigned to you', t.ref || ': ' || t.subject);
end $$;

create or replace function public.set_ticket_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if p_status not in ('open', 'assigned', 'in_progress', 'waiting_for_customer', 'escalated', 'resolved', 'closed') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_id for update;
  if not found or not public.is_support_agent() then raise exception 'Ticket not found, or you are not Customer Service staff.' using errcode = '42501'; end if;
  if not (public.is_support_lead() or t.assignee_id = auth.uid() or t.assignee_id is null) then raise exception 'This ticket is assigned to someone else.' using errcode = '42501'; end if;
  if p_status = 'escalated' then raise exception 'Use Escalate to send a ticket to a technical department.' using errcode = '23514'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set status = p_status, resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end,
         assignee_id = case when assignee_id is null and p_status in ('in_progress', 'waiting_for_customer') then auth.uid() else assignee_id end where id = p_id;
  perform set_config('ctf.support_rpc', 'off', true);
  perform public.support_note(p_id, 'Status set to ' || replace(p_status, '_', ' ') || '.', 'internal', 'system', auth.uid());
end $$;

create or replace function public.reply_to_ticket(p_id uuid, p_body text, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if p_visibility not in ('public', 'internal') then raise exception 'Visibility must be public or internal.' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_id for update;
  if not found or not public.can_see_ticket(p_id) then raise exception 'Ticket not found.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write something first.' using errcode = '23514'; end if;
  -- the technical team a ticket was escalated to may add INTERNAL notes; only Customer Service speaks to the customer
  if p_visibility = 'public' and not public.is_support_agent() then raise exception 'Only Customer Service can reply to the customer.' using errcode = '42501'; end if;
  perform public.support_note(p_id, btrim(p_body), p_visibility, 'agent', auth.uid());
  if p_visibility = 'public' then
    perform set_config('ctf.support_rpc', 'on', true);
    update public.support_tickets set first_response_at = coalesce(first_response_at, now()), status = case when status in ('open', 'assigned') then 'in_progress' else status end where id = p_id;
    perform set_config('ctf.support_rpc', 'off', true);
  end if;
end $$;

-- Technical problems go to the department that can fix them, as a Bug on that department's board, linked back to the ticket.
create or replace function public.escalate_ticket(p_id uuid, p_department_slug text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_dept uuid; v_rec uuid; v_sev text;
begin
  if p_department_slug not in ('frontend-development', 'backend-development', 'devops', 'cybersecurity') then raise exception 'Tickets can be escalated to a technical department only.' using errcode = '23514'; end if;
  select * into t from public.support_tickets where id = p_id for update;
  if not found or not public.is_support_agent() then raise exception 'Ticket not found, or you are not Customer Service staff.' using errcode = '42501'; end if;
  if not (public.is_support_lead() or t.assignee_id = auth.uid() or t.assignee_id is null) then raise exception 'This ticket is assigned to someone else.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Tell the technical team what you need from them.' using errcode = '23514'; end if;
  v_dept := public.department_id_by_slug(p_department_slug);
  v_sev := case t.priority when 'urgent' then 'Critical' when 'high' then 'High' when 'low' then 'Low' else 'Medium' end;
  insert into public.department_records (department_id, kind, title, stage, fields, created_by)
  values (v_dept, 'bug', t.ref || ': ' || t.subject, 'Reported', jsonb_build_object('severity', v_sev, 'area', 'Customer report ' || t.ref, 'steps', left(t.description, 2000), 'actual', left(p_note, 2000)), auth.uid())
  returning id into v_rec;
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set status = 'escalated', escalated_department_id = v_dept, escalated_record_id = v_rec where id = p_id returning * into t;
  perform set_config('ctf.support_rpc', 'off', true);
  perform public.support_note(p_id, 'Escalated to ' || p_department_slug || ': ' || btrim(p_note), 'internal', 'system', auth.uid());
  perform public.notify_support(public.fund_admins_of(v_dept), 'A customer issue was escalated to your team', t.ref || ': ' || t.subject);
end $$;

-- ── connected projects (Main Admin) ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.register_support_source(p_name text, p_key_hash text, p_key_prefix text, p_project uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public."current_role"() <> 'superadmin' then raise exception 'Only a Main Admin can connect a project.' using errcode = '42501'; end if;
  insert into public.support_sources (name, project_id, key_hash, key_prefix, created_by) values (btrim(p_name), p_project, p_key_hash, p_key_prefix, auth.uid()) returning id into v_id;
  return v_id;
end $$;
create or replace function public.set_support_source_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public."current_role"() <> 'superadmin' then raise exception 'Only a Main Admin can change a connected project.' using errcode = '42501'; end if;
  update public.support_sources set active = p_active where id = p_id;
end $$;

-- ── intake: called ONLY by the support-intake edge function, with the service role ──────────────────────────────────────────
create or replace function public.support_intake(p_key_hash text, p_external_ref text, p_customer_ref text, p_customer_name text, p_subject text, p_description text, p_category text, p_priority text)
returns table (ticket_ref text, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare s public.support_sources; t public.support_tickets; v_cat text := coalesce(nullif(p_category, ''), 'other'); v_pri text := coalesce(nullif(p_priority, ''), 'normal'); v_recent int;
begin
  select * into s from public.support_sources where key_hash = p_key_hash and active;
  if not found then raise exception 'Unknown or revoked project key.' using errcode = '28000'; end if;
  if p_external_ref is null or btrim(p_external_ref) = '' then raise exception 'external_ref is required so a retry cannot create a second ticket.' using errcode = '23514'; end if;
  select * into t from public.support_tickets where source_id = s.id and external_ref = p_external_ref;
  if found then return query select t.ref, true; return; end if;
  select count(*) into v_recent from public.support_tickets where source_id = s.id and created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'Too many tickets from this project. Try again in a minute.' using errcode = '54000'; end if;
  if v_cat not in ('bug', 'billing', 'account', 'how_to', 'feedback', 'other') then v_cat := 'other'; end if;
  if v_pri not in ('low', 'normal', 'high', 'urgent') then v_pri := 'normal'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  insert into public.support_tickets (source_id, external_ref, customer_ref, customer_name, subject, description, category, priority, due_at)
  values (s.id, p_external_ref, left(coalesce(p_customer_ref, ''), 200), left(coalesce(p_customer_name, ''), 120), p_subject, left(coalesce(p_description, ''), 8000), v_cat, v_pri, public.support_due_at(v_pri))
  returning * into t;
  perform set_config('ctf.support_rpc', 'off', true);
  update public.support_sources set last_used_at = now() where id = s.id;
  perform public.support_note(t.id, 'Reported through ' || s.name || '.', 'internal', 'system', null);
  perform public.notify_support(public.support_leads(), case when v_pri in ('high', 'urgent') then 'Urgent customer report' else 'New customer report' end, t.ref || ': ' || t.subject);
  return query select t.ref, false;
end $$;

-- What the customer is allowed to see: status and public replies. Internal notes can never come out of this function.
create or replace function public.support_ticket_public(p_key_hash text, p_external_ref text)
returns table (ticket_ref text, status text, subject text, created_at timestamptz, message_author text, message_body text, message_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.ref, t.status, t.subject, t.created_at, case when m.author_kind = 'agent' then 'Support' else 'You' end, m.body, m.created_at
    from public.support_sources s join public.support_tickets t on t.source_id = s.id and t.external_ref = p_external_ref
    left join public.support_messages m on m.ticket_id = t.id and m.visibility = 'public'
   where s.key_hash = p_key_hash and s.active order by m.created_at nulls first
$$;

create or replace function public.support_customer_reply(p_key_hash text, p_external_ref text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  select t2.* into t from public.support_sources s join public.support_tickets t2 on t2.source_id = s.id and t2.external_ref = p_external_ref where s.key_hash = p_key_hash and s.active;
  if not found then raise exception 'Ticket not found.' using errcode = 'P0002'; end if;
  perform public.support_note(t.id, left(btrim(p_body), 8000), 'public', 'customer', null);
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets set status = case when status in ('waiting_for_customer', 'resolved') then 'in_progress' else status end, resolved_at = case when status in ('resolved') then null else resolved_at end where id = t.id;
  perform set_config('ctf.support_rpc', 'off', true);
  perform public.notify_support(array[t.assignee_id], 'The customer replied', t.ref || ': ' || t.subject);
end $$;

create or replace function public.support_customer_rating(p_key_hash text, p_external_ref text, p_rating integer, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5.' using errcode = '22023'; end if;
  perform set_config('ctf.support_rpc', 'on', true);
  update public.support_tickets t set rating = p_rating, rating_note = left(p_note, 1000)
   from public.support_sources s where s.id = t.source_id and s.key_hash = p_key_hash and s.active and t.external_ref = p_external_ref and t.status in ('resolved', 'closed');
  perform set_config('ctf.support_rpc', 'off', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['create_support_ticket(jsonb)', 'assign_ticket(uuid, uuid)', 'set_ticket_status(uuid, text)', 'reply_to_ticket(uuid, text, text)', 'escalate_ticket(uuid, text, text)', 'register_support_source(text, text, text, uuid)', 'set_support_source_active(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['support_intake(text, text, text, text, text, text, text, text)', 'support_ticket_public(text, text)', 'support_customer_reply(text, text, text)', 'support_customer_rating(text, text, integer, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['support_note(uuid, text, text, text, uuid)', 'notify_support(uuid[], text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
