-- Behavioural tests for 20261003000002: income and finance reports (all migrations applied; rolled back)
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','req@x'), ('00000000-0000-0000-0000-0000000000b2','feadmin@x'),
 ('00000000-0000-0000-0000-0000000000b3','finmgr@x'), ('00000000-0000-0000-0000-0000000000b4','finofficer@x'), ('00000000-0000-0000-0000-0000000000b5','other@x'),
 ('00000000-0000-0000-0000-0000000000b7','beadmin@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000b7');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-G0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-G0000002',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b3','CTF-WKR-G0000003',(select id from departments where slug='finance'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b4','CTF-WKR-G0000004',(select id from departments where slug='finance'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b5','CTF-WKR-G0000005',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b7','CTF-WKR-G0000007',(select id from departments where slug='backend-development'),'admin','active');

-- The local harness re-grants EXECUTE on every function after migrations run (real Supabase does not): re-apply so the revokes are under test.
\ir ../migrations/20261003000002_finance_reports.sql

create schema tst;
create function tst.as_user(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); end $$;
create function tst.expect_error(sql text, needle text, label text) returns void language plpgsql as $$ begin
  begin execute sql; raise exception 'FAIL % (no error raised)', label;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not ilike '%' || needle || '%' then raise exception 'FAIL % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS %', label; end; end $$;
create function tst.expect_true(cond boolean, label text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end $$;
create function tst.expect_count(sql text, want int, label text) returns void language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || sql || ') q' into n; if n <> want then raise exception 'FAIL % (expected %, got %)', label, want, n; end if; raise notice 'PASS %', label; end $$;
grant usage on schema tst to authenticated; grant execute on all functions in schema tst to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated; grant usage on schema storage to authenticated;
create temp table ids (k text primary key, v uuid); grant all on ids to authenticated;
create function tst.id(k text) returns uuid language sql as $$ select v from ids where k = $1 $$; grant execute on function tst.id(text) to authenticated;
-- Test fixture: a fund request in any state, built without moving through the approval chain (the chain itself is tested in fund_requests.test.sql).
create function tst.mkreq(p_user uuid, p_dept text, p_cat text, p_title text, p_amount numeric, p_cur text, p_status text, p_paid numeric default null, p_paid_days_ago int default null, p_submitted_days_ago int default 0, p_vendor text default '') returns uuid
language plpgsql security definer as $$
declare v_old text := current_setting('request.jwt.claim.sub', true); v_id uuid;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_id := public.create_fund_request(jsonb_build_object('department_id',(select id from departments where slug=p_dept),'category',p_cat,'title',p_title,'amount',p_amount,'currency',p_cur,'vendor',p_vendor,'required_by',current_date,'justification','test'), false, null);
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = p_status, submitted_at = now() - make_interval(days => p_submitted_days_ago), amount_paid = p_paid, paid_on = case when p_paid is null then null else current_date - coalesce(p_paid_days_ago, 0) end,
         payment_reference = case when p_paid is null then null else 'REF-' || p_title end where id = v_id;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old, ''), true);
  return v_id;
end $$;


-- ══ FIXTURES (all NGN unless noted; the report window is the last 30 days) ═══════════════════════════════════
insert into ids select 'A', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','A pending', 100000,'NGN','finance_review');
insert into ids select 'B', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','hosting','B approved', 200000,'NGN','approved', null, null, 0, 'Vercel');
insert into ids select 'C', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','C paid less', 300000,'NGN','paid', 250000, 5, 0, 'namecheap');
insert into ids select 'D', tst.mkreq('00000000-0000-0000-0000-0000000000b5','backend-development','api_credits','D reconciled', 50000,'NGN','reconciled', 50000, 8, 0, 'Namecheap');
insert into ids select 'E', tst.mkreq('00000000-0000-0000-0000-0000000000b5','backend-development','cloud','E rejected', 999999,'NGN','rejected');
insert into ids select 'F', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','F draft', 12345,'NGN','draft');
insert into ids select 'G', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','G dollars', 777777,'USD','approved');
insert into ids select 'H', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','H old', 400000,'NGN','paid', 400000, 60, 62);

