-- Behavioural tests for 20261003000001: budgets, vendors, refunds, renewals, missing receipts (all migrations applied; rolled back)
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
\ir ../migrations/20261003000001_finance_budgets_vendors_renewals.sql

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
create function tst.mkreq(p_user uuid, p_dept text, p_cat text, p_title text, p_amount numeric, p_cur text, p_status text, p_paid numeric default null, p_paid_days_ago int default null) returns uuid
language plpgsql security definer as $$
declare v_old text := current_setting('request.jwt.claim.sub', true); v_id uuid;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_id := public.create_fund_request(jsonb_build_object('department_id',(select id from departments where slug=p_dept),'category',p_cat,'title',p_title,'amount',p_amount,'currency',p_cur,'required_by',current_date,'justification','test'), false, null);
  perform set_config('ctf.fund_rpc', 'on', true);
  update public.fund_requests set status = p_status, submitted_at = now(), amount_paid = p_paid, paid_on = case when p_paid is null then null else current_date - coalesce(p_paid_days_ago, 0) end,
         payment_reference = case when p_paid is null then null else 'REF-' || p_title end where id = v_id;
  perform set_config('ctf.fund_rpc', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old, ''), true);
  return v_id;
end $$;

-- ══ NOBODY WRITES THESE TABLES DIRECTLY ══════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$insert into finance_vendors (name, created_by) values ('Direct', auth.uid())$$, 'permission denied', 'even the Finance Manager cannot insert a vendor directly');
select tst.expect_error($$insert into finance_budgets (period_kind, period_start, amount, created_by) values ('year', '2026-01-01', 1, auth.uid())$$, 'permission denied', 'nor a budget');
select tst.expect_error($$insert into finance_renewals (department_id, title, category, amount, frequency, next_due, created_by) select id, 'Direct', 'domain', 1, 'yearly', current_date, auth.uid() from departments limit 1$$, 'permission denied', 'nor a renewal');
select tst.expect_error($$insert into finance_change_log (entity, entity_id, action, actor_id) values ('budget', gen_random_uuid(), 'forged', auth.uid())$$, 'permission denied', 'nor a log entry');
select tst.expect_error($$select finance_log('budget', gen_random_uuid(), 'forged')$$, 'permission denied', 'the change-log writer is not callable from the API');
select tst.expect_error($$select * from finance_spend(null, null, current_date, current_date, 'NGN')$$, 'permission denied', 'the internal spend calculator is not callable from the API');
reset role;

-- ══ VENDORS ══════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select save_finance_vendor(null, 'Namecheap', 'domain')$$, 'Only the Finance Manager', 'a worker cannot add a vendor');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select save_finance_vendor(null, 'Namecheap', 'domain')$$, 'Only the Finance Manager', 'a Finance Officer cannot add a vendor');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'v1', save_finance_vendor(null, 'Namecheap', 'domain', 'https://www.namecheap.com');
select tst.expect_true((select name from finance_vendors where id = tst.id('v1')) = 'Namecheap', 'the Finance Manager can add a vendor');
select tst.expect_error($$select save_finance_vendor(null, '  namecheap ', 'domain')$$, 'already exists', 'a vendor name cannot be added twice (case and spaces ignored)');
select tst.expect_error($$select save_finance_vendor(null, 'Evil', null, 'javascript:alert(1)')$$, 'check constraint', 'a vendor website must be https');
select save_finance_vendor(tst.id('v1'), 'Namecheap', 'domain', 'https://www.namecheap.com', 'inactive');
select tst.expect_true((select status from finance_vendors where id = tst.id('v1')) = 'inactive', 'a vendor can be made inactive');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_count($$select 1 from finance_vendors$$, 1, 'any staff member can read vendors (to pick one in a request)');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from finance_vendors$$, 0, 'a client cannot');
reset role;

