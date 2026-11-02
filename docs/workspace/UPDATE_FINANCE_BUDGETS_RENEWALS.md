# Update: Finance part 2 — budgets, vendors, renewals, refunds, missing receipts

Slice 2 of `CONTINUE.md`. Nothing here moves money: budgets and reminders inform decisions, and every payment still needs an approved fund request.

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261003000001_finance_budgets_vendors_renewals.sql`
   (after `20261003000000_security_audit_fixes.sql` from the previous update, if you have not run that yet).
2. **Frontend**: deploy to Vercel. No edge function changed in this slice.
3. **Daily reminders (optional but recommended).** Reminders are sent by `send_due_renewal_reminders()`. Finance can press "Send due reminders" on the Renewals tab at any time; to run it every morning without anyone pressing it, enable the `pg_cron` extension in Supabase and run once:
   ```sql
   select cron.schedule('renewal-reminders', '0 7 * * *', $$ select public.send_due_renewal_reminders() $$);
   ```
   (7 am UTC = 8 am in Lagos.) Running it twice in a day is harmless: each reminder goes out once.

## What you can now do
- **Budgets** (Finance office → Budgets): the Finance Manager or Main Admin sets a budget for a department and/or category (or company-wide) per month, quarter or year. Each budget shows pending, approved-but-unpaid, paid, reconciled and refunded money separately, what is committed, and what remains; over-budget is flagged. A department admin sees their own department's budgets; Finance and the Main Admin see all.
- **Budget check for reviewers**: on a request that is waiting for review, Finance reviewers and the requesting department's admin see every budget that covers it and what would be left if it were approved (it says "Would exceed it" when approving would break a budget). The requester does not see budget figures.
- **Renewals** (domains, hosting, API credits, subscriptions): owner department, amount, frequency, next due date, reminder days (default 30, 14, 7, 1), a "critical" flag. Reminders go to the department's admins, Finance and the Main Admin; a critical renewal that is not approved 3 days out (or overdue) is escalated once to Finance and the Main Admin. Reminders never contain amounts. "Create a fund request" makes an ordinary **draft** request (never submitted or paid automatically; pressing it twice for the same due date returns the same request). After the renewal is paid, the Finance Manager uses "Mark as renewed" to move the due date to the next cycle; nothing advances on its own.
- **Vendors**: a simple list Finance maintains and every team member can read. Keep contact details and account numbers out of it.
- **Refunds and chargebacks**: the Finance Manager or Main Admin records them against a paid request (reference required and unique, cannot exceed what was paid in total, cannot be edited or deleted). They reduce what a request cost and what a budget has spent; the request itself stays immutable.
- **Missing receipts**: a paid request with no document in the finance-docs bucket after 3 days appears in Finance office → Missing receipts and shows a warning on the request.
- **Change log**: every budget, vendor, renewal and refund change is written to an append-only log (`finance_change_log`) readable by Finance and the Main Admin.

## Assumptions I made (please confirm or correct)
1. Finance Manager (admin of the finance department) and the Main Admin manage budgets, vendors and refunds. **Finance Officers can read but not change them.** Department admins manage their own department's renewals.
2. A request counts toward the budget period containing its **needed-by date**; with no date, the day it was submitted. (Alternatives: the day it was paid, or the day it was approved.)
3. Counted as spend: approved/payment-in-progress/payment-failed as "approved, unpaid"; paid and reconciliation-required as "paid" (using the amount actually paid); reconciled as "reconciled". Rejected, cancelled, returned, reversed requests count for nothing. A budget's "committed" figure excludes pending requests so that unapproved requests cannot silently use up a budget.
4. Budgets are per currency; a request only counts against budgets in its own currency (no conversion).
5. Budgets do **not** block approval; reviewers are shown the effect and decide. (If you want a hard block above the budget, say so and I will add it with an override reason.)
6. Only the amount and note of a budget can be changed; a different scope or period needs a new budget (the old one is archived), so history stays meaningful.
7. Missing-receipt grace period: 3 days. Critical escalation window: 3 days before due.

## Tests
- `supabase/tests/finance_budgets.test.sql`: 114 checks (no direct writes, who may do what, validation, spend buckets with every status, refund caps and immutability, budget panel access, renewals CRUD and access, request-from-renewal idempotence, reminder schedule, overdue, escalation, no amounts in messages, paused renewals, missing receipts with a real storage object, no anonymous access).
- `tests/dom/financeOffice.test.tsx` (22) and `tests/dom/financeRules.test.ts` (14).
- A race found by the browser pass and fixed with a regression test: opening a request from a link showed "No budget covers this request" because the viewer's departments loaded after the page decided what to show.
- Totals: SQL 577 pass / 0 failed files; vitest 492; node 231; `tsc -b` clean; oxlint 0 errors; build ok.

## Not done / next
- No reports yet (slice 3 builds income and expenditure, by department/category/vendor, CSV, and uses these tables).
- Budgets are not shown on the Super Dashboard (does not exist yet).
- Vendors are not linked to requests by id (the request still stores the vendor name as text). The vendor picker in the request form is not built; names can be typed.
- Real-data screenshots exist only from a mocked backend (see the previous update's honesty note).
