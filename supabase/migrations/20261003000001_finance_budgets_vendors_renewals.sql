-- Finance, part 2: budgets, vendors, refunds/chargebacks, recurring expenses (renewals), missing-receipt flags.
-- Same rules as fund requests: nobody writes these tables directly (no INSERT/UPDATE/DELETE privilege for the API roles); every change goes
-- through a function below that checks who is asking, and every change is written to an append-only log. Nothing here moves money.
--
-- Assumptions (change them by editing the functions, then tell the owner):
--  * Finance Manager (admin of the finance department) and the Main Admin manage budgets, vendors and refunds. A department admin manages
--    renewals for their own department.
--  * A request counts toward the budget period that contains its "required by" date, or, if it has none, the day it was submitted/created.
--  * Money in a budget is shown in four buckets and never blended: pending (in review), approved-but-unpaid, paid, reconciled; refunds and
--    chargebacks are shown separately and reduce what is spent. Rejected, cancelled, returned, failed and reversed requests count for nothing.
--  * A paid request with no receipt/invoice document in the finance-docs bucket is flagged after a 3-day grace period.

-- ── who may do what ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.can_manage_finance() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_finance_manager() or public."current_role"() = 'superadmin')
$$;
create or replace function public.can_view_finance() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_finance_member() or public."current_role"() = 'superadmin')
$$;
create or replace function public.is_company_staff() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public."current_role"() in ('superadmin', 'manager')
     or (public."current_role"() = 'worker' and exists (select 1 from public.worker_profiles wp where wp.user_id = auth.uid() and wp.status = 'active')))
$$;

-- ── append-only change log ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_change_log (
  id         uuid primary key default gen_random_uuid(),
  entity     text not null check (entity in ('budget', 'vendor', 'renewal', 'refund')),
  entity_id  uuid not null,
  action     text not null check (char_length(action) between 2 and 60),
  actor_id   uuid not null references public.profiles (id),
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists finance_change_log_entity_idx on public.finance_change_log (entity, entity_id, created_at);
create or replace function public.block_finance_record_changes() returns trigger language plpgsql as $$
begin raise exception 'Finance records are permanent and cannot be changed or deleted.' using errcode = '42501'; end $$;
drop trigger if exists finance_change_log_immutable on public.finance_change_log;
create trigger finance_change_log_immutable before update or delete on public.finance_change_log for each row execute function public.block_finance_record_changes();
create or replace function public.finance_log(p_entity text, p_id uuid, p_action text, p_detail jsonb default '{}') returns void language sql security definer set search_path = public as $$
  insert into public.finance_change_log (entity, entity_id, action, actor_id, detail) values (p_entity, p_id, p_action, auth.uid(), coalesce(p_detail, '{}'))
$$;

-- ── vendors ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  category   text check (category is null or category in ('domain', 'hosting', 'api_credits', 'cloud', 'software', 'equipment', 'training', 'marketing', 'contractor', 'other')),
  website    text check (website is null or (char_length(website) <= 300 and website ~* '^https://[^\s]+$')),
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_vendors_name on public.finance_vendors (lower(btrim(name)));

-- ── budgets ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_budgets (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id),             -- null = company-wide
  category      text check (category is null or category in ('domain', 'hosting', 'api_credits', 'cloud', 'software', 'equipment', 'training', 'marketing', 'contractor', 'other')),  -- null = every category
  period_kind   text not null check (period_kind in ('month', 'quarter', 'year')),
  period_start  date not null,
  amount        numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  currency      text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  note          text not null default '' check (char_length(note) <= 500),
  status        text not null default 'active' check (status in ('active', 'archived')),
  version       integer not null default 1,
  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (case period_kind when 'month' then extract(day from period_start) = 1
                          when 'quarter' then extract(day from period_start) = 1 and extract(month from period_start) in (1, 4, 7, 10)
                          else extract(day from period_start) = 1 and extract(month from period_start) = 1 end)
);
create unique index if not exists finance_budgets_one_per_scope on public.finance_budgets
  ((coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(category, '')), period_kind, period_start, currency) where status = 'active';