-- ══ BUDGETS ══════════════════════════════════════════════════════════════════════════════════════════════════
select set_config('ctf.m', date_trunc('month', current_date)::date::text, false);
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','period_kind','month','period_start',current_setting('ctf.m'),'amount',1000000))$$, 'Only the Finance Manager', 'a department admin cannot set a budget');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('period_kind','year','period_start','2026-01-01','amount',1))$$, 'Only the Finance Manager', 'a Finance Officer cannot set a budget');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'b1', save_finance_budget(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','period_kind','month','period_start',current_setting('ctf.m'),'amount',1000000));
select tst.expect_true((select amount from finance_budgets where id = tst.id('b1')) = 1000000, 'the Finance Manager can set a department + category budget');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','period_kind','month','period_start',current_setting('ctf.m'),'amount',5))$$, 'already an active budget', 'the same scope and period cannot have two budgets');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('period_kind','month','period_start',(current_setting('ctf.m')::date + 4)::text,'amount',5))$$, 'check constraint', 'a monthly budget must start on the 1st');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('period_kind','quarter','period_start','2026-02-01','amount',5))$$, 'check constraint', 'a quarterly budget must start on a quarter boundary');
select tst.expect_error($$select save_finance_budget(null, jsonb_build_object('period_kind','year','period_start','2026-01-01','amount',0))$$, 'check constraint', 'an amount must be above zero');
insert into ids select 'b2', save_finance_budget(null, jsonb_build_object('period_kind','month','period_start',current_setting('ctf.m'),'amount',3000000,'note','Company-wide cap'));
select tst.expect_true((select count(*) from finance_change_log where entity = 'budget') = 2, 'every budget created is logged');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from finance_budgets$$, 1, 'a department admin sees only their own department''s budget');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_count($$select 1 from finance_budgets$$, 2, 'a Finance Officer sees all budgets');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from finance_budgets$$, 0, 'a department member (not admin) sees none');
select tst.expect_count($$select 1 from list_budget_status()$$, 0, 'and gets no budget figures');
reset role;

-- ══ SPEND BUCKETS ════════════════════════════════════════════════════════════════════════════════════════════
insert into ids select 'pend',  tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Pending',  100000,'NGN','finance_review');
insert into ids select 'appr',  tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Approved', 200000,'NGN','approved');
insert into ids select 'paid',  tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Paid',     300000,'NGN','paid', 250000, 5);
insert into ids select 'recon', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Reconciled', 50000,'NGN','reconciled', 50000, 8);
insert into ids select 'rej',   tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Rejected', 999999,'NGN','rejected');
insert into ids select 'usd',   tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Dollars',  777777,'USD','approved');
insert into ids select 'hosting', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','hosting','Hosting', 400000,'NGN','approved');
insert into ids select 'be',    tst.mkreq('00000000-0000-0000-0000-0000000000b5','backend-development','domain','Backend domain', 600000,'NGN','approved');
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_true((select pending from list_budget_status() where budget_id = tst.id('b1')) = 100000, 'pending counts requests in review');
select tst.expect_true((select approved_unpaid from list_budget_status() where budget_id = tst.id('b1')) = 200000, 'approved-but-unpaid is its own bucket');
select tst.expect_true((select paid from list_budget_status() where budget_id = tst.id('b1')) = 250000, 'paid uses the amount actually paid, not the amount asked');
select tst.expect_true((select reconciled from list_budget_status() where budget_id = tst.id('b1')) = 50000, 'reconciled is its own bucket');
select tst.expect_true((select committed from list_budget_status() where budget_id = tst.id('b1')) = 500000, 'rejected, other-currency, other-category and other-department requests are not counted');
select tst.expect_true((select remaining from list_budget_status() where budget_id = tst.id('b1')) = 500000, 'remaining = budget minus committed');
select tst.expect_true((select committed from list_budget_status() where budget_id = tst.id('b2')) = 500000 + 400000 + 600000, 'the company-wide budget counts every department and category (in its own currency)');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from list_budget_status()$$, 1, 'a department admin gets figures for their own department only');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');

-- ══ REFUNDS ══════════════════════════════════════════════════════════════════════════════════════════════════
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'refund', 1000, 'RFD-1', current_date)$$, 'Only the Finance Manager', 'the requester cannot record a refund');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'refund', 1000, 'RFD-1', current_date)$$, 'Only the Finance Manager', 'a Finance Officer cannot either');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select record_fund_refund(tst.id('appr'), 'refund', 1000, 'RFD-1', current_date)$$, 'was paid', 'a request that was never paid cannot be refunded');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'refund', 250001, 'RFD-1', current_date)$$, 'more than was paid', 'a refund cannot exceed what was paid');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'gift', 10, 'RFD-1', current_date)$$, 'check constraint', 'the kind must be refund or chargeback');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'refund', 10, 'ab', current_date)$$, 'check constraint', 'a refund needs a real reference');
insert into ids select 'rf1', record_fund_refund(tst.id('paid'), 'refund', 40000, 'RFD-2026-001', current_date, 'Vendor credited the card');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'chargeback', 10, 'rfd-2026-001', current_date)$$, 'already recorded', 'a refund reference cannot be recorded twice');
select tst.expect_error($$select record_fund_refund(tst.id('paid'), 'chargeback', 210001, 'CB-1', current_date)$$, 'more than was paid', 'refunds are summed against what was paid');
select tst.expect_true((select refunded from list_budget_status() where budget_id = tst.id('b1')) = 40000, 'a refund shows in the budget');
select tst.expect_true((select spent from list_budget_status() where budget_id = tst.id('b1')) = 260000, 'and reduces what is spent (paid + reconciled - refunded)');
select tst.expect_error($$update finance_refunds set amount = 1 where id = tst.id('rf1')$$, 'permission denied', 'a refund cannot be edited');
select tst.expect_error($$delete from finance_refunds where id = tst.id('rf1')$$, 'permission denied', 'or deleted');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from finance_refunds$$, 1, 'the requester can see refunds against their own request');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_count($$select 1 from finance_refunds$$, 0, 'someone unrelated cannot');
reset role;
-- even the table owner path (a trigger) refuses edits
select tst.expect_error($$update finance_change_log set action = 'x'$$, 'permanent', 'the change log is append-only even for the database owner');
select tst.expect_error($$delete from finance_refunds$$, 'permanent', 'refund history cannot be deleted even by the database owner');

