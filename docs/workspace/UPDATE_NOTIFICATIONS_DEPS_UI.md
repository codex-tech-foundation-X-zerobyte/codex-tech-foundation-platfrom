# Update: notifications fixed and checkable, dependencies updated, UI audit started

## Apply, in this order
1. **SQL editor** (all safe to run twice; skip any you already ran): `20261003000000_security_audit_fixes.sql` (critical: role tables had no row security), `20261003000001_finance_budgets_vendors_renewals.sql`, `20261003000002_finance_reports.sql`, then **`20261003000003_notification_checkup.sql`** (new).
2. **Redeploy the push function** (its shared code changed, so a test notification is shown even with the app in front):
   `supabase functions deploy push-dispatch --no-verify-jwt`
   (also redeploy support-intake, webhook-inbox and the three submit-* functions if you did not after the security update; see `UPDATE_SECURITY_AND_UI_REPAIR.md`).
3. **Dependencies**: from the project folder run `npm install` (the lock file is updated; `npm audit` now reports 0 vulnerabilities). Node must be **22.22.2 or newer** (jsdom and react-router already require it; set Node 22.x or 24.x in Vercel project settings if you have pinned an older one).
4. Deploy the frontend to Vercel.

## Notifications: what was wrong and what changed
- **Real defect found and fixed: a new in-app notification was almost invisible while the app was open.** The service worker deliberately stays silent when the app is in front, expecting the app to show a toast, but the app only changed a small badge. Anyone testing with the app open saw nothing. Now a toast appears (with a View button) whenever a notification arrives, except when you are already on the Notifications page, which now reloads its own list live.
- **The push hand-off failed silently by design** (`dispatch_push` never lets push break the original save). A wrong address, wrong secret, missing pg_net or a function deployed with JWT checking all looked identical: nothing. The hand-off is now recorded (`push_dispatch_log`, no secrets), including why the database could not call out.
- **New: Settings, Notifications, "Run a full checkup".** It sends a real test notification through the same path real events use, listens for it live, reads what the push function answered, and says in plain words which step fails and what to do, for example: pg_net not enabled; push_settings missing or the address wrong; secret mismatch (403); function deployed with JWT checking on (401, redeploy with `--no-verify-jwt`); function missing its VAPID keys (503); function ran but sent nothing (no registered device or push turned off); device blocked or not registered; live updates not arriving (realtime). "Copy report" gives a text summary with no secrets. The checkup is shown even when the browser blocks notifications, since that is when it is needed most. The existing "send a test" button (which tests the function directly) is unchanged.
- **I could not reproduce your exact failure here**: it depends on your Supabase settings (push_settings row, secrets, deployment flags), which I cannot see. Run the checkup once on the device where it fails; the failing line tells you the fix. If it reports all OK and nothing appears, the usual cause is Do Not Disturb/Focus or the app being in front (the checkup says so).
- Tests: `supabase/tests/notification_checkup.test.sql` (15 checks), `tests/dom/notificationCheckup.test.ts` (22), `notificationCheckupPanel.test.tsx` (9), `liveNotifications.test.tsx` (6).

## Dependencies
- `npm audit`: 5 vulnerabilities (2 moderate, 3 high, all in build/test tooling) fixed; now **0**. `package.json` version floors raised to the installed versions so a fresh install cannot fall back to a vulnerable one.
- Updated: react 19.3, supabase-js 2.118, lucide-react 1.61, vite 8.3.5, vitest 5.0.5, jsdom 30.1.3, oxlint 1.89 and others (all in range). **Major versions adopted after testing**: react-router 7 to 8.5.0 and TypeScript 6 to 7.0.2 (typecheck, 554 frontend tests, build and a 182-check real-browser route scan all pass).
- **Deliberately not upgraded: `@types/node` 24 to 26.** Its version should match the Node that runs the code (22/24), otherwise it permits functions that do not exist at runtime. Revisit when you move to Node 26.
- oxlint now reports 28 warnings (it was 22, a newer version adds rules); 0 errors. Not yet cleaned.

## UI: what was checked, what is open
- Layout checks (overflow, errors, redirects, touch targets) were clean across all routes at 360 and 1280 px after the react-router 8 and dependency updates.
- **Accessibility audit (axe-core, WCAG 2 A/AA) was started but is INCOMPLETE.** The public and worker passes ran; the admin and client passes were invalid (the test server died mid-run) and 43 pages reported "axe-failed" (the page navigated while the audit ran). Treat the counts below as a first look, not a score. Findings from the pages that did run:
  1. **Colour contrast (serious)**: about 19 pages, 67 elements, e.g. the small percentage labels in charts/bars (`.ctf-bar em.mono`), faint secondary text.
  2. **Scrollable regions not keyboard-focusable (serious)**: the modal body (`.ctf-modal__body`) and 3 other scroll boxes need `tabindex="0"` (and a label) so keyboard users can scroll them.
  3. **Public pages: more than one main landmark / main nested in another landmark** (the layout wraps `<main id="ctf-public-main">` and pages add their own `<main class="ctf-content-page">`): change the inner ones to `<div>`/`<section>`.
  4. **16 pages have no level-one heading**, and 11 skip heading levels (for example an `h3` empty-state title straight under the page title).
  5. A few duplicate `banner` landmarks (two `<header>` elements at top level).
- None of these were changed yet. Re-run the audit one group at a time (instructions in the header of `scripts/ui-scan/scan.mjs`) to get a clean baseline, fix 1 to 4, and re-run.
