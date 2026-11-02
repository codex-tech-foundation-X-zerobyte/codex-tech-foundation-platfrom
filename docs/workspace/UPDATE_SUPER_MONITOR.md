# Update: Super Monitor, Super Dashboard, and the accessibility pass

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261004000000_super_monitor.sql`.
2. **Deploy the new functions** (each authenticates itself, so no JWT check). `workspace-sweep` is the single periodic job for Super Monitor *and* Customer Service (see `UPDATE_CUSTOMER_SERVICE.md`):
   `supabase functions deploy monitor-ingest --no-verify-jwt`
   `supabase functions deploy workspace-sweep --no-verify-jwt`
   Also redeploy `push-dispatch` (its shared code changed: monitor notifications are now treated as private, so incident text never appears on a lock screen).
3. **One secret** for the sweep (use any long random value, at least 24 characters; do not paste it anywhere): `supabase secrets set WORKSPACE_SWEEP_SECRET=...`
4. **Schedule the sweep** to call `POST https://<project-ref>.supabase.co/functions/v1/workspace-sweep` with the header `x-sweep-secret: <that secret>` every 1 to 2 minutes. Supabase Cron can do this; so can any scheduler that can send a POST. Without it, the Main Admin can still press **Run checks now** on the Super Monitor page, but nothing opens a "no heartbeat" incident or escalates an unacknowledged one by itself. *I could not test the scheduler from here.*
5. **Deploy the frontend** (`npm install` first; Node 22.22.2 or newer).
6. In the Workspace: **Super Monitor → Setup**: register a project, then create a key for it. The key is shown once; copy it into that project's environment as `MONITOR_KEY`. The page shows a ready-to-paste example. The client code is in `sdk/super-monitor/`.

## What it does
Super Monitor watches **the company's own projects** (and nothing else: there is no customer, tenant or billing idea anywhere in it, and it has nothing to do with the external Codex Monitor product).

- A project sends **errors, messages, latency and heartbeats** through `monitor-ingest`, using a key that can only *write* telemetry for that one project, within a quota.
- Secrets and personal details that slip into messages are **redacted before storage** (tokens, bearer headers, provider and Codex keys, `password=…` style values, e-mail addresses, card-length numbers, and everything after `?` in a route).
- Events are **counted once** even if the SDK retries (each carries an id). Dashboards read **hourly aggregates**, never raw events; raw events are deleted after 14 days, hourly figures after 400 days, incident history never.
- **Health is worked out when you look**, not stored: *Down* (no heartbeat for three intervals), *Degraded* (a live critical, high or medium incident), *Healthy*, *No data yet*, *Paused*.
- An **incident opens by itself** when the same error repeats (default 10 times in 10 minutes, set per project), on any fatal error, or when heartbeats stop. A resolved incident whose error returns within 7 days is **reopened**, not duplicated.
- **Lifecycle:** Open → Acknowledged → Investigating → Fix in progress → Monitoring → Resolved, and Reopened. The database only allows the moves the screen offers. **Resolving needs a written root cause** (10 characters or more). Notes can be added but never edited or deleted. Incidents can be assigned (only to someone who can see that project), re-rated, and closed as a duplicate of another incident in the same project.
- **Acknowledge deadlines:** critical 5 min, high 15, medium 60, low 240. Unacknowledged past that, the sweep **escalates**: level 1 tells the Cybersecurity admins, level 2 tells every Main Admin. Each level tells only the people it *adds*, and the same reason never notifies twice.

## Who can do what
| | Main Admin | DevOps and Cybersecurity staff | The owning department's members | Everyone else |
|---|---|---|---|---|
| See a project, its incidents and errors | all | all | their own project | none |
| Acknowledge, investigate, assign, add notes, resolve | yes | yes | their own project | no |
| Register or pause a project; create or revoke a key | **yes** | no | no | no |
| See which keys exist (never the key) | yes | no | no | no |
| Run checks now | yes | no | no | no |

Investigating an incident gives **no extra access**: no table here holds a secret, a customer record or a production control, and the database refuses every direct write.

