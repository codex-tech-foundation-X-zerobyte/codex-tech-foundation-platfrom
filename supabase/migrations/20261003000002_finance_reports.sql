-- Finance, part 3: Codex's own income, and reports generated from recorded data (never from client payment volume).
-- Same rules as the rest of Finance: no direct writes, every change goes through a checked function and is logged, records are permanent.
--
-- What "income" means here: money Codex Tech Foundation itself earns (fees for its own work, retainers, its own product sales, grants).
-- It is recorded by hand by the Finance Manager or the Main Admin. Money that merely passes through Codex for a client, and any client
-- project's own payment volume, is NOT income and has no place in these tables.

alter table public.finance_change_log drop constraint if exists finance_change_log_entity_check;
alter table public.finance_change_log add constraint finance_change_log_entity_check check (entity in ('budget', 'vendor', 'renewal', 'refund', 'income', 'report'));

create table if not exists public.finance_income (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('income', 'reversal')),
  reversal_of uuid references public.finance_income (id),
  source      text not null check (source in ('client_work_fee', 'retainer', 'product_sale', 'grant', 'other')),
  amount      numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  reference   text not null check (char_length(btrim(reference)) between 3 and 120),
  received_on date not null check (received_on <= current_date + 1),
  description text not null default '' check (char_length(description) <= 1000),
  recorded_by uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  check ((kind = 'reversal') = (reversal_of is not null))
);
create unique index if not exists finance_income_reference on public.finance_income (lower(btrim(reference)));
create index if not exists finance_income_received_idx on public.finance_income (received_on);
drop trigger if exists finance_income_immutable on public.finance_income;
create trigger finance_income_immutable before update or delete on public.finance_income for each row execute function public.block_finance_record_changes();
alter table public.finance_income enable row level security;
drop policy if exists "finance staff read income" on public.finance_income;
create policy "finance staff read income" on public.finance_income for select to authenticated using (public.can_view_finance());
revoke all on public.finance_income from anon, authenticated;
grant select on public.finance_income to authenticated;