-- ══ BUDGET PANEL FOR REVIEWERS ═══════════════════════════════════════════════════════════════════════════════
insert into ids select 'big', tst.mkreq('00000000-0000-0000-0000-0000000000b1','frontend-development','domain','Big request', 600000,'NGN','finance_review');
set local role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_true(jsonb_array_length(budget_utilisation_for_request(tst.id('big'))) = 2, 'a Finance reviewer sees every budget that covers the request (department+category and company-wide)');
select tst.expect_true((budget_utilisation_for_request(tst.id('big')) -> 0 ->> 'scope') = 'department_category', 'the most specific budget comes first');
select tst.expect_true((budget_utilisation_for_request(tst.id('big')) -> 0 ->> 'over_budget')::boolean = true, 'approving it would put that budget over (460,000 committed + 600,000 > 1,000,000)');
select tst.expect_true((budget_utilisation_for_request(tst.id('big')) -> 0 ->> 'remaining_after')::numeric = -60000, 'and says by how much');
select tst.expect_true((budget_utilisation_for_request(tst.id('big')) -> 0 ->> 'pending')::numeric = 100000, 'the request itself is not counted twice as pending');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_true(jsonb_array_length(budget_utilisation_for_request(tst.id('big'))) = 2, 'the requesting department''s admin can see it too');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select budget_utilisation_for_request(tst.id('big'))$$, 'Finance reviewers', 'the requester cannot');
select tst.as_user('00000000-0000-0000-0000-0000000000b7');
select tst.expect_error($$select budget_utilisation_for_request(tst.id('big'))$$, 'Finance reviewers', 'another department''s admin cannot');
-- archive
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select save_finance_budget(tst.id('b2'), '{"amount": 3500000}');
select tst.expect_true((select amount from finance_budgets where id = tst.id('b2')) = 3500000 and (select version from finance_budgets where id = tst.id('b2')) = 2, 'a budget amount can change and its version counts up');
select tst.expect_true((select detail ->> 'amount_before' from finance_change_log where entity_id = tst.id('b2') and action = 'changed') = '3000000.00', 'the old amount is kept in the log');
select archive_finance_budget(tst.id('b2'), 'Replaced');
select tst.expect_error($$select save_finance_budget(tst.id('b2'), '{"amount": 1}')$$, 'archived', 'an archived budget cannot be changed');
select tst.expect_error($$select archive_finance_budget(tst.id('b2'), '')$$, 'not active', 'or archived twice');
select tst.expect_count($$select 1 from list_budget_status() where budget_id = tst.id('b2')$$, 0, 'an archived budget drops off the screen');
reset role;

