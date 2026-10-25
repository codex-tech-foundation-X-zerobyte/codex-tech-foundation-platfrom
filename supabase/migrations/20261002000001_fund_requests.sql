-- Fund requests: any worker can ask for money; it reaches the Main Admin only after Finance AND the requesting department's admin have
-- reviewed it. Approval is not payment: payment is recorded separately, with a transaction reference, and then reconciled.
--
-- Integrity rules, enforced by the database (not the UI):
--  * Nobody writes these tables directly. Every change goes through a function below, and a trigger refuses direct writes.
--  * A decision is bound to the exact VERSION of the request the reviewer saw. A request that changed since cannot be approved.
--  * Once approved, the request's material fields (amount, currency, vendor, ...) can never change. Change = a new request.
--  * Nobody reviews their own request. Each stage records who acted, when, and what they decided; those records are append-only.
--  * "Paid" needs a transaction reference (unique), and reconciliation is done by someone other than whoever recorded the payment.
--  * Financial history cannot be deleted.
-- Nothing here moves money. Executing transfers (Paystack) is a later, separately authorised step.

create sequence if not exists public.fund_request_seq;

create table if not exists public.fund_requests (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('FR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.fund_request_seq')::text, 5, '0')),
  requester_id    uuid not null references public.profiles (id),
  department_id   uuid not null references public.departments (id),
  category        text not null check (category in ('domain', 'hosting', 'api_credits', 'cloud', 'software', 'equipment', 'training', 'marketing', 'contractor', 'other')),
  title           text not null check (char_length(btrim(title)) between 3 and 140),
  description     text not null default '' check (char_length(description) <= 4000),
  justification   text not null default '' check (char_length(justification) <= 4000),
  amount          numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  currency        text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  vendor          text not null default '' check (char_length(vendor) <= 200),
  required_by     date,
  project_id      uuid references public.projects (id) on delete set null,
  recurrence      text not null default 'none' check (recurrence in ('none', 'monthly', 'quarterly', 'yearly')),
  status          text not null default 'draft' check (status in ('draft', 'finance_review', 'department_review', 'awaiting_super_admin', 'approved', 'payment_processing', 'paid', 'reconciled',
                                                                  'rejected', 'returned', 'payment_failed', 'payment_reversed', 'reconciliation_required', 'cancelled')),
  version         integer not null default 1,
  content_hash    text not null,
  idempotency_key text,
  submitted_at    timestamptz,
  decided_at      timestamptz,
  payment_reference   text,
  amount_paid         numeric(14, 2) check (amount_paid is null or amount_paid > 0),
  paid_on             date,
  payment_recorded_by uuid references public.profiles (id),
  payment_note        text,
  reconciled_by       uuid references public.profiles (id),
  reconciled_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists fund_requests_idem on public.fund_requests (requester_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists fund_requests_payment_ref on public.fund_requests (lower(payment_reference)) where payment_reference is not null;
create index if not exists fund_requests_status_idx on public.fund_requests (status, updated_at desc);
create index if not exists fund_requests_department_idx on public.fund_requests (department_id);
create index if not exists fund_requests_requester_idx on public.fund_requests (requester_id);

-- One row per stage action. Append-only: no updates, no deletes, for anyone.
create table if not exists public.fund_request_decisions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.fund_requests (id),
  version     integer not null,
  stage       text not null check (stage in ('requester', 'finance', 'department', 'super_admin', 'payment', 'reconciliation')),
  decision    text not null check (decision in ('submitted', 'approved', 'rejected', 'returned', 'cancelled', 'payment_started', 'paid', 'payment_failed', 'reconciled', 'discrepancy', 'reversed')),
  reason      text not null default '',
  actor_id    uuid not null references public.profiles (id),
  acted_as    text not null default 'role' check (acted_as in ('role', 'superadmin_fallback')),
  content_hash text not null,
  created_at  timestamptz not null default now()
);
create index if not exists fund_request_decisions_request_idx on public.fund_request_decisions (request_id, created_at);

