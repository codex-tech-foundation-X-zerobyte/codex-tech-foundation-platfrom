-- Behavioural tests for 20261002000000/1: Finance & Customer Service departments and the fund-request approval chain.
\set ON_ERROR_STOP on
begin;
-- people: main admin; requester (frontend member); frontend dept admin; finance manager (finance admin); finance officer (finance member); other worker; second finance manager
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','main@x'), ('00000000-0000-0000-0000-0000000000b1','req@x'), ('00000000-0000-0000-0000-0000000000b2','feadmin@x'),
 ('00000000-0000-0000-0000-0000000000b3','finmgr@x'), ('00000000-0000-0000-0000-0000000000b4','finofficer@x'), ('00000000-0000-0000-0000-0000000000b5','other@x'),
 ('00000000-0000-0000-0000-0000000000b6','finmgr2@x'), ('00000000-0000-0000-0000-0000000000c1','client@x');
update public.profiles set role='superadmin' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='worker' where id in ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000b6');
update public.profiles set role='client' where id='00000000-0000-0000-0000-0000000000c1';
insert into public.worker_profiles (user_id, worker_id, department_id, department_role, status) values
 ('00000000-0000-0000-0000-0000000000b1','CTF-WKR-F0000001',(select id from departments where slug='frontend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b2','CTF-WKR-F0000002',(select id from departments where slug='frontend-development'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b3','CTF-WKR-F0000003',(select id from departments where slug='finance'),'admin','active'),
 ('00000000-0000-0000-0000-0000000000b4','CTF-WKR-F0000004',(select id from departments where slug='finance'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b5','CTF-WKR-F0000005',(select id from departments where slug='backend-development'),'member','active'),
 ('00000000-0000-0000-0000-0000000000b6','CTF-WKR-F0000006',(select id from departments where slug='finance'),'admin','active');

\ir ../migrations/20261002000001_fund_requests.sql
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

-- 0. The two departments ship with the product --------------------------------------------------------------------------------
select tst.expect_true((select count(*) from departments where is_system and slug in ('finance','customer-service')) = 2, 'Finance and Customer Service are pre-provisioned');
select tst.expect_true((select count(*) from chat_channels c join departments d on d.id=c.department_id where d.slug in ('finance','customer-service')) = 6, 'and have their channels');
select tst.expect_error($$delete from departments where slug='finance'$$, 'cannot be deleted', 'the Finance department cannot be deleted');

set local role authenticated;
select tst.expect_error($$select fund_log((select r from fund_requests r limit 1), 'finance', 'approved', 'forged')$$, 'permission denied', 'a signed-in user cannot write approval records directly');
select tst.expect_error($$select notify_fund(array['00000000-0000-0000-0000-0000000000a1'::uuid], 'Forged', 'x')$$, 'permission denied', 'nor send workflow notifications');
-- 1. Submitting -------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r1', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','title','Renew codextechfoundation.com','justification','The domain expires in two weeks and the site would go offline.','amount',100000,'vendor','Namecheap'), false, 'k-1');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'draft', 'a worker can create a fund request (as a draft)');
select tst.expect_true((select id from (select create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','title','Renew codextechfoundation.com','amount',100000),false,'k-1') as id) q) = tst.id('r1'), 'a retried submission with the same key returns the same request (no duplicate)');
select tst.expect_error($$select create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='backend-development'),'category','domain','title','Not my department','amount',5),false,null)$$, 'department you belong to', 'a worker cannot request funds for a department they are not in');
select tst.expect_error($$select create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','domain','title','Free money','amount',0),false,null)$$, 'check constraint', 'the amount must be positive');
select tst.expect_error($$insert into fund_requests (requester_id, department_id, category, title, amount, content_hash) values (auth.uid(),(select id from departments where slug='frontend-development'),'domain','Direct insert',1,'x')$$, 'permission denied', 'there is no way to insert a request directly through the API');
select tst.expect_error($$update fund_requests set status='approved' where id=tst.id('r1')$$, 'permission denied', 'nor to change its status directly');
insert into ids select 'r0', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','other','title','No reason given','amount',10), false, null);
select tst.expect_error($$select submit_fund_request(tst.id('r0'))$$, 'Explain why', 'a request must be justified before it can be submitted');
select cancel_fund_request(tst.id('r0'), 'not needed');
select update_fund_request(tst.id('r1'), '{"justification":"The domain expires in two weeks and the website would go offline."}');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_error($$select submit_fund_request(tst.id('r1'))$$, 'your own request', 'nobody else can submit it');
select tst.expect_count($$select 1 from fund_requests$$, 0, 'someone unrelated cannot even see it');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select submit_fund_request(tst.id('r1'));
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'finance_review', 'submitting sends it to Finance review');
select tst.expect_error($$select update_fund_request(tst.id('r1'), '{"amount":1}')$$, 'already in review', 'it cannot be edited while in review');

-- 2. The review chain -------------------------------------------------------------------------------------------------------------
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'finance', 'approved')$$, 'cannot review', 'the requester cannot review their own request');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');   -- finance OFFICER
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'finance', 'approved')$$, 'cannot review', 'a Finance Officer (not Manager) cannot make the Finance review decision');
select tst.expect_count($$select 1 from fund_requests where id = tst.id('r1')$$, 1, '...but can see the request');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');   -- requester's department admin, too early
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'department', 'approved')$$, 'not waiting for that review', 'the department admin cannot review before Finance has');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');   -- main admin, far too early
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'super_admin', 'approved')$$, 'not waiting for that review', 'even the Main Admin cannot skip the reviews');
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'finance', 'approved')$$, 'cannot review', 'and cannot do Finance''s review while a Finance Manager is available');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');   -- finance manager
select tst.expect_error($$select review_fund_request(tst.id('r1'), 7, 'finance', 'approved')$$, 'changed after you opened', 'a review of the wrong version is refused');
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'finance', 'rejected')$$, 'Give a reason', 'a rejection needs a reason');
select review_fund_request(tst.id('r1'), 1, 'finance', 'returned', 'Please attach the renewal quote.');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'returned', 'Finance can return it with a reason');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select update_fund_request(tst.id('r1'), '{"vendor":"Namecheap Inc."}');
select submit_fund_request(tst.id('r1'));
select tst.expect_true((select version from fund_requests where id=tst.id('r1')) = 2, 'resubmitting after a return starts a new version');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select review_fund_request(tst.id('r1'), 1, 'finance', 'approved')$$, 'changed after you opened', 'an approval of the OLD version is refused');
select review_fund_request(tst.id('r1'), 2, 'finance', 'approved');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'department_review', 'Finance approval moves it to the department admin (not to payment)');
select tst.expect_error($$select review_fund_request(tst.id('r1'), 2, 'department', 'approved')$$, 'cannot review', 'the Finance Manager cannot also do the department review');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select review_fund_request(tst.id('r1'), 2, 'department', 'approved');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'awaiting_super_admin', 'only after both reviews does it reach the Main Admin');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select review_fund_request(tst.id('r1'), 2, 'super_admin', 'approved')$$, 'cannot review', 'no one but the Main Admin gives the final approval');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select review_fund_request(tst.id('r1'), 2, 'super_admin', 'approved');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'approved', 'the Main Admin approves');
select tst.expect_true((select count(*) from fund_request_decisions where request_id=tst.id('r1') and decision='approved') = 3, 'every stage left a record');
select tst.expect_true((select bool_and(actor_id is not null and created_at is not null) from fund_request_decisions where request_id=tst.id('r1')), 'with who acted and when');