-- ══ RENEWALS ═════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'title','Domain','category','domain','amount',85000,'frequency','yearly','next_due',(current_date+7)::text))$$, 'can add a renewal', 'a department member (not admin) cannot add a renewal');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'n1', save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'title','codextechfoundation.com domain','category','domain','vendor','Namecheap','amount',85000,'frequency','yearly','next_due',(current_date+7)::text));
select tst.expect_true((select remind_days from finance_renewals where id = tst.id('n1')) = '{30,14,7,1}', 'a renewal gets the default reminder schedule');
select tst.expect_error($$select save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='backend-development'),'title','Not mine','category','domain','amount',1,'frequency','yearly','next_due',(current_date+7)::text))$$, 'can add a renewal', 'a department admin cannot add one for another department');
select tst.expect_error($$select save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'title','Bad','category','domain','amount',1,'frequency','weekly','next_due',(current_date+7)::text))$$, 'check constraint', 'the frequency must be monthly, quarterly or yearly');
select tst.expect_error($$select save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'title','Bad','category','domain','amount',1,'frequency','yearly','next_due',(current_date+7)::text,'remind_days','[400]'::jsonb))$$, 'check constraint', 'reminders must be 0 to 365 days before');
select tst.expect_error($$select save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'title','Bad','category','domain','amount',-5,'frequency','yearly','next_due',(current_date+7)::text))$$, 'check constraint', 'the amount must be above zero');
select save_finance_renewal(tst.id('n1'), '{"amount": 90000, "critical": false, "remind_days": [30, 7, 1]}');
select tst.expect_true((select remind_days from finance_renewals where id = tst.id('n1')) = '{30,7,1}' and (select version from finance_renewals where id = tst.id('n1')) = 2, 'a department admin can change their renewal (reminders sorted, version counted)');
select save_finance_renewal(tst.id('n1'), '{"amount": 85000, "remind_days": [30, 14, 7, 1]}');
select tst.as_user('00000000-0000-0000-0000-0000000000b7');
select tst.expect_error($$select save_finance_renewal(tst.id('n1'), '{"amount": 1}')$$, 'can change a renewal', 'another department''s admin cannot change it');
select tst.expect_count($$select 1 from finance_renewals$$, 0, 'and cannot see it');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_count($$select 1 from finance_renewals$$, 0, 'a worker in another department cannot see it');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from finance_renewals$$, 1, 'the owning department''s members can');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_count($$select 1 from finance_renewals$$, 1, 'and Finance can');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'n2', save_finance_renewal(null, jsonb_build_object('department_id',(select id from departments where slug='backend-development'),'title','API credits top-up','category','api_credits','amount',250000,'frequency','monthly','next_due',(current_date+2)::text,'critical',true));
select tst.expect_true((select critical from finance_renewals where id = tst.id('n2')), 'the Finance Manager can add one for any department, and mark it critical');
reset role;

-- request from a renewal
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'nr1', create_fund_request_from_renewal(tst.id('n1'));
select tst.expect_true((select amount = 85000 and category = 'domain' and recurrence = 'yearly' and required_by = current_date + 7 and status = 'draft' and requester_id = auth.uid() from fund_requests where id = tst.id('nr1')), 'a renewal becomes an ordinary DRAFT fund request (nothing is paid or submitted automatically)');
select tst.expect_true(create_fund_request_from_renewal(tst.id('n1')) = tst.id('nr1'), 'doing it twice for the same due date returns the same request, not a duplicate');
select tst.expect_true((select last_request_id from finance_renewals where id = tst.id('n1')) = tst.id('nr1'), 'the renewal remembers its request');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_error($$select create_fund_request_from_renewal(tst.id('n1'))$$, 'does not exist', 'a worker in another department cannot raise a request from it');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select set_finance_renewal_status(tst.id('n1'), 'paused', 'vendor changing');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select create_fund_request_from_renewal(tst.id('n1'))$$, 'active renewal', 'a paused renewal cannot become a request');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select set_finance_renewal_status(tst.id('n1'), 'active');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select mark_finance_renewal_renewed(tst.id('n1'), (current_date + 372)::date)$$, 'Only the Finance Manager', 'a Finance Officer cannot mark a renewal as renewed');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select mark_finance_renewal_renewed(tst.id('n1'), current_date)$$, 'later than', 'the next due date must move forward');
select tst.expect_error($$select mark_finance_renewal_renewed(tst.id('n1'), current_date + 900)$$, 'later than', 'and not by years');
reset role;