create or replace function public.block_decision_changes() returns trigger language plpgsql as $$
begin raise exception 'Approval records are permanent and cannot be changed or deleted.' using errcode = '42501'; end $$;
drop trigger if exists fund_decisions_immutable on public.fund_request_decisions;
create trigger fund_decisions_immutable before update or delete on public.fund_request_decisions for each row execute function public.block_decision_changes();

create or replace function public.guard_fund_request() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Financial records cannot be deleted. Cancel the request instead.' using errcode = '42501'; end if;
  if current_setting('ctf.fund_rpc', true) is distinct from 'on' then
    raise exception 'Fund requests change only through the approval workflow.' using errcode = '42501';
  end if;
  -- Once approved, what was approved can never change (not even through the workflow).
  if old.status in ('approved', 'payment_processing', 'paid', 'reconciled', 'payment_failed', 'reconciliation_required', 'payment_reversed')
     and (new.content_hash, new.amount, new.currency, new.vendor, new.title, new.category, new.department_id, new.requester_id) is distinct from (old.content_hash, old.amount, old.currency, old.vendor, old.title, old.category, old.department_id, old.requester_id) then
    raise exception 'An approved request cannot be changed. Submit a new request for the change.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_fund_request on public.fund_requests;
create trigger guard_fund_request before update or delete on public.fund_requests for each row execute function public.guard_fund_request();
drop trigger if exists guard_fund_request_insert on public.fund_requests;
create or replace function public.guard_fund_request_insert() returns trigger language plpgsql as $$
begin
  if current_setting('ctf.fund_rpc', true) is distinct from 'on' then raise exception 'Fund requests are created only through the approval workflow.' using errcode = '42501'; end if;
  return new;
end $$;
create trigger guard_fund_request_insert before insert on public.fund_requests for each row execute function public.guard_fund_request_insert();

drop trigger if exists audit_fund_request_changes on public.fund_requests;
create trigger audit_fund_request_changes after update of status on public.fund_requests for each row when (old.status is distinct from new.status) execute function public.audit_row_change('fund_request.status_changed');

-- ── who is who ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_finance_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
                  where wd.user_id = auth.uid() and wp.status = 'active' and wd.department_id = public.department_id_by_slug('finance'))
$$;
create or replace function public.is_finance_manager() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_department_admin(public.department_id_by_slug('finance'))
$$;

create or replace function public.can_see_fund_request(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fund_requests r
     where r.id = p_request
       and (r.requester_id = auth.uid() or public."current_role"() = 'superadmin' or public.is_finance_member() or public.is_department_admin(r.department_id))
  )
$$;

-- May the current user act on this stage of this request? Nobody reviews their own request. If no other eligible reviewer exists for a
-- review stage (say, the only Finance Manager is the one asking), the Main Admin may cover it, and the record says so.
create or replace function public.fund_stage_actor(p_request uuid, p_stage text) returns text language plpgsql stable security definer set search_path = public as $$
declare r public.fund_requests; v_is_role boolean; v_other_exists boolean; v_dept uuid;
begin
  select * into r from public.fund_requests where id = p_request;
  if not found or auth.uid() is null or r.requester_id = auth.uid() and p_stage <> 'super_admin' then return null; end if;
  v_dept := case p_stage when 'finance' then public.department_id_by_slug('finance') when 'department' then r.department_id else null end;
  v_is_role := case p_stage
    when 'finance' then public.is_finance_manager()
    when 'department' then public.is_department_admin(r.department_id)
    when 'super_admin' then public."current_role"() = 'superadmin'
    when 'payment' then public.is_finance_manager() or public."current_role"() = 'superadmin'
    when 'reconciliation' then public.is_finance_manager() or public."current_role"() = 'superadmin'
    else false end;
  if v_is_role then return 'role'; end if;
  if p_stage in ('finance', 'department') and public."current_role"() = 'superadmin' then
    select exists (select 1 from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
                    where wd.department_id = v_dept and wd.department_role = 'admin' and wp.status = 'active' and wd.user_id <> r.requester_id) into v_other_exists;
    if not v_other_exists then return 'superadmin_fallback'; end if;
  end if;
  return null;
end $$;