## Super Dashboard
One read-only page (`/admin/super-dashboard`, `/worker/super-dashboard`). **Each section follows the permission that already governs its data**, and a section you may not see is *absent*, not shown empty: monitoring (DevOps, Cybersecurity, Main Admin), customer support (Customer Service lead, Main Admin), spending and renewals (people who can already view Finance), security and audit (Main Admin only). Every money figure says what kind it is: **Paid** (money that went out), **Reconciled** (matched to a statement), **Pending** (waiting for a decision, or approved and not yet paid) and **Estimated** (a renewal's recorded amount; the real bill may differ). A request with a failed or reversed payment, or one waiting to be reconciled, is counted as *needs attention*.

## Tested
- SQL: **175 new checks** in `supabase/tests/super_monitor.test.sql` (825 in the whole suite, fresh database): access tiers, key handling, redaction, de-duplication, quotas, aggregates, automatic incidents, silence detection, lifecycle and guards, escalation, retention, per-section dashboard gating. I **broke the migration on purpose in five ways** (open visibility, no write guard, no e-mail redaction, no root-cause rule, no de-duplication) and each one made the suite fail, so the tests do check what they claim. Writing and running the tests exposed three real defects in my own first draft, all fixed: a bearer token was left unredacted, escalation paged people twice, and the dashboard's section list was built wrongly.
- Node: ingestion parser and edge-function contracts, the SDK (retries with the same ids, backs off, honours Retry-After, stops on a revoked key, bounded queue), the lifecycle table **compared against the SQL** so screen and database cannot drift, and structural guards (every function has an explicit access decision; nothing granted to `anon`; no external-product concept in the schema).
- Screens: 26 new tests for Super Monitor and the Super Dashboard (plus 3 for the scroll-focus hook and table headers).
- **Real browser:** the new pages (and, with them, every page in the app: 198 page-width scans across public, client, worker and admin at 360 and 1280 px) audited with axe-core against a mocked backend: no violations, no layout overflow.

## Not done, or not verified
- **The two edge functions were never executed** (no Deno here): their parsing logic and contract are tested, and both pass a syntax check, but the first real call will be on your project. Try it with the SDK, or `curl` with a key and one event.
- **The sweep is not scheduled** until you do step 4.
- **Notification delivery "retry":** in-app notifications are written inside the same database transaction as the incident, so they cannot half-fail; getting a *push* to a phone is the existing push pipeline's job (use Settings, Notifications, Run a full checkup).
- **The notification mute switches** (Settings, per-event) do not yet include monitoring: incident notifications are always on.
- **Security Monitor page:** I used the audit log (key creation and revocation are logged, and the dashboard summarises it) but did **not** merge with the existing Security Monitor page.
- **SDK versions:** each project shows the *latest* SDK version it reported, not a breakdown of versions in use.
- **Uptime** is heartbeat-based on purpose: Super Monitor never fetches a URL, so it cannot be turned against internal addresses. A project that cannot send a heartbeat cannot be judged "down".
- **A key used in a browser is visible to anyone who opens the page.** It can only write telemetry, within a quota, and can be revoked; there is no per-origin allow-list yet.
- The incident dialog was covered by interface tests but **not opened in the browser audit**; the project dialog was.
- Linking an incident to a support ticket is not built (it was not in the brief).

## Accessibility pass (the open item from last session)
Fixed and verified in a real browser: contrast (`--text-faint` was 2.9 to 3.4:1, now 4.5:1 or better; accent text now uses `--accent-text`; disabled switches no longer fade their explanation), nested `<main>` on every public page and a missing one on sign-in, duplicate banner landmarks from dialogs, scroll boxes the keyboard could not reach (a new `useScrollFocus` hook), missing and skipped headings (department pages, Contact, calendar, dialogs, empty states), two landmarks named "Notifications", an unnamed select, and an empty table header. Two regressions I caused along the way (a hook placed after an early return in `Table`, and hidden table text widening the page) were caught by tests and the browser audit and are fixed with regression tests. `npx oxlint src`: 26 warnings, 0 errors. The ones left are listed in `CONTINUE.md`; none is a user-facing bug that I could find.

## The Google Analytics errors you pasted
Not caused by this code. They are failed requests from Google's own script to its collection endpoint, almost always an ad or tracker blocker, a privacy extension, or a filtered network. The CSP is Report-Only (blocks nothing) and the service worker ignores cross-origin requests. Check in a clean browser profile, then GA Realtime.