-- ══ REMINDERS ════════════════════════════════════════════════════════════════════════════════════════════════
-- run as the scheduler (no signed-in user)
select set_config('request.jwt.claim.sub', '', true); select set_config('request.jwt.claim.role', 'service_role', true);
select tst.expect_true(send_due_renewal_reminders() = 3, 'the first run sends: a reminder for the renewal 7 days out, a reminder for the critical one 2 days out, and the critical escalation');
select tst.expect_true(send_due_renewal_reminders() = 0, 'running it again sends nothing: each reminder goes out once');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and title = 'Renewal due in 7 days') = 1, 'the owning department''s admin was told');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000b3' and kind = 'fund_request' and title like 'Renewal due%') = 2, 'the Finance Manager was told about both');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000b4' and title like 'Renewal due%') = 2, 'so was the Finance Officer');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title like 'Renewal due%') = 2, 'and the Main Admin');
select tst.expect_count($$select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000b5'$$, 0, 'someone not involved was not');
select tst.expect_count($$select 1 from notifications where title like 'Renewal due%' and (body ~ '85000|250000' or body ~ 'NGN')$$, 0, 'reminders never carry an amount');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title = 'Critical renewal needs attention') = 1, 'a critical renewal that is not approved yet is escalated to the Main Admin');
select tst.expect_count($$select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and title = 'Critical renewal needs attention'$$, 0, 'the escalation goes to the Main Admin and Finance, not to every department admin');
-- the due date gets closer: the next reminder day sends again
update finance_renewals set next_due = current_date + 1 where id = tst.id('n1');
select tst.expect_true(send_due_renewal_reminders() = 1, 'when the due date moves to tomorrow, the 1-day reminder goes out');
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and title = 'Renewal due tomorrow') = 1, 'worded as "tomorrow"');
-- overdue, once
update finance_renewals set next_due = current_date - 2 where id = tst.id('n1');
select tst.expect_true(send_due_renewal_reminders() = 1, 'an overdue renewal is flagged once');
select tst.expect_true(send_due_renewal_reminders() = 0, 'and not again the next run');
-- a critical renewal with an approved request is not escalated
update finance_renewals set next_due = current_date + 1, last_request_id = tst.id('appr') where id = tst.id('n2');
select send_due_renewal_reminders();
select tst.expect_true((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title = 'Critical renewal needs attention') = 1, 'a critical renewal whose request is already approved is not escalated again');
-- paused renewals are quiet
update finance_renewals set status = 'paused', next_due = current_date + 30 where id = tst.id('n1');
select count(*) as before_n from finance_renewal_reminders where renewal_id = tst.id('n1') \gset
select send_due_renewal_reminders();
select tst.expect_true((select count(*) from finance_renewal_reminders where renewal_id = tst.id('n1')) = :before_n, 'a paused renewal sends and records nothing');
update finance_renewals set status = 'active' where id = tst.id('n1');
select tst.expect_true(send_due_renewal_reminders() = 1, 'once active again, its reminder goes out');
reset role;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_error($$select send_due_renewal_reminders()$$, 'Only Finance', 'a worker cannot trigger renewal reminders');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_true(send_due_renewal_reminders() >= 0, 'a Finance Officer can (the Renewals tab button)');
reset role;
select tst.expect_true(not has_function_privilege('anon', 'public.send_due_renewal_reminders()', 'execute'), 'a signed-out visitor cannot run reminders');
select tst.expect_true(has_function_privilege('service_role', 'public.send_due_renewal_reminders()', 'execute'), 'the scheduler (service role) can');

-- ══ MISSING RECEIPTS ═════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_true((select count(*) from list_missing_receipts()) = 2, 'paid requests older than the grace period with no document are flagged (the 5-day-old and the 8-day-old one)');
select tst.expect_true(not exists (select 1 from list_missing_receipts() where request_id = tst.id('appr')), 'an unpaid request is never flagged');
select tst.expect_true((select days_open from list_missing_receipts() where request_id = tst.id('recon')) = 8, 'and the flag says how long it has been open');
select tst.expect_count($$select 1 from list_missing_receipts(10)$$, 0, 'a longer grace period hides them');
reset role;
insert into storage.objects (bucket_id, name, owner) select 'finance-docs', tst.id('paid')::text || '/receipt.pdf', null;
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_true((select count(*) from list_missing_receipts()) = 1 and not exists (select 1 from list_missing_receipts() where request_id = tst.id('paid')), 'attaching a document clears the flag');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count($$select 1 from list_missing_receipts()$$, 0, 'the requester does not see the Finance flag list');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_count($$select 1 from list_missing_receipts()$$, 0, 'nor does a department admin');
reset role;

-- ══ A SIGNED-OUT VISITOR CAN RUN NONE OF THIS ════════════════════════════════════════════════════════════════
select tst.expect_true(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
  ('save_finance_vendor','save_finance_budget','archive_finance_budget','record_fund_refund','list_budget_status','budget_utilisation_for_request','save_finance_renewal','set_finance_renewal_status',
   'mark_finance_renewal_renewed','create_fund_request_from_renewal','list_missing_receipts','send_due_renewal_reminders','finance_log','finance_spend','can_manage_finance','can_view_finance','is_company_staff')
  and has_function_privilege('anon', p.oid, 'execute')), 'no signed-out visitor can execute any finance office function');
select tst.expect_true(not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'finance_%' and c.relkind = 'r'
  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))),
  'finance tables are closed to signed-out visitors and read-only for signed-in people');

rollback;