-- ── row security: read-only for people who may see a request; nobody can write directly ────────────────────────────────
alter table public.fund_requests enable row level security;
alter table public.fund_request_decisions enable row level security;
drop policy if exists "fund requests visible to the people involved" on public.fund_requests;
create policy "fund requests visible to the people involved" on public.fund_requests for select to authenticated using (public.can_see_fund_request(id));
drop policy if exists "decisions visible with their request" on public.fund_request_decisions;
create policy "decisions visible with their request" on public.fund_request_decisions for select to authenticated using (public.can_see_fund_request(request_id));
revoke all on public.fund_requests, public.fund_request_decisions from anon, authenticated;
grant select on public.fund_requests, public.fund_request_decisions to authenticated;

-- ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fund_hash(p_department uuid, p_category text, p_title text, p_description text, p_amount numeric, p_currency text, p_vendor text, p_project uuid, p_recurrence text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(jsonb_build_array(p_department, p_category, btrim(p_title), btrim(p_description), p_amount::text, p_currency, btrim(p_vendor), p_project, p_recurrence)::text, 'UTF8')), 'hex')
$$;

create or replace function public.notify_fund(p_users uuid[], p_title text, p_body text) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, kind) select distinct u, p_title, p_body, 'fund_request' from unnest(p_users) as u where u is not null and u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
$$;

create or replace function public.fund_admins_of(p_department uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(wd.user_id), '{}') from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
   where wd.department_id = p_department and wd.department_role = 'admin' and wp.status = 'active'
$$;
create or replace function public.main_admins() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = 'superadmin'
$$;

create or replace function public.fund_log(p_request public.fund_requests, p_stage text, p_decision text, p_reason text, p_acted_as text default 'role') returns void
language sql security definer set search_path = public as $$
  insert into public.fund_request_decisions (request_id, version, stage, decision, reason, actor_id, acted_as, content_hash)
  values (p_request.id, p_request.version, p_stage, p_decision, coalesce(p_reason, ''), auth.uid(), p_acted_as, p_request.content_hash)
$$;