set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select record_finance_income(500000, 'NGN', 'client_work_fee', 'INV-1', current_date)$$, 'Only the Finance Manager', 'a Finance Officer cannot record income');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select record_finance_income(500000, 'NGN', 'client_work_fee', 'INV-1', current_date)$$, 'Only the Finance Manager', 'a worker cannot record income');
select tst.expect_count($$select 1 from finance_income$$, 0, 'and cannot read it');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$insert into finance_income (kind, source, amount, currency, reference, received_on, recorded_by) values ('income','other',1,'NGN','DIRECT',current_date, auth.uid())$$, 'permission denied', 'income cannot be inserted directly');
insert into ids select 'i1', record_finance_income(500000, 'NGN', 'client_work_fee', 'INV-1', current_date, 'Fee for the Acme website');
insert into ids select 'i2', record_finance_income(200000, 'ngn', 'retainer', 'INV-2', current_date - 3);
insert into ids select 'i3', record_finance_income(90000, 'NGN', 'grant', 'GRANT-OLD', current_date - 100);
insert into ids select 'i4', record_finance_income(1000, 'USD', 'product_sale', 'USD-1', current_date);
select tst.expect_true((select currency from finance_income where id = tst.id('i2')) = 'NGN', 'currency codes are stored in capitals');
select tst.expect_error($$select record_finance_income(5, 'NGN', 'client_work_fee', 'inv-1', current_date)$$, 'already recorded', 'an income reference cannot be recorded twice');
select tst.expect_error($$select record_finance_income(5, 'NGN', 'lottery', 'INV-9', current_date)$$, 'check constraint', 'the source must be one of the known kinds');
select tst.expect_error($$select record_finance_income(0, 'NGN', 'other', 'INV-9', current_date)$$, 'check constraint', 'income must be above zero');
select tst.expect_error($$select record_finance_income(5, 'NGN', 'other', 'INV-9', current_date + 30)$$, 'check constraint', 'income cannot be dated in the future');
select tst.expect_error($$select reverse_finance_income(tst.id('i1'), 600000, 'REV-1', 'Wrong client')$$, 'more than the income', 'a reversal cannot exceed the income');
select tst.expect_error($$select reverse_finance_income(tst.id('i1'), 100, 'REV-1', '')$$, 'Say why', 'a reversal needs a reason');
insert into ids select 'rv', reverse_finance_income(tst.id('i1'), 50000, 'REV-1', 'Part of the fee was refunded to the client');
select tst.expect_error($$select reverse_finance_income(tst.id('rv'), 1, 'REV-2', 'again')$$, 'does not exist', 'a reversal cannot itself be reversed');
select tst.expect_error($$select reverse_finance_income(tst.id('i1'), 450001, 'REV-3', 'too much')$$, 'more than the income', 'reversals are summed against the original');
select tst.expect_error($$update finance_income set amount = 1$$, 'permission denied', 'income cannot be edited');
select tst.expect_error($$delete from finance_income$$, 'permission denied', 'or deleted');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_count($$select 1 from finance_income$$, 5, 'Finance staff can read the income records');
reset role;
select tst.expect_error($$update finance_income set amount = 1$$, 'permanent', 'income is permanent even for the database owner');

-- a refund on C (received today)
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select record_fund_refund(tst.id('C'), 'refund', 40000, 'RFD-C', current_date, '');
reset role;

