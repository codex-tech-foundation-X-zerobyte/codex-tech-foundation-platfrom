# Update: Finance part 3 — reports, Codex's own income, transparency

Slice 3 of `CONTINUE.md`. Reports are generated from recorded data only. Nothing here moves money.

## Apply, in this order
1. **SQL editor** (safe to run twice), after the two earlier 20261003 migrations: `supabase/migrations/20261003000002_finance_reports.sql`
2. **Frontend**: deploy to Vercel. No edge function changed.

## What you can now do (Finance office → Reports and Income tabs, Finance members and the Main Admin)
- **Reports**: choose Daily, Weekly (Monday to today), Monthly, Yearly, Last month or a custom range (up to about two years), a currency, and optionally one department; press **Generate report**. Each report is logged (who, which period, which scope) in the append-only change log.
- A report keeps three kinds of figure apart:
  - **Submitted in the period**: requested and approved amounts, by the day each request was submitted (drafts are not counted; a rejected request still counts as requested).
  - **Money moved in the period**: paid (by the day it was paid, using the amount actually paid), refunded (by the day received), income (by the day received), net spend, and net position (income minus net spend).
  - **As of the moment it was generated**: pending approvals, approved-but-unpaid, discrepancies (a payment that differs from what was approved, or awaiting reconciliation), missing receipts, renewals due in 30 days and overdue.
- Breakdowns by **department, category, vendor, project and month**, each with requested, approved, paid, refunded and net. Vendor names are matched ignoring case and spaces.
- **Downloads**: a *summary* CSV (period, scope, who generated it, headline figures, every breakdown, and how the figures are counted, so it makes sense on its own) and a *detail* CSV with one line per request. Cells that start with `= + - @` are neutralised so a spreadsheet can never run them as formulas. **Print or save as PDF** uses the browser's print dialog with the app chrome hidden (no separate PDF generator was added).
- **Income (Codex's own only)**: the Finance Manager or Main Admin records money Codex itself earned (fees for its own work, retainers, its own product sales, grants) with a unique reference. Entries cannot be edited or deleted; a mistake is fixed with a **reversal** entry (capped at what was recorded, with a reason). The screen states that money passing through Codex for a client, and any client project's own payment volume, is not income and does not belong there. There is no external-tenant concept anywhere in these tables.
- A **department admin** can call the report for their own department only (the database allows it); the screen currently offers reports to Finance and the Main Admin only. A department report never contains company income.

## Assumptions (please confirm or correct)
1. "Requested" includes every submitted request that is not a draft, rejected and cancelled ones included, so the gap between requested and approved is visible.
2. "Approved" means the request has been approved at any point (including ones since paid, reconciled, failed or reversed).
3. The two views use different dates on purpose (submission date versus payment date). They are labelled and never added together.
4. One currency per report; no conversion. Run one report per currency.
5. The detail file stops at 5,000 lines and says so; use a shorter period for more.
6. Finance Officers may generate and download reports but not record income.
7. Net position is a cash view (income received minus net payments made). It is not an accounting profit-and-loss and does not include payroll (not built yet).

## Tests
- `supabase/tests/finance_reports.test.sql` (58 checks): every figure against known fixtures (all statuses, other currency, out-of-period payment, drafts, reversals, refunds), who may see company versus department reports, income permissions, immutability, logging, grants, and the lines behind the numbers (including a real storage object clearing the receipt flag).
- `tests/dom/financeReports.test.ts` (12), `tests/dom/financeOffice.test.tsx` now 35 (the Reports and Income tabs, filters, CSV downloads, reversal caps).
- Found and fixed with a regression test: the department list in Reports was fetched before the page knew the viewer was in Finance and then cached empty (Finance users would have had no departments to choose from).
- Browser check against the mocked backend at 360, 768 and 1280 px: one overflow on phones (grid children not allowed to shrink) fixed; report figures now sit two per row on phones.
- Totals: SQL 635 pass / 0 failed files; vitest 517; node 232; `tsc -b` clean; oxlint 0 errors; build ok.

## Not done / next
- Separate permission for payroll and individual compensation visibility is for slice 6 (payroll does not exist yet).
- Reports are not on the Super Dashboard (slice 4).
- Scheduled or saved reports (for example a monthly report emailed automatically) are not built.
- A charted view (bars over time) is not built; the month table is the time series.