-- ── workflow functions ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.create_fund_request(p_data jsonb, p_submit boolean default false, p_idem text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_dept uuid := (p_data ->> 'department_id')::uuid; v_role text := coalesce(public."current_role"()::text, '');
begin
  if auth.uid() is null or v_role not in ('worker', 'manager', 'superadmin') then raise exception 'Only company staff can submit fund requests.' using errcode = '42501'; end if;
  if v_role = 'worker' and not exists (select 1 from public.worker_profiles where user_id = auth.uid() and status = 'active') then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_dept is null or not exists (select 1 from public.departments where id = v_dept) then raise exception 'Choose the department this is for.' using errcode = '23514'; end if;
  if v_role <> 'superadmin' and not public.is_department_member(v_dept) then raise exception 'You can only request funds for a department you belong to.' using errcode = '42501'; end if;
  if p_idem is not null then
    select id into v_id from public.fund_requests where requester_id = auth.uid() and idempotency_key = p_idem;
    if found then return v_id; end if;   -- a retry: same request, no duplicate
  end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  insert into public.fund_requests (requester_id, department_id, category, title, description, justification, amount, currency, vendor, required_by, project_id, recurrence, idempotency_key, content_hash)
  values (auth.uid(), v_dept, p_data ->> 'category', coalesce(p_data ->> 'title', ''), coalesce(p_data ->> 'description', ''), coalesce(p_data ->> 'justification', ''),
          (p_data ->> 'amount')::numeric, coalesce(nullif(upper(p_data ->> 'currency'), ''), 'NGN'), coalesce(p_data ->> 'vendor', ''), nullif(p_data ->> 'required_by', '')::date,
          nullif(p_data ->> 'project_id', '')::uuid, coalesce(nullif(p_data ->> 'recurrence', ''), 'none'), p_idem, 'pending')
  returning id into v_id;
  update public.fund_requests r set content_hash = public.fund_hash(r.department_id, r.category, r.title, r.description, r.amount, r.currency, r.vendor, r.project_id, r.recurrence) where r.id = v_id;
  perform set_config('ctf.fund_rpc', 'off', true);
  if p_submit then perform public.submit_fund_request(v_id); end if;
  return v_id;
end $$;

create or replace function public.update_fund_request(p_id uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found or r.requester_id <> auth.uid() then raise exception 'You can only edit your own request.' using errcode = '42501'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request is already in review and cannot be edited. Ask a reviewer to return it, or cancel it.' using errcode = '42501'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set
    category = coalesce(p_data ->> 'category', category), title = coalesce(p_data ->> 'title', title), description = coalesce(p_data ->> 'description', description),
    justification = coalesce(p_data ->> 'justification', justification), amount = coalesce((p_data ->> 'amount')::numeric, amount), currency = coalesce(nullif(upper(p_data ->> 'currency'), ''), currency),
    vendor = coalesce(p_data ->> 'vendor', vendor), required_by = case when p_data ? 'required_by' then nullif(p_data ->> 'required_by', '')::date else required_by end,
    project_id = case when p_data ? 'project_id' then nullif(p_data ->> 'project_id', '')::uuid else project_id end, recurrence = coalesce(p_data ->> 'recurrence', recurrence)
   where id = p_id;
  update public.fund_requests x set content_hash = public.fund_hash(x.department_id, x.category, x.title, x.description, x.amount, x.currency, x.vendor, x.project_id, x.recurrence) where x.id = p_id;
  perform set_config('ctf.fund_rpc', 'off', true);
end $$;

create or replace function public.submit_fund_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found or r.requester_id <> auth.uid() then raise exception 'You can only submit your own request.' using errcode = '42501'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request has already been submitted.' using errcode = '42501'; end if;
  if char_length(btrim(r.justification)) < 10 then raise exception 'Explain why this is needed (at least a sentence) before submitting.' using errcode = '23514'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'finance_review', submitted_at = now(), version = case when r.status = 'returned' then r.version + 1 else r.version end where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'requester', 'submitted', '');
  perform public.notify_fund(public.fund_admins_of(public.department_id_by_slug('finance')) || public.main_admins(), 'New fund request to review', r.ref || ': ' || r.title);
end $$;

create or replace function public.review_fund_request(p_id uuid, p_version integer, p_stage text, p_decision text, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests; v_actor text; v_next text; v_expected text;
begin
  if p_stage not in ('finance', 'department', 'super_admin') then raise exception 'Unknown review stage.' using errcode = '22023'; end if;
  if p_decision not in ('approved', 'rejected', 'returned') then raise exception 'Decision must be approved, rejected or returned.' using errcode = '22023'; end if;
  select * into r from public.fund_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  v_expected := case p_stage when 'finance' then 'finance_review' when 'department' then 'department_review' else 'awaiting_super_admin' end;
  if r.status <> v_expected then raise exception 'This request is not waiting for that review (it is %).', r.status using errcode = '42501'; end if;
  if r.version <> p_version then raise exception 'This request changed after you opened it. Reload and review the current version.' using errcode = '40001'; end if;
  v_actor := public.fund_stage_actor(p_id, p_stage);
  if v_actor is null then raise exception 'You cannot review this request at this stage (you may not review your own, or you do not hold this role).' using errcode = '42501'; end if;
  if p_decision <> 'approved' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason when you reject or return a request.' using errcode = '23514'; end if;
  v_next := case when p_decision = 'rejected' then 'rejected' when p_decision = 'returned' then 'returned'
                 else case p_stage when 'finance' then 'department_review' when 'department' then 'awaiting_super_admin' else 'approved' end end;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = v_next, decided_at = case when v_next in ('approved', 'rejected') then now() else decided_at end where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, p_stage, p_decision, p_reason, v_actor);
  perform public.notify_fund(
    case v_next when 'department_review' then public.fund_admins_of(r.department_id) when 'awaiting_super_admin' then public.main_admins()
                when 'approved' then array[r.requester_id] || public.fund_admins_of(public.department_id_by_slug('finance'))
                else array[r.requester_id] end,
    case v_next when 'department_review' then 'Fund request needs your review' when 'awaiting_super_admin' then 'Fund request awaiting your decision' when 'approved' then 'Fund request approved'
                when 'rejected' then 'Fund request rejected' else 'Fund request returned to you' end,
    r.ref || ': ' || r.title);
end $$;

create or replace function public.cancel_fund_request(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if not ((r.requester_id = auth.uid() and r.status in ('draft', 'finance_review', 'department_review', 'awaiting_super_admin', 'returned'))
       or (public."current_role"() = 'superadmin' and r.status in ('draft', 'finance_review', 'department_review', 'awaiting_super_admin', 'returned', 'approved', 'payment_failed'))) then
    raise exception 'This request can no longer be cancelled by you.' using errcode = '42501';
  end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'cancelled' where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'requester', 'cancelled', p_reason);
end $$;

-- Payment is recorded, never assumed. (Executing a transfer through Paystack is a later step.)
create or replace function public.begin_fund_payment(p_id uuid, p_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests; v_actor text;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status not in ('approved', 'payment_failed') then raise exception 'Only an approved request can be paid.' using errcode = '42501'; end if;
  if r.version <> p_version then raise exception 'This request changed after you opened it.' using errcode = '40001'; end if;
  v_actor := public.fund_stage_actor(p_id, 'payment');
  if v_actor is null then raise exception 'Only a Finance Manager (who did not make this request) or the Main Admin can start a payment.' using errcode = '42501'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'payment_processing' where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'payment', 'payment_started', '', 'role');
end $$;

create or replace function public.record_fund_payment(p_id uuid, p_reference text, p_amount_paid numeric, p_paid_on date, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'payment_processing' then raise exception 'Start the payment first. A request is never marked paid just because it was approved.' using errcode = '42501'; end if;
  if public.fund_stage_actor(p_id, 'payment') is null then raise exception 'Only a Finance Manager (who did not make this request) or the Main Admin can record a payment.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reference, ''))) < 4 then raise exception 'Enter the transaction reference from the bank or provider.' using errcode = '23514'; end if;
  if p_amount_paid is null or p_amount_paid <= 0 then raise exception 'Enter the amount actually paid.' using errcode = '23514'; end if;
  if exists (select 1 from public.fund_requests where lower(payment_reference) = lower(btrim(p_reference)) and id <> p_id) then raise exception 'That transaction reference is already recorded against another request.' using errcode = '23505'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'paid', payment_reference = btrim(p_reference), amount_paid = p_amount_paid, paid_on = coalesce(p_paid_on, current_date), payment_recorded_by = auth.uid(), payment_note = coalesce(p_note, '')
   where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'payment', 'paid', 'Ref ' || r.payment_reference || ', ' || r.amount_paid::text || ' ' || r.currency);
  perform public.notify_fund(array[r.requester_id], 'Payment recorded', r.ref || ': ' || r.title);
end $$;

create or replace function public.fail_fund_payment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found or r.status <> 'payment_processing' then raise exception 'There is no payment in progress for this request.' using errcode = '42501'; end if;
  if public.fund_stage_actor(p_id, 'payment') is null then raise exception 'You cannot record a payment outcome for this request.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say what went wrong.' using errcode = '23514'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'payment_failed' where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'payment', 'payment_failed', p_reason);
  perform public.notify_fund(public.main_admins() || array[r.requester_id], 'Payment failed', r.ref || ': ' || r.title);