-- 3. After approval: immutability -----------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select update_fund_request(tst.id('r1'), '{"amount":1}')$$, 'already in review', 'the requester cannot change the amount after approval');
select tst.expect_error($$update fund_requests set amount=1 where id=tst.id('r1')$$, 'permission denied', 'nor through a direct API update');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_error($$update fund_requests set amount=1 where id=tst.id('r1')$$, 'permission denied', 'not even the Main Admin can edit it directly');
reset role; select set_config('request.jwt.claim.sub','',true);
select tst.expect_error($$update fund_requests set amount=1 where id=(select v from ids where k='r1')$$, 'only through the approval workflow', 'and a direct SQL write (service role) is refused too');
select set_config('ctf.fund_rpc','on',true);
select tst.expect_error($$update fund_requests set amount=1, vendor='x' where id=(select v from ids where k='r1')$$, 'cannot be changed', 'even inside the workflow, approved fields are frozen');
select set_config('ctf.fund_rpc','off',true);
select tst.expect_error($$delete from fund_requests where id=(select v from ids where k='r1')$$, 'cannot be deleted', 'financial records cannot be deleted');
select tst.expect_error($$update fund_request_decisions set reason='edited'$$, 'permanent', 'approval records cannot be edited');
select tst.expect_error($$delete from fund_request_decisions$$, 'permanent', 'or deleted');