create or replace function public.finance_period_end(p_kind text, p_start date) returns date language sql immutable as $$
  select (p_start + case p_kind when 'month' then interval '1 month' when 'quarter' then interval '3 months' else interval '1 year' end)::date - 1
$$;

-- ── refunds and chargebacks ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_refunds (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.fund_requests (id),
  kind        text not null check (kind in ('refund', 'chargeback')),
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  reference   text not null check (char_length(btrim(reference)) between 3 and 120),
  received_on date not null check (received_on <= current_date + 1),
  note        text not null default '' check (char_length(note) <= 1000),
  recorded_by uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);
create unique index if not exists finance_refunds_reference on public.finance_refunds (lower(btrim(reference)));
create index if not exists finance_refunds_request_idx on public.finance_refunds (request_id);
drop trigger if exists finance_refunds_immutable on public.finance_refunds;
create trigger finance_refunds_immutable before update or delete on public.finance_refunds for each row execute function public.block_finance_record_changes();

-- ── renewals (recurring expenses) ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.finance_valid_remind_days(p int[]) returns boolean language sql immutable as $$
  select p is not null and cardinality(p) between 1 and 8 and not exists (select 1 from unnest(p) d where d is null or d < 0 or d > 365)
$$;
create table if not exists public.finance_renewals (
  id              uuid primary key default gen_random_uuid(),
  department_id   uuid not null references public.departments (id),
  title           text not null check (char_length(btrim(title)) between 3 and 140),
  category        text not null check (category in ('domain', 'hosting', 'api_credits', 'cloud', 'software', 'equipment', 'training', 'marketing', 'contractor', 'other')),
  vendor          text not null default '' check (char_length(vendor) <= 200),
  amount          numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  currency        text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  frequency       text not null check (frequency in ('monthly', 'quarterly', 'yearly')),
  next_due        date not null,
  critical        boolean not null default false,
  remind_days     integer[] not null default '{30,14,7,1}' check (public.finance_valid_remind_days(remind_days)),
  status          text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  notes           text not null default '' check (char_length(notes) <= 1000),
  last_request_id uuid references public.fund_requests (id),
  version         integer not null default 1,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists finance_renewals_due_idx on public.finance_renewals (status, next_due);
-- Which reminders have already gone out, so a reminder is sent once however often the job runs. bracket: days-before, -1 = overdue, -2 = escalation.
create table if not exists public.finance_renewal_reminders (
  renewal_id uuid not null references public.finance_renewals (id) on delete cascade,
  due_date   date not null,
  bracket    integer not null,
  sent_at    timestamptz not null default now(),
  primary key (renewal_id, due_date, bracket)
);

-- ── row security: read-only; no direct writes for anyone ────────────────────────────────────────────────────────────────
alter table public.finance_change_log enable row level security;
alter table public.finance_vendors enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_refunds enable row level security;
alter table public.finance_renewals enable row level security;
alter table public.finance_renewal_reminders enable row level security;
drop policy if exists "finance staff read the change log" on public.finance_change_log;
create policy "finance staff read the change log" on public.finance_change_log for select to authenticated using (public.can_view_finance());
drop policy if exists "staff read vendors" on public.finance_vendors;
create policy "staff read vendors" on public.finance_vendors for select to authenticated using (public.is_company_staff());
drop policy if exists "budgets visible to finance and the department's admins" on public.finance_budgets;
create policy "budgets visible to finance and the department's admins" on public.finance_budgets for select to authenticated
  using (public.can_view_finance() or (department_id is not null and public.is_department_admin(department_id)));
drop policy if exists "refunds visible with their request" on public.finance_refunds;
create policy "refunds visible with their request" on public.finance_refunds for select to authenticated using (public.can_see_fund_request(request_id));
drop policy if exists "renewals visible to finance and the owning department" on public.finance_renewals;
create policy "renewals visible to finance and the owning department" on public.finance_renewals for select to authenticated
  using (public.can_view_finance() or public.is_department_member(department_id));
revoke all on public.finance_change_log, public.finance_vendors, public.finance_budgets, public.finance_refunds, public.finance_renewals, public.finance_renewal_reminders from anon, authenticated;
grant select on public.finance_change_log, public.finance_vendors, public.finance_budgets, public.finance_refunds, public.finance_renewals to authenticated;

-- ── vendor, budget and refund functions ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.save_finance_vendor(p_id uuid, p_name text, p_category text default null, p_website text default null, p_status text default 'active') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can change vendors.' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.finance_vendors (name, category, website, status, created_by) values (btrim(p_name), nullif(p_category, ''), nullif(btrim(p_website), ''), coalesce(p_status, 'active'), auth.uid()) returning id into v_id;
    perform public.finance_log('vendor', v_id, 'created', jsonb_build_object('name', btrim(p_name)));
  else
    update public.finance_vendors set name = btrim(p_name), category = nullif(p_category, ''), website = nullif(btrim(p_website), ''), status = coalesce(p_status, status), updated_at = now() where id = v_id;
    if not found then raise exception 'That vendor does not exist.' using errcode = 'P0002'; end if;
    perform public.finance_log('vendor', v_id, 'updated', jsonb_build_object('name', btrim(p_name), 'status', p_status));
  end if;
  return v_id;
exception when unique_violation then raise exception 'A vendor with that name already exists.' using errcode = '23505';
end $$;

create or replace function public.save_finance_budget(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; o public.finance_budgets;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can set budgets.' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.finance_budgets (department_id, category, period_kind, period_start, amount, currency, note, created_by)
    values (nullif(p_data ->> 'department_id', '')::uuid, nullif(p_data ->> 'category', ''), p_data ->> 'period_kind', (p_data ->> 'period_start')::date, (p_data ->> 'amount')::numeric,
            coalesce(nullif(upper(p_data ->> 'currency'), ''), 'NGN'), coalesce(p_data ->> 'note', ''), auth.uid()) returning id into v_id;
    perform public.finance_log('budget', v_id, 'created', p_data);
  else
    select * into o from public.finance_budgets where id = v_id for update;
    if not found then raise exception 'That budget does not exist.' using errcode = 'P0002'; end if;
    if o.status = 'archived' then raise exception 'An archived budget cannot be changed. Create a new one.' using errcode = '42501'; end if;
    -- Only the amount and note change on an existing budget; its scope and period are what other records were measured against.
    update public.finance_budgets set amount = coalesce((p_data ->> 'amount')::numeric, amount), note = coalesce(p_data ->> 'note', note), version = version + 1, updated_at = now() where id = v_id;
    perform public.finance_log('budget', v_id, 'changed', jsonb_build_object('amount_before', o.amount, 'amount_after', coalesce((p_data ->> 'amount')::numeric, o.amount), 'version', o.version + 1));
  end if;
  return v_id;
exception when unique_violation then raise exception 'There is already an active budget for that department, category and period.' using errcode = '23505';
end $$;

create or replace function public.archive_finance_budget(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can archive budgets.' using errcode = '42501'; end if;
  update public.finance_budgets set status = 'archived', version = version + 1, updated_at = now() where id = p_id and status = 'active';
  if not found then raise exception 'That budget is not active.' using errcode = 'P0002'; end if;
  perform public.finance_log('budget', p_id, 'archived', jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
end $$;

create or replace function public.record_fund_refund(p_request uuid, p_kind text, p_amount numeric, p_reference text, p_received_on date, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.fund_requests; v_already numeric; v_id uuid;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can record a refund.' using errcode = '42501'; end if;
  select * into r from public.fund_requests where id = p_request for update;
  if not found then raise exception 'That request does not exist.' using errcode = 'P0002'; end if;
  if r.status not in ('paid', 'reconciled', 'reconciliation_required') then raise exception 'A refund can only be recorded against a request that was paid.' using errcode = '23514'; end if;
  select coalesce(sum(amount), 0) into v_already from public.finance_refunds where request_id = p_request;
  if v_already + p_amount > coalesce(r.amount_paid, r.amount) then raise exception 'Refunds cannot add up to more than was paid (already refunded %).', v_already using errcode = '23514'; end if;
  insert into public.finance_refunds (request_id, kind, amount, currency, reference, received_on, note, recorded_by)
  values (p_request, p_kind, p_amount, r.currency, btrim(p_reference), p_received_on, coalesce(p_note, ''), auth.uid()) returning id into v_id;
  perform public.finance_log('refund', v_id, p_kind || '_recorded', jsonb_build_object('request', r.ref, 'amount', p_amount));
  return v_id;
exception when unique_violation then raise exception 'That refund reference was already recorded.' using errcode = '23505';
end $$;

-- ── budget numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Internal: the buckets for one scope and window. Never callable from the API.
create or replace function public.finance_spend(p_department uuid, p_category text, p_from date, p_to date, p_currency text, p_exclude uuid default null)
returns table (pending numeric, approved_unpaid numeric, paid numeric, reconciled numeric, refunded numeric)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select r.* from public.fund_requests r
     where r.currency = p_currency and (p_exclude is null or r.id <> p_exclude)
       and (p_department is null or r.department_id = p_department) and (p_category is null or r.category = p_category)
       and coalesce(r.required_by, r.submitted_at::date, r.created_at::date) between p_from and p_to
  )
  select coalesce(sum(amount) filter (where status in ('finance_review', 'department_review', 'awaiting_super_admin')), 0),
         coalesce(sum(amount) filter (where status in ('approved', 'payment_processing', 'payment_failed')), 0),
         coalesce(sum(coalesce(amount_paid, amount)) filter (where status in ('paid', 'reconciliation_required')), 0),
         coalesce(sum(coalesce(amount_paid, amount)) filter (where status = 'reconciled'), 0),
         coalesce((select sum(f.amount) from public.finance_refunds f where f.request_id in (select id from scoped)), 0)
    from scoped
$$;
revoke all on function public.finance_spend(uuid, text, date, date, text, uuid) from public, anon, authenticated;

-- One budget plus its spend, as a row. Used by the budgets screen and the reviewer panel.
create or replace function public.list_budget_status(p_on date default current_date) returns table (
  budget_id uuid, department_id uuid, department_name text, category text, period_kind text, period_start date, period_end date, amount numeric, currency text, note text, version integer,
  pending numeric, approved_unpaid numeric, paid numeric, reconciled numeric, refunded numeric, spent numeric, committed numeric, remaining numeric)
language sql stable security definer set search_path = public as $$
  select b.id, b.department_id, d.name, b.category, b.period_kind, b.period_start, public.finance_period_end(b.period_kind, b.period_start), b.amount, b.currency, b.note, b.version,
         s.pending, s.approved_unpaid, s.paid, s.reconciled, s.refunded,
         s.paid + s.reconciled - s.refunded,
         s.approved_unpaid + s.paid + s.reconciled - s.refunded,
         b.amount - (s.approved_unpaid + s.paid + s.reconciled - s.refunded)
    from public.finance_budgets b
    left join public.departments d on d.id = b.department_id
    cross join lateral public.finance_spend(b.department_id, b.category, b.period_start, public.finance_period_end(b.period_kind, b.period_start), b.currency) s
   where b.status = 'active' and p_on between b.period_start and public.finance_period_end(b.period_kind, b.period_start)
     and (public.can_view_finance() or (b.department_id is not null and public.is_department_admin(b.department_id)))
   order by d.name nulls first, b.category nulls first, b.period_kind
$$;

-- What a reviewer needs at the Finance stage: for THIS request, every budget that covers it and what would be left if it were approved.
create or replace function public.budget_utilisation_for_request(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.fund_requests; v_date date; v_out jsonb := '[]'::jsonb; b record; s record; v_committed numeric;
begin
  select * into r from public.fund_requests where id = p_request;
  if not found then raise exception 'That request does not exist.' using errcode = 'P0002'; end if;
  if not (public.can_view_finance() or public.is_department_admin(r.department_id)) then raise exception 'Budget figures are for Finance reviewers and department admins.' using errcode = '42501'; end if;
  v_date := coalesce(r.required_by, r.submitted_at::date, r.created_at::date);
  for b in select * from public.finance_budgets x where x.status = 'active' and x.currency = r.currency
            and v_date between x.period_start and public.finance_period_end(x.period_kind, x.period_start)
            and (x.department_id is null or x.department_id = r.department_id) and (x.category is null or x.category = r.category)
            order by (x.department_id is null), (x.category is null)
  loop
    select * into s from public.finance_spend(b.department_id, b.category, b.period_start, public.finance_period_end(b.period_kind, b.period_start), b.currency, r.id);
    v_committed := s.approved_unpaid + s.paid + s.reconciled - s.refunded;
    v_out := v_out || jsonb_build_object(
      'budget_id', b.id, 'scope', case when b.department_id is not null and b.category is not null then 'department_category' when b.department_id is not null then 'department' when b.category is not null then 'category' else 'company' end,
      'period_kind', b.period_kind, 'period_start', b.period_start, 'period_end', public.finance_period_end(b.period_kind, b.period_start),
      'amount', b.amount, 'currency', b.currency, 'pending', s.pending, 'approved_unpaid', s.approved_unpaid, 'paid', s.paid, 'reconciled', s.reconciled, 'refunded', s.refunded,
      'this_request', r.amount, 'remaining_after', b.amount - v_committed - r.amount, 'over_budget', (v_committed + r.amount) > b.amount);
  end loop;
  return v_out;
end $$;

-- ── renewals ────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.save_finance_renewal(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; o public.finance_renewals; v_dept uuid; v_remind int[];
begin
  v_remind := case when p_data ? 'remind_days' then array(select jsonb_array_elements_text(p_data -> 'remind_days')::int order by 1 desc) else null end;
  if v_id is null then
    v_dept := (p_data ->> 'department_id')::uuid;
    if v_dept is null or not exists (select 1 from public.departments where id = v_dept) then raise exception 'Choose the department that owns this renewal.' using errcode = '23514'; end if;
    if not (public.can_manage_finance() or public.is_department_admin(v_dept)) then raise exception 'Only the Finance Manager, the Main Admin or that department''s admin can add a renewal.' using errcode = '42501'; end if;
    insert into public.finance_renewals (department_id, title, category, vendor, amount, currency, frequency, next_due, critical, remind_days, notes, created_by)
    values (v_dept, coalesce(p_data ->> 'title', ''), p_data ->> 'category', coalesce(p_data ->> 'vendor', ''), (p_data ->> 'amount')::numeric, coalesce(nullif(upper(p_data ->> 'currency'), ''), 'NGN'),
            p_data ->> 'frequency', (p_data ->> 'next_due')::date, coalesce((p_data ->> 'critical')::boolean, false), coalesce(v_remind, '{30,14,7,1}'), coalesce(p_data ->> 'notes', ''), auth.uid()) returning id into v_id;
    perform public.finance_log('renewal', v_id, 'created', jsonb_build_object('title', p_data ->> 'title'));
  else
    select * into o from public.finance_renewals where id = v_id for update;
    if not found then raise exception 'That renewal does not exist.' using errcode = 'P0002'; end if;
    if not (public.can_manage_finance() or public.is_department_admin(o.department_id)) then raise exception 'Only the Finance Manager, the Main Admin or that department''s admin can change a renewal.' using errcode = '42501'; end if;
    update public.finance_renewals set title = coalesce(p_data ->> 'title', title), category = coalesce(p_data ->> 'category', category), vendor = coalesce(p_data ->> 'vendor', vendor),
           amount = coalesce((p_data ->> 'amount')::numeric, amount), frequency = coalesce(p_data ->> 'frequency', frequency), critical = coalesce((p_data ->> 'critical')::boolean, critical),
           remind_days = coalesce(v_remind, remind_days), notes = coalesce(p_data ->> 'notes', notes), version = version + 1, updated_at = now() where id = v_id;
    perform public.finance_log('renewal', v_id, 'changed', jsonb_build_object('amount_before', o.amount, 'amount_after', coalesce((p_data ->> 'amount')::numeric, o.amount), 'version', o.version + 1));
  end if;
  return v_id;
end $$;

create or replace function public.set_finance_renewal_status(p_id uuid, p_status text, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare o public.finance_renewals;
begin
  if p_status not in ('active', 'paused', 'cancelled') then raise exception 'Unknown status.' using errcode = '23514'; end if;
  select * into o from public.finance_renewals where id = p_id for update;
  if not found then raise exception 'That renewal does not exist.' using errcode = 'P0002'; end if;
  if not (public.can_manage_finance() or public.is_department_admin(o.department_id)) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if o.status = 'cancelled' then raise exception 'A cancelled renewal stays cancelled. Add a new one.' using errcode = '23514'; end if;
  update public.finance_renewals set status = p_status, version = version + 1, updated_at = now() where id = p_id;
  perform public.finance_log('renewal', p_id, 'status_' || p_status, jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
end $$;

-- After the renewal was paid, move it to its next cycle. Deliberate and logged; nothing advances on its own.
create or replace function public.mark_finance_renewal_renewed(p_id uuid, p_next_due date) returns void
language plpgsql security definer set search_path = public as $$
declare o public.finance_renewals;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can mark a renewal as renewed.' using errcode = '42501'; end if;
  select * into o from public.finance_renewals where id = p_id for update;
  if not found then raise exception 'That renewal does not exist.' using errcode = 'P0002'; end if;
  if o.status <> 'active' then raise exception 'Only an active renewal can be renewed.' using errcode = '23514'; end if;
  if p_next_due is null or p_next_due <= o.next_due or p_next_due > o.next_due + 400 then raise exception 'The next due date must be later than the current one (and within about a year of it).' using errcode = '23514'; end if;
  update public.finance_renewals set next_due = p_next_due, last_request_id = null, version = version + 1, updated_at = now() where id = p_id;
  perform public.finance_log('renewal', p_id, 'renewed', jsonb_build_object('due_before', o.next_due, 'due_after', p_next_due));
end $$;

-- "Create a fund request from this renewal." Never pays anything: it makes an ordinary request that still goes through every approval.
-- Calling it twice for the same due date returns the same request.
create or replace function public.create_fund_request_from_renewal(p_id uuid, p_submit boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.finance_renewals; v_req uuid;
begin
  select * into o from public.finance_renewals where id = p_id;
  if not found or not (public.can_view_finance() or public.is_department_member(o.department_id)) then raise exception 'That renewal does not exist.' using errcode = 'P0002'; end if;
  if o.status <> 'active' then raise exception 'Only an active renewal can be turned into a request.' using errcode = '23514'; end if;
  v_req := public.create_fund_request(jsonb_build_object('department_id', o.department_id, 'category', o.category, 'title', 'Renewal: ' || o.title,
             'description', 'Recurring expense (' || o.frequency || '), due ' || o.next_due::text || '.' || case when o.notes <> '' then ' ' || o.notes else '' end,
             'justification', 'Scheduled renewal.' || case when o.critical then ' Marked critical: service stops if it lapses.' else '' end,
             'amount', o.amount, 'currency', o.currency, 'vendor', o.vendor, 'required_by', o.next_due, 'recurrence', o.frequency),
           p_submit, 'renewal:' || o.id::text || ':' || o.next_due::text);
  update public.finance_renewals set last_request_id = v_req, updated_at = now() where id = p_id;
  perform public.finance_log('renewal', p_id, 'request_created', jsonb_build_object('due', o.next_due));
  return v_req;
end $$;

-- Reminders. Safe to run as often as you like: each reminder is recorded and goes out once. Run it daily (see the update notes) or let Finance
-- press the button on the Renewals tab. Messages carry no amounts.
create or replace function public.send_due_renewal_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare o record; v_days integer; v_sent integer := 0; v_new integer; v_who uuid[]; v_late uuid[]; v_fin uuid[]; v_open boolean;
begin
  if auth.uid() is not null and not public.can_view_finance() then raise exception 'Only Finance can run renewal reminders.' using errcode = '42501'; end if;
  select coalesce(array_agg(wd.user_id), '{}') into v_fin from public.worker_departments wd join public.worker_profiles wp on wp.user_id = wd.user_id
   where wd.department_id = public.department_id_by_slug('finance') and wp.status = 'active';
  for o in select * from public.finance_renewals where status = 'active' loop
    v_days := o.next_due - current_date;
    v_who := public.fund_admins_of(o.department_id) || v_fin || public.main_admins() || array[o.created_by];
    -- scheduled reminders: every bracket that has been reached and not yet sent goes at once, as ONE message
    with reached as (select d from unnest(o.remind_days) d where v_days >= 0 and v_days <= d),
         ins as (insert into public.finance_renewal_reminders (renewal_id, due_date, bracket) select o.id, o.next_due, d from reached on conflict do nothing returning 1)
    select count(*) into v_new from ins;
    if v_new > 0 then
      perform public.notify_fund(v_who, case when v_days <= 1 then 'Renewal due ' || case v_days when 0 then 'today' else 'tomorrow' end else 'Renewal due in ' || v_days || ' days' end,
                                 o.title || ' renews on ' || o.next_due::text || '. Open Finance → Renewals to raise the request.');
      v_sent := v_sent + 1;
    end if;
    -- overdue: once
    if v_days < 0 then
      insert into public.finance_renewal_reminders (renewal_id, due_date, bracket) values (o.id, o.next_due, -1) on conflict do nothing;
      if found then perform public.notify_fund(v_who, 'Renewal overdue', o.title || ' was due on ' || o.next_due::text || ' and has not been marked as renewed.'); v_sent := v_sent + 1; end if;
    end if;
    -- critical and not on its way to being paid: escalate to the Main Admins and Finance once, 3 days out or later
    if o.critical and v_days <= 3 then
      select exists (select 1 from public.fund_requests q where q.id = o.last_request_id and q.status in ('approved', 'payment_processing', 'paid', 'reconciled')) into v_open;
      if not v_open then
        insert into public.finance_renewal_reminders (renewal_id, due_date, bracket) values (o.id, o.next_due, -2) on conflict do nothing;
        if found then perform public.notify_fund(public.main_admins() || v_fin, 'Critical renewal needs attention', o.title || ' is ' || case when v_days < 0 then 'overdue' else 'due within 3 days' end || ' and is not approved yet.'); v_sent := v_sent + 1; end if;
      end if;
    end if;
  end loop;
  return v_sent;
end $$;

-- ── missing receipts ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.list_missing_receipts(p_grace_days integer default 3) returns table (
  request_id uuid, ref text, title text, department_name text, amount_paid numeric, currency text, paid_on date, days_open integer)
language sql stable security definer set search_path = public as $$
  select r.id, r.ref, r.title, d.name, coalesce(r.amount_paid, r.amount), r.currency, r.paid_on, current_date - r.paid_on
    from public.fund_requests r join public.departments d on d.id = r.department_id
   where public.can_view_finance() and r.status in ('paid', 'reconciled', 'reconciliation_required') and r.paid_on is not null and r.paid_on <= current_date - greatest(p_grace_days, 0)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'finance-docs' and public.uuid_from_path_segment(o.name, 1) = r.id)
   order by r.paid_on
   limit 500
$$;

-- ── who may call what ───────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.finance_log(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.can_manage_finance(), public.can_view_finance(), public.is_company_staff() from public, anon;
grant execute on function public.can_manage_finance(), public.can_view_finance(), public.is_company_staff() to authenticated;
revoke all on function public.save_finance_vendor(uuid, text, text, text, text), public.save_finance_budget(uuid, jsonb), public.archive_finance_budget(uuid, text),
  public.record_fund_refund(uuid, text, numeric, text, date, text), public.list_budget_status(date), public.budget_utilisation_for_request(uuid),
  public.save_finance_renewal(uuid, jsonb), public.set_finance_renewal_status(uuid, text, text), public.mark_finance_renewal_renewed(uuid, date),
  public.create_fund_request_from_renewal(uuid, boolean), public.list_missing_receipts(integer) from public, anon;
grant execute on function public.save_finance_vendor(uuid, text, text, text, text), public.save_finance_budget(uuid, jsonb), public.archive_finance_budget(uuid, text),
  public.record_fund_refund(uuid, text, numeric, text, date, text), public.list_budget_status(date), public.budget_utilisation_for_request(uuid),
  public.save_finance_renewal(uuid, jsonb), public.set_finance_renewal_status(uuid, text, text), public.mark_finance_renewal_renewed(uuid, date),
  public.create_fund_request_from_renewal(uuid, boolean), public.list_missing_receipts(integer) to authenticated;
-- Reminders: Finance (signed in) or the scheduler (service role). Never a signed-out visitor.
revoke all on function public.send_due_renewal_reminders() from public, anon;
grant execute on function public.send_due_renewal_reminders() to authenticated, service_role;