-- ══ THE COMPANY REPORT ═══════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b4');
create temp table rep (j jsonb); grant all on rep to authenticated;
insert into rep select finance_report(current_date - 30, current_date, 'NGN', null);
select tst.expect_true((select j #>> '{meta,scope}' from rep) = 'company' and (select j #>> '{meta,currency}' from rep) = 'NGN', 'the report says what it covers');
select tst.expect_true((select (j #>> '{meta,generated_at}') is not null and (j #>> '{meta,generated_by}') is not null and jsonb_array_length(j #> '{meta,basis}') >= 4 from rep), 'and when it was made, by whom, and on what basis');
select tst.expect_true((select (j #>> '{submitted,requested}')::numeric from rep) = 1649999, 'requested = every submitted request in the period (drafts and other currencies and older ones left out)');
select tst.expect_true((select (j #>> '{submitted,approved}')::numeric from rep) = 550000, 'approved = requests that were approved (pending and rejected excluded)');
select tst.expect_true((select (j #>> '{moved,paid}')::numeric from rep) = 300000, 'paid uses what was actually paid, by the day it was paid (the 60-day-old payment is outside)');
select tst.expect_true((select (j #>> '{moved,refunded}')::numeric from rep) = 40000, 'refunded counts refunds received in the period');
select tst.expect_true((select (j #>> '{moved,net_spend}')::numeric from rep) = 260000, 'net spend = paid - refunded');
select tst.expect_true((select (j #>> '{moved,income}')::numeric from rep) = 650000, 'income = recorded income minus reversals, in the period and currency only (the 100-day-old grant and the USD sale are out)');
select tst.expect_true((select (j #>> '{moved,net_position}')::numeric from rep) = 390000, 'net position = income - net spend');
select tst.expect_true((select jsonb_array_length(j -> 'income_by_source') from rep) = 2 and (select (x ->> 'amount')::numeric from rep, jsonb_array_elements(j -> 'income_by_source') x where x ->> 'source' = 'client_work_fee') = 450000, 'income is split by source, net of the reversal');
select tst.expect_true((select (j #>> '{pending_approvals,count}')::int from rep) = 1 and (select (j #>> '{pending_approvals,amount}')::numeric from rep) = 100000, 'pending approvals (as of now)');
select tst.expect_true((select (j #>> '{approved_unpaid,count}')::int from rep) = 1 and (select (j #>> '{approved_unpaid,amount}')::numeric from rep) = 200000, 'approved but unpaid (as of now)');
select tst.expect_true((select (j #>> '{discrepancies,count}')::int from rep) = 1 and (select (j #>> '{discrepancies,amount}')::numeric from rep) = 50000, 'a payment that differs from the approval is a discrepancy');
select tst.expect_true((select (j #>> '{missing_receipts,count}')::int from rep) = 3, 'paid requests with no document, whatever their date (three here)');
select tst.expect_true((select (x ->> 'paid')::numeric from rep, jsonb_array_elements(j -> 'by_department') x where x ->> 'label' = 'Frontend Development') = 250000
   and (select (x ->> 'net')::numeric from rep, jsonb_array_elements(j -> 'by_department') x where x ->> 'label' = 'Frontend Development') = 210000
   and (select (x ->> 'requested')::numeric from rep, jsonb_array_elements(j -> 'by_department') x where x ->> 'label' = 'Backend Development') = 1049999, 'by department');
select tst.expect_true((select jsonb_array_length(j -> 'by_vendor') from rep) = 3 and (select (x ->> 'paid')::numeric from rep, jsonb_array_elements(j -> 'by_vendor') x where x ->> 'key' = 'namecheap') = 300000, 'by vendor (names are matched ignoring case and spaces; no vendor is its own line)');
select tst.expect_true((select (x ->> 'requested')::numeric from rep, jsonb_array_elements(j -> 'by_category') x where x ->> 'key' = 'domain') = 400000, 'by category');
select tst.expect_true((select jsonb_array_length(j -> 'by_project') from rep) = 1, 'by project (none of these belong to a project)');
select tst.expect_true((select sum((x ->> 'paid')::numeric) from rep, jsonb_array_elements(j -> 'by_month') x) = 300000 and (select sum((x ->> 'income')::numeric) from rep, jsonb_array_elements(j -> 'by_month') x) = 650000 and (select sum((x ->> 'refunded')::numeric) from rep, jsonb_array_elements(j -> 'by_month') x) = 40000, 'the months add up to the totals');
select tst.expect_true((select (j #>> '{renewals,overdue}')::int from (select finance_report(current_date - 30, current_date, 'NGN', null) j) q) = 0, 'renewals are included (none here)');
-- other currency and other windows
select tst.expect_true((select (finance_report(current_date - 30, current_date, 'USD', null) #>> '{submitted,requested}')::numeric) = 777777 and (select (finance_report(current_date - 30, current_date, 'USD', null) #>> '{moved,income}')::numeric) = 1000, 'a USD report shows only USD');
select tst.expect_true((select (finance_report(current_date - 90, current_date, 'NGN', null) #>> '{moved,paid}')::numeric) = 700000, 'a longer window picks up the older payment');
select tst.expect_true((select (finance_report(current_date - 200, current_date - 90, 'NGN', null) #>> '{moved,income}')::numeric) = 90000, 'and older income');
select tst.expect_error($$select finance_report(current_date, current_date - 1, 'NGN')$$, 'not after', 'the start cannot be after the end');
select tst.expect_error($$select finance_report(current_date - 900, current_date, 'NGN')$$, 'two years', 'a report cannot cover more than about two years');
select tst.expect_error($$select finance_report(current_date - 5, current_date, 'naira')$$, 'three-letter', 'the currency must be a code');
select tst.expect_true((select count(*) from finance_change_log where entity = 'report' and action = 'generated') >= 6, 'every report generated is logged (who, what period)');

-- ══ WHO MAY SEE WHICH REPORT ═════════════════════════════════════════════════════════════════════════════════
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$select finance_report(current_date - 30, current_date, 'NGN', null)$$, 'Reports are for Finance', 'a department admin cannot see the company report');
select tst.expect_error($$select finance_report(current_date - 30, current_date, 'NGN', (select id from departments where slug = 'backend-development'))$$, 'Reports are for Finance', 'nor another department''s report');
insert into rep select finance_report(current_date - 30, current_date, 'NGN', (select id from departments where slug = 'frontend-development'));
select tst.expect_true((select (j #>> '{meta,scope}') = 'department' and (j #>> '{submitted,requested}')::numeric = 600000 and (j #>> '{moved,paid}')::numeric = 250000 from rep offset 1 limit 1), 'a department admin sees their own department''s report');
select tst.expect_true((select (j #> '{moved,income}') = 'null'::jsonb and (j -> 'income_by_source') = 'null'::jsonb from rep offset 1 limit 1), 'which contains no company income');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select finance_report(current_date - 30, current_date, 'NGN', (select id from departments where slug = 'frontend-development'))$$, 'Reports are for Finance', 'a requester cannot');
select tst.expect_error($$select * from finance_report_rows(current_date - 30, current_date)$$, 'Reports are for Finance', 'nor download the lines');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_error($$select finance_report(current_date - 30, current_date, 'NGN')$$, 'Reports are for Finance', 'a client cannot');
reset role;
select tst.expect_true(not has_function_privilege('anon', 'public.finance_report(date,date,text,uuid)', 'execute') and not has_function_privilege('anon', 'public.finance_report_rows(date,date,text,uuid)', 'execute')
   and not has_function_privilege('anon', 'public.record_finance_income(numeric,text,text,text,date,text)', 'execute') and not has_function_privilege('authenticated', 'public.finance_report_guard(date,date,text,uuid)', 'execute'), 'a signed-out visitor can run none of it, and the guard is internal');
select tst.expect_true(not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'finance_income' and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert'))), 'the income table is closed to visitors and read-only for others');

-- ══ THE LINES BEHIND THE NUMBERS ═════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_count($$select 1 from finance_report_rows(current_date - 30, current_date)$$, 5, 'one line per request that took part in the period (A to E; the draft, USD and old ones are not)');
select tst.expect_true((select discrepancy and refunded = 40000 and not has_receipt and amount_paid = 250000 and vendor = 'namecheap' from finance_report_rows(current_date - 30, current_date) where ref = (select ref from fund_requests where id = tst.id('C'))), 'a line carries the paid amount, refunds, receipt and discrepancy flags');
select tst.expect_count($$select 1 from finance_report_rows(current_date - 90, current_date)$$, 6, 'a longer window adds the old payment');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'finance-docs', tst.id('C')::text || '/invoice.pdf', null;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_true((select has_receipt from finance_report_rows(current_date - 30, current_date) where ref = (select ref from fund_requests where id = tst.id('C'))), 'attaching a document shows on the line');
select tst.expect_true((select (finance_report(current_date - 30, current_date, 'NGN', null) #>> '{missing_receipts,count}')::int) = 2, 'and in the missing-receipt count');
reset role;

rollback;
