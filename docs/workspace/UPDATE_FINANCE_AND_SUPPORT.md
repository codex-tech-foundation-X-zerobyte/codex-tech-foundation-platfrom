# Update: Finance department (fund requests) and Customer Service department (support desk)

## Apply, in this order
1. **SQL editor, one at a time** (each is safe to run twice):
   1. `supabase/migrations/20261002000000_finance_and_customer_service_departments.sql`
   2. `supabase/migrations/20261002000001_fund_requests.sql`
   3. `supabase/migrations/20261002000002_support_tickets.sql`
   4. `supabase/migrations/20261002000003_fix_presentation_insert_returning.sql`  ← **fixes "Start presenting" failing with 403**. Run it even if you already ran the earlier presentation migration.
2. **Edge function** (needed for projects to send tickets):
   ```powershell
   supabase functions deploy support-intake --no-verify-jwt
   ```
3. **Deploy the frontend.**
4. **Put people in the departments:** Admin → Workers → a worker → *Edit departments*. In **Finance**, the *Department Admin* is the **Finance Manager** (makes the Finance review, starts/records payments, reconciles); a plain member is a **Finance Officer** (can see requests, cannot decide). In **Customer Service**, the Department Admin is the **Support Lead** (assigns tickets, sees connected projects and performance).

## Fund requests (Workspace → Fund requests)
`employee submits → Finance Manager reviews → requesting department's admin reviews → Main Admin decides → payment recorded → reconciled`.
- Approval is **not** payment. After approval a Finance Manager *starts* a payment, then *records* it with the bank/provider's transaction reference (unique across all requests) and the amount actually paid. Someone **else** then reconciles it. A paid amount that differs from the approval cannot be closed without a written explanation.
- Nobody reviews their own request. If a department's only admin is the requester, the Main Admin may cover that review and the history says "covering".
- A reviewer approves **a specific version**. If the request changed since they opened it, the approval is refused.
- After approval nothing material can change (amount, vendor, currency, department). Change = a new request. Direct API writes are refused; financial history cannot be deleted; approval records cannot be edited.
- **Company spending** tab: every active team member sees what was approved and paid, without justification, vendor or requester.
- Nothing here moves money. Paystack execution, the approval passcode and payroll are not built yet.

## Support desk (Workspace → Support desk)
- Agents log tickets, assign (agents may take unassigned ones; leads assign to others), reply, add internal notes, set status and **escalate** to Frontend / Backend / DevOps / Cybersecurity, which creates a Bug on that department's board and lets that team see (and add internal notes to) only that ticket.
- Customer-visible replies and internal notes are separate and visibly different. The first-response target defaults to 4h urgent, 24h high, 48h normal, 96h low (`support_due_at()` in the migration: change it there).
- **Connected projects** (Main Admin): *Connect project* shows a key **once**. Only its SHA-256 fingerprint is stored. Revoke at any time.
- **Performance** tab shows handled, resolved, first-reply time, resolution time and customer rating side by side, never counts alone.

### Sending a ticket from a project's backend
```js
// Server-side only. Never put the key in browser code.
await fetch('https://<your-project>.supabase.co/functions/v1/support-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-support-key': process.env.CODEX_SUPPORT_KEY },
  body: JSON.stringify({ external_ref: 'ORD-77', customer_ref: 'user_9', customer_name: 'Ada', subject: 'Cannot log in', description: '...', category: 'account', priority: 'high' }),
})
// 201 { ticket: "TKT-000012", duplicate: false }   (a retry with the same external_ref returns 200 and duplicate: true)
```
Reports containing what looks like a card number, a secret key, a token or a password are refused (422).

## Not built yet (from your big directive)
Super Monitor and incidents, SDK telemetry/ingestion, budgets and budget checks, recurring renewals and alerts, automated reports and exports, payroll and payment batches, Paystack transfers, the Super Admin payment passcode, Codex Monitor (the external product), and a customer-facing status/reply endpoint for tickets (the database functions exist: `support_ticket_public`, `support_customer_reply`, `support_customer_rating`; no edge function exposes them yet, and customers are not emailed).

## Tests
`supabase/tests/fund_requests.test.sql` (70+ checks), `supabase/tests/support_tickets.test.sql` (35+), updated department/channel counts in older SQL tests; `tests/dom/fundAndSupportRules.test.ts`, `tests/dom/financeAndSupportPages.test.tsx`, `tests/supportIntake.test.mjs`. SQL tests run on a real PostgreSQL: `bash supabase/tests/local/run.sh`.
`tests/dom/devtools.test.tsx` has one timing-sensitive test that can fail when the whole suite runs at once; it passes alone.

## Not verified
Not opened in a real browser, not run against your Supabase, and the `support-intake` edge function itself was not run under Deno (its validation logic is unit-tested and its database function is tested in PostgreSQL).