-- 4. Payment is recorded, not assumed -----------------------------------------------------------------------------------------------
set local role authenticated; select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select record_fund_payment(tst.id('r1'),'TRX-9981',100000,current_date)$$, 'Start the payment first', 'approval alone never makes a request paid');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select begin_fund_payment(tst.id('r1'), 2)$$, 'Only a Finance Manager', 'the requester cannot start their own payment');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_error($$select begin_fund_payment(tst.id('r1'), 2)$$, 'Only a Finance Manager', 'a Finance Officer cannot start a payment');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select begin_fund_payment(tst.id('r1'), 2);
select tst.expect_error($$select record_fund_payment(tst.id('r1'),'ab',100000,current_date)$$, 'transaction reference', 'a payment needs a real transaction reference');
select tst.expect_error($$select record_fund_payment(tst.id('r1'),'TRX-9981',0,current_date)$$, 'amount actually paid', 'and an amount');
select fail_fund_payment(tst.id('r1'), 'Bank declined the transfer');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'payment_failed', 'a failed payment is recorded as failed, not paid');
select begin_fund_payment(tst.id('r1'), 2);
select record_fund_payment(tst.id('r1'),'TRX-9981',95000,current_date,'Paid by bank transfer');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'paid', 'a recorded payment makes it paid');
select tst.expect_error($$select reconcile_fund_request(tst.id('r1'))$$, 'someone other than', 'the person who recorded the payment cannot reconcile it');
select tst.as_user('00000000-0000-0000-0000-0000000000b6');   -- second finance manager
select reconcile_fund_request(tst.id('r1'));
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'reconciliation_required', 'a payment that differs from the approval (95,000 vs 100,000) cannot be silently reconciled');
select tst.expect_error($$select reconcile_fund_request(tst.id('r1'))$$, 'Explain the difference', 'it needs a written explanation first');
select reconcile_fund_request(tst.id('r1'), 'Vendor gave a 5,000 discount (see receipt).');
select tst.expect_true((select status from fund_requests where id=tst.id('r1')) = 'reconciled', 'then it can be reconciled');

-- 5. Same transaction reference cannot be used twice -----------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r2', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','api_credits','title','API credits','justification','We are running out of credits this week.','amount',50000), true, null);
select tst.as_user('00000000-0000-0000-0000-0000000000b3'); select review_fund_request(tst.id('r2'),1,'finance','approved');
select tst.as_user('00000000-0000-0000-0000-0000000000b2'); select review_fund_request(tst.id('r2'),1,'department','approved');
select tst.as_user('00000000-0000-0000-0000-0000000000a1'); select review_fund_request(tst.id('r2'),1,'super_admin','approved');
select tst.as_user('00000000-0000-0000-0000-0000000000b3'); select begin_fund_payment(tst.id('r2'),1);
select tst.expect_error($$select record_fund_payment(tst.id('r2'),'trx-9981',50000,current_date)$$, 'already recorded', 'a transaction reference cannot be recorded twice (case-insensitive)');