end $$;

-- Reconciliation: compares what was paid with what was approved. A difference needs a written explanation before it can be closed.
create or replace function public.reconcile_fund_request(p_id uuid, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests; v_actor text;
begin
  select * into r from public.fund_requests where id = p_id for update;
  if not found or r.status not in ('paid', 'reconciliation_required') then raise exception 'Only a paid request can be reconciled.' using errcode = '42501'; end if;
  v_actor := public.fund_stage_actor(p_id, 'reconciliation');
  if v_actor is null then raise exception 'Only a Finance Manager (who did not make this request) or the Main Admin can reconcile.' using errcode = '42501'; end if;
  if r.payment_recorded_by = auth.uid() then raise exception 'Reconciliation must be done by someone other than the person who recorded the payment.' using errcode = '42501'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  if r.status = 'paid' and r.amount_paid is distinct from r.amount then
    update public.fund_requests set status = 'reconciliation_required' where id = p_id returning * into r;
    perform public.fund_log(r, 'reconciliation', 'discrepancy', 'Approved ' || r.amount::text || ', paid ' || r.amount_paid::text || ' ' || r.currency);
    perform public.notify_fund(public.main_admins(), 'Payment does not match the approval', r.ref || ': ' || r.title);
  else
    if r.status = 'reconciliation_required' and char_length(btrim(coalesce(p_note, ''))) < 5 then perform set_config('ctf.fund_rpc', 'off', true); raise exception 'Explain the difference between approved and paid before closing it.' using errcode = '23514'; end if;
    update public.fund_requests set status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now() where id = p_id returning * into r;
    perform public.fund_log(r, 'reconciliation', 'reconciled', p_note, v_actor);
  end if;
  perform set_config('ctf.fund_rpc', 'off', true);
end $$;

create or replace function public.reverse_fund_payment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests;
begin
  if public."current_role"() <> 'superadmin' then raise exception 'Only the Main Admin can reverse a recorded payment.' using errcode = '42501'; end if;
  select * into r from public.fund_requests where id = p_id for update;
  if not found or r.status not in ('paid', 'reconciled', 'reconciliation_required') then raise exception 'Only a recorded payment can be reversed.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Say why the payment is being reversed.' using errcode = '23514'; end if;
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = 'payment_reversed' where id = p_id returning * into r;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform public.fund_log(r, 'payment', 'reversed', p_reason);
end $$;

do $$ declare f text; begin
  foreach f in array array['create_fund_request(jsonb, boolean, text)', 'update_fund_request(uuid, jsonb)', 'submit_fund_request(uuid)', 'review_fund_request(uuid, integer, text, text, text)', 'cancel_fund_request(uuid, text)',
                           'begin_fund_payment(uuid, integer)', 'record_fund_payment(uuid, text, numeric, date, text)', 'fail_fund_payment(uuid, text)', 'reconcile_fund_request(uuid, text)', 'reverse_fund_payment(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers are not callable by signed-in users
  foreach f in array array['fund_log(public.fund_requests, text, text, text, text)', 'notify_fund(uuid[], text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- Transparency: what the company has approved and spent, visible to all active staff. Deliberately WITHOUT justification, vendor or requester.
create or replace function public.list_company_spending() returns table (ref text, title text, department_name text, category text, amount numeric, currency text, status text, decided_at timestamptz, paid_on date, amount_paid numeric)
language sql stable security definer set search_path = public as $$
  select r.ref, r.title, d.name, r.category, r.amount, r.currency, r.status, r.decided_at, r.paid_on, r.amount_paid
    from public.fund_requests r join public.departments d on d.id = r.department_id
   where r.status in ('approved', 'payment_processing', 'paid', 'reconciled', 'reconciliation_required', 'payment_failed')
     and (public."current_role"() in ('superadmin', 'manager') or exists (select 1 from public.worker_profiles wp where wp.user_id = auth.uid() and wp.status = 'active' and public."current_role"() = 'worker'))
   order by r.decided_at desc nulls last limit 500
$$;
revoke all on function public.list_company_spending() from public, anon; grant execute on function public.list_company_spending() to authenticated;

-- Supporting documents (quotes, invoices, receipts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('finance-docs', 'finance-docs', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public.can_attach_fund_doc(p_request uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fund_requests r where r.id = p_request and (
        (r.requester_id = auth.uid() and r.status in ('draft', 'returned'))
     or public.is_finance_manager() or public."current_role"() = 'superadmin'))
$$;
drop policy if exists "finance docs readable by the people involved" on storage.objects;
create policy "finance docs readable by the people involved" on storage.objects for select to authenticated using (bucket_id = 'finance-docs' and public.uuid_from_path_segment(name, 1) is not null and public.can_see_fund_request(public.uuid_from_path_segment(name, 1)));
drop policy if exists "finance docs added by requester or finance" on storage.objects;
create policy "finance docs added by requester or finance" on storage.objects for insert to authenticated with check (bucket_id = 'finance-docs' and public.uuid_from_path_segment(name, 1) is not null and public.can_attach_fund_doc(public.uuid_from_path_segment(name, 1)));
-- No delete policy on purpose: evidence stays.