create or replace function public.record_finance_income(p_amount numeric, p_currency text, p_source text, p_reference text, p_received_on date, p_description text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can record income.' using errcode = '42501'; end if;
  insert into public.finance_income (kind, source, amount, currency, reference, received_on, description, recorded_by)
  values ('income', p_source, p_amount, upper(coalesce(nullif(btrim(p_currency), ''), 'NGN')), btrim(p_reference), p_received_on, coalesce(p_description, ''), auth.uid()) returning id into v_id;
  perform public.finance_log('income', v_id, 'recorded', jsonb_build_object('source', p_source, 'amount', p_amount));
  return v_id;
exception when unique_violation then raise exception 'That income reference was already recorded.' using errcode = '23505';
end $$;

-- A mistake is corrected by a reversal entry (money that came back out, or was recorded wrongly), never by editing or deleting.
create or replace function public.reverse_finance_income(p_id uuid, p_amount numeric, p_reference text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.finance_income; v_done numeric; v_id uuid;
begin
  if not public.can_manage_finance() then raise exception 'Only the Finance Manager or the Main Admin can reverse income.' using errcode = '42501'; end if;
  select * into o from public.finance_income where id = p_id for update;
  if not found or o.kind <> 'income' then raise exception 'That income entry does not exist.' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why it is being reversed.' using errcode = '23514'; end if;
  select coalesce(sum(amount), 0) into v_done from public.finance_income where reversal_of = p_id;
  if v_done + p_amount > o.amount then raise exception 'Reversals cannot add up to more than the income recorded (already reversed %).', v_done using errcode = '23514'; end if;
  insert into public.finance_income (kind, reversal_of, source, amount, currency, reference, received_on, description, recorded_by)
  values ('reversal', p_id, o.source, p_amount, o.currency, btrim(p_reference), current_date, left(btrim(p_reason), 1000), auth.uid()) returning id into v_id;
  perform public.finance_log('income', v_id, 'reversed', jsonb_build_object('of', p_id, 'amount', p_amount));
  return v_id;
exception when unique_violation then raise exception 'That reference was already recorded.' using errcode = '23505';
end $$;

-- ── report guard (internal) ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.finance_report_guard(p_from date, p_to date, p_currency text, p_department uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := upper(coalesce(nullif(btrim(p_currency), ''), 'NGN'));
begin
  if auth.uid() is null then raise exception 'Sign in to see reports.' using errcode = '42501'; end if;
  if not (public.can_view_finance() or (p_department is not null and public.is_department_admin(p_department))) then
    raise exception 'Reports are for Finance, and for a department''s admin about their own department.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a start date that is not after the end date.' using errcode = '23514'; end if;
  if p_to - p_from > 800 then raise exception 'A report can cover about two years at most.' using errcode = '23514'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Use a three-letter currency code.' using errcode = '23514'; end if;
  if p_department is not null and not exists (select 1 from public.departments where id = p_department) then raise exception 'That department does not exist.' using errcode = 'P0002'; end if;
  return v_cur;
end $$;
revoke all on function public.finance_report_guard(date, date, text, uuid) from public, anon, authenticated;

-- ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Two clearly separate views, never blended:
--   "submitted in the period": requested / approved, by the day a request was submitted
--   "money moved in the period": paid (by paid-on day), refunded (by received-on day), income (by received-on day)
-- plus "as of now" snapshots (pending, unpaid, discrepancies, missing receipts, renewals) that do not depend on the period.
create or replace function public.finance_report(p_from date, p_to date, p_currency text default 'NGN', p_department uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cur text := public.finance_report_guard(p_from, p_to, p_currency, p_department); v_out jsonb;
begin
  with lines as (
    select r.id, r.department_id, d.name as dept, r.category, coalesce(nullif(btrim(r.vendor), ''), '(none)') as vendor, r.project_id, pr.name as project,
           r.status, r.amount, r.amount_paid, r.paid_on, coalesce(r.submitted_at::date, r.created_at::date) as rd
      from public.fund_requests r join public.departments d on d.id = r.department_id left join public.projects pr on pr.id = r.project_id
     where r.currency = v_cur and (p_department is null or r.department_id = p_department)
  ), money as (
    select l.*,
      case when l.status <> 'draft' and l.rd between p_from and p_to then l.amount else 0 end as requested,
      case when l.rd between p_from and p_to and l.status in ('approved', 'payment_processing', 'payment_failed', 'paid', 'reconciled', 'reconciliation_required', 'payment_reversed') then l.amount else 0 end as approved,
      case when l.status in ('paid', 'reconciliation_required', 'reconciled') and l.paid_on between p_from and p_to then coalesce(l.amount_paid, l.amount) else 0 end as paid,
      coalesce((select sum(f.amount) from public.finance_refunds f where f.request_id = l.id and f.received_on between p_from and p_to), 0) as refunded
      from lines l
  ), live as (select * from money where requested <> 0 or approved <> 0 or paid <> 0 or refunded <> 0),
  inc as (select * from public.finance_income i where p_department is null and i.currency = v_cur and i.received_on between p_from and p_to)
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'currency', v_cur, 'department_id', p_department,
        'scope', case when p_department is null then 'company' else 'department' end,
        'generated_at', now(), 'generated_by', (select display_name from public.profiles where id = auth.uid()),
        'basis', jsonb_build_array(
          'Requests submitted in the period: requested and approved amounts, by the day each request was submitted. Drafts are not counted.',
          'Money moved in the period: payments by the day they were paid, refunds and chargebacks by the day they were received, income by the day it was received.',
          'Pending, unpaid, discrepancy, missing-receipt and renewal figures are as of the moment the report was generated, not for the period.',
          'Income is only money Codex itself earned and recorded. Money handled for clients is never counted.',
          'Everything is in one currency; nothing is converted.')),
    'submitted', jsonb_build_object('requested', coalesce((select sum(requested) from live), 0), 'approved', coalesce((select sum(approved) from live), 0)),
    'moved', jsonb_build_object('paid', coalesce((select sum(paid) from live), 0), 'refunded', coalesce((select sum(refunded) from live), 0),
        'net_spend', coalesce((select sum(paid) - sum(refunded) from live), 0),
        'income', case when p_department is null then coalesce((select sum(case when kind = 'income' then amount else -amount end) from inc), 0) end,
        'net_position', case when p_department is null then coalesce((select sum(case when kind = 'income' then amount else -amount end) from inc), 0) - coalesce((select sum(paid) - sum(refunded) from live), 0) end),
    'income_by_source', case when p_department is null then (select coalesce(jsonb_agg(jsonb_build_object('source', s, 'amount', a) order by a desc), '[]') from (select source s, sum(case when kind = 'income' then amount else -amount end) a from inc group by source) q) end,
    'pending_approvals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from lines where status in ('finance_review', 'department_review', 'awaiting_super_admin')),
    'approved_unpaid', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from lines where status in ('approved', 'payment_processing', 'payment_failed')),
    'discrepancies', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(abs(coalesce(amount_paid, amount) - amount)), 0)) from lines
                       where status = 'reconciliation_required' or (status in ('paid', 'reconciled') and amount_paid is not null and amount_paid <> amount)),
    'missing_receipts', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(coalesce(amount_paid, amount)), 0)) from lines l
                          where l.status in ('paid', 'reconciled', 'reconciliation_required') and l.paid_on <= current_date - 3
                            and not exists (select 1 from storage.objects o where o.bucket_id = 'finance-docs' and public.uuid_from_path_segment(o.name, 1) = l.id)),
    'renewals', (select jsonb_build_object('due_within_30_days', count(*) filter (where next_due between current_date and current_date + 30), 'amount_due_within_30_days', coalesce(sum(amount) filter (where next_due between current_date and current_date + 30), 0),
                                           'overdue', count(*) filter (where next_due < current_date)) from public.finance_renewals
                  where status = 'active' and currency = v_cur and (p_department is null or department_id = p_department)),
    'by_department', (select coalesce(jsonb_agg(g order by (g ->> 'net')::numeric desc), '[]') from (select jsonb_build_object('key', department_id::text, 'label', dept, 'requested', sum(requested), 'approved', sum(approved), 'paid', sum(paid), 'refunded', sum(refunded), 'net', sum(paid) - sum(refunded)) g from live group by department_id, dept) x),
    'by_category',   (select coalesce(jsonb_agg(g order by (g ->> 'net')::numeric desc), '[]') from (select jsonb_build_object('key', category, 'label', category, 'requested', sum(requested), 'approved', sum(approved), 'paid', sum(paid), 'refunded', sum(refunded), 'net', sum(paid) - sum(refunded)) g from live group by category) x),
    'by_vendor',     (select coalesce(jsonb_agg(g order by (g ->> 'net')::numeric desc), '[]') from (select jsonb_build_object('key', lower(vendor), 'label', min(vendor), 'requested', sum(requested), 'approved', sum(approved), 'paid', sum(paid), 'refunded', sum(refunded), 'net', sum(paid) - sum(refunded)) g from live group by lower(vendor)) x),
    'by_project',    (select coalesce(jsonb_agg(g order by (g ->> 'net')::numeric desc), '[]') from (select jsonb_build_object('key', coalesce(project_id::text, ''), 'label', coalesce(project, '(no project)'), 'requested', sum(requested), 'approved', sum(approved), 'paid', sum(paid), 'refunded', sum(refunded), 'net', sum(paid) - sum(refunded)) g from live group by project_id, project) x),
    'by_month', (select coalesce(jsonb_agg(m order by (m ->> 'month')), '[]') from (
        select jsonb_build_object('month', to_char(ms, 'YYYY-MM'),
          'paid', coalesce((select sum(coalesce(amount_paid, amount)) from lines where status in ('paid', 'reconciliation_required', 'reconciled') and paid_on between greatest(ms::date, p_from) and least((ms + interval '1 month - 1 day')::date, p_to)), 0),
          'refunded', coalesce((select sum(f.amount) from public.finance_refunds f join lines l on l.id = f.request_id where f.received_on between greatest(ms::date, p_from) and least((ms + interval '1 month - 1 day')::date, p_to)), 0),
          'income', case when p_department is null then coalesce((select sum(case when kind = 'income' then amount else -amount end) from inc where received_on between greatest(ms::date, p_from) and least((ms + interval '1 month - 1 day')::date, p_to)), 0) end) m
          from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') ms) y)
  ) into v_out;
  perform public.finance_log('report', coalesce(p_department, gen_random_uuid()), 'generated', jsonb_build_object('from', p_from, 'to', p_to, 'currency', v_cur, 'scope', case when p_department is null then 'company' else 'department' end));
  return v_out;
end $$;

-- One line per request that took part in the period, for the CSV and for audit.
create or replace function public.finance_report_rows(p_from date, p_to date, p_currency text default 'NGN', p_department uuid default null) returns table (
  ref text, title text, department text, category text, vendor text, project text, requester text, status text, amount numeric, amount_paid numeric, refunded numeric, currency text,
  submitted_on date, paid_on date, payment_reference text, has_receipt boolean, discrepancy boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := public.finance_report_guard(p_from, p_to, p_currency, p_department);
begin
  return query
  select r.ref, r.title, d.name, r.category, r.vendor, pr.name, p.display_name, r.status, r.amount, r.amount_paid,
         coalesce((select sum(f.amount) from public.finance_refunds f where f.request_id = r.id), 0), r.currency,
         coalesce(r.submitted_at::date, r.created_at::date), r.paid_on, r.payment_reference,
         exists (select 1 from storage.objects o where o.bucket_id = 'finance-docs' and public.uuid_from_path_segment(o.name, 1) = r.id),
         (r.status = 'reconciliation_required' or (r.status in ('paid', 'reconciled') and r.amount_paid is not null and r.amount_paid <> r.amount))
    from public.fund_requests r join public.departments d on d.id = r.department_id left join public.projects pr on pr.id = r.project_id left join public.profiles p on p.id = r.requester_id
   where r.currency = v_cur and (p_department is null or r.department_id = p_department)
     and ((r.status <> 'draft' and coalesce(r.submitted_at::date, r.created_at::date) between p_from and p_to)
          or r.paid_on between p_from and p_to
          or exists (select 1 from public.finance_refunds f where f.request_id = r.id and f.received_on between p_from and p_to))
   order by coalesce(r.paid_on, r.submitted_at::date, r.created_at::date), r.ref
   limit 5000;
end $$;

revoke all on function public.record_finance_income(numeric, text, text, text, date, text), public.reverse_finance_income(uuid, numeric, text, text),
  public.finance_report(date, date, text, uuid), public.finance_report_rows(date, date, text, uuid) from public, anon;
grant execute on function public.record_finance_income(numeric, text, text, text, date, text), public.reverse_finance_income(uuid, numeric, text, text),
  public.finance_report(date, date, text, uuid), public.finance_report_rows(date, date, text, uuid) to authenticated;