-- 6. Rejection is final; cancellation; the Finance Manager's own request -------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r3', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','software','title','Fancy tool','justification','Everyone wants this tool for the team.','amount',900000), true, null);
select tst.as_user('00000000-0000-0000-0000-0000000000b3'); select review_fund_request(tst.id('r3'),1,'finance','rejected','Over budget; use the existing tool.');
select tst.expect_true((select status from fund_requests where id=tst.id('r3')) = 'rejected', 'a rejection ends it');
select tst.expect_error($$select review_fund_request(tst.id('r3'),1,'department','approved')$$, 'not waiting', 'a rejected request cannot go on to payment');
select tst.expect_error($$select begin_fund_payment(tst.id('r3'),1)$$, 'approved request', 'or be paid');
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_error($$select cancel_fund_request(tst.id('r3'))$$, 'no longer be cancelled', 'a decided request cannot be cancelled by the requester');
-- finance manager (b3) asks for something for Finance; the other finance manager (b6) reviews it
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'r4', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='finance'),'category','software','title','Accounting software','justification','We need accounting software for the books.','amount',30000), true, null);
select tst.expect_error($$select review_fund_request(tst.id('r4'),1,'finance','approved')$$, 'cannot review', 'a Finance Manager cannot approve their own request');
select tst.as_user('00000000-0000-0000-0000-0000000000b6'); select review_fund_request(tst.id('r4'),1,'finance','approved');
select tst.as_user('00000000-0000-0000-0000-0000000000b3');
select tst.expect_error($$select review_fund_request(tst.id('r4'),1,'department','approved')$$, 'cannot review', '...nor the department review');
-- the only admin of a department is the requester: the Main Admin may cover that review, and the record says so
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'r5', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','training','title','Course for the team','justification','The team needs this course to ship faster.','amount',20000), true, null);
select tst.as_user('00000000-0000-0000-0000-0000000000b3'); select review_fund_request(tst.id('r5'),1,'finance','approved');
select tst.as_user('00000000-0000-0000-0000-0000000000b2');
select tst.expect_error($$select review_fund_request(tst.id('r5'),1,'department','approved')$$, 'cannot review', 'a department admin cannot approve their own request');
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select review_fund_request(tst.id('r5'),1,'department','approved');
select tst.expect_true((select acted_as from fund_request_decisions where request_id=tst.id('r5') and stage='department') = 'superadmin_fallback', 'when no other department admin exists the Main Admin can cover, and it is recorded as such');

-- 7. Transparency -----------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_true((select count(*) from list_company_spending()) = 2, 'any active worker sees what the company has approved/spent (r1 and r2)...');
select tst.expect_true(not exists (select 1 from list_company_spending() where title ilike '%Fancy%'), '...but not rejected requests');
select tst.expect_error($$select justification from list_company_spending()$$, 'does not exist', '...and never the justification or vendor');
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_count($$select 1 from list_company_spending()$$, 0, 'a client sees none of it');
select tst.expect_count($$select 1 from fund_requests$$, 0, 'nor any request');

-- 8. Documents ------------------------------------------------------------------------------------------------------------------------------
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r6', create_fund_request(jsonb_build_object('department_id',(select id from departments where slug='frontend-development'),'category','hosting','title','Hosting bill','amount',45000), false, null);
insert into storage.objects (bucket_id, name, owner) values ('finance-docs', tst.id('r6')::text || '/invoice.pdf', auth.uid());
do $$ begin raise notice 'PASS the requester can attach a quote or invoice to their draft'; end $$;
select tst.expect_error($$insert into storage.objects (bucket_id, name, owner) values ('finance-docs', tst.id('r5')::text || '/swapped.pdf', auth.uid())$$, 'row-level security', 'but not to a request that is already decided');
select tst.as_user('00000000-0000-0000-0000-0000000000b5');
select tst.expect_count($$select 1 from storage.objects where bucket_id='finance-docs'$$, 0, 'an unrelated worker cannot read finance documents');
select tst.as_user('00000000-0000-0000-0000-0000000000b4');
select tst.expect_count($$select 1 from storage.objects where bucket_id='finance-docs'$$, 1, 'Finance can read them');
do $$ declare n int; begin delete from storage.objects where bucket_id='finance-docs'; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL evidence was deleted'; end if; raise notice 'PASS finance documents cannot be deleted by anyone through the API'; end $$;
rollback;
