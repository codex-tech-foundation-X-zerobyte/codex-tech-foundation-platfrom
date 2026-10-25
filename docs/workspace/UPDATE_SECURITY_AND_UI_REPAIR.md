# Update: security review, fixes, and the UI repair pass (October 2026)

Also in this package: the Vercel address was corrected from `…platfrom…` to `…platform…` everywhere (index.html, robots.txt, sitemap.xml, two tests, two docs).

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261003000000_security_audit_fixes.sql`  ← **run this one first; it closes a serious hole** (see finding 1).
2. **Edge functions** (they share changed helper code). Keep the flag each one had:
   ```powershell
   supabase functions deploy push-dispatch --no-verify-jwt
   supabase functions deploy support-intake --no-verify-jwt
   supabase functions deploy webhook-inbox --no-verify-jwt
   supabase functions deploy submit-lead submit-contact submit-job-application --no-verify-jwt
   ```
   (If you deployed the submit-* functions with the JWT check on, drop the flag. They are public forms, so it was most likely off.)
3. **Frontend**: deploy to Vercel as usual (this carries the new service worker, the browser-stage check and all layout fixes).
4. **Search Console**: add `https://codex-tech-foundation-platform.vercel.app` as a new property and resubmit the sitemap. In Vercel, redirect the old `platfrom` domain to the new one.

## Findings and what was done
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | `user_roles` and `role_permissions` had policies but **row-level security was never switched on** (the loop in `20260912000002` missed them). Anyone, signed in or not, could read, add and delete role assignments and permission links through the API; `has_permission()` reads both. | Fixed in `20261003000000` (RLS on, anon revoked). Regression test: every table in `public` must have RLS. |
| 2 | **High** | The presentation browser stage framed whatever address was in the shared state, and a presenter can write that state straight to the database. A `javascript:` address would have run as the Workspace in every viewer's browser (the frame has `allow-scripts allow-same-origin`). | Fixed three ways: the database refuses non-https addresses (`guard_presentation`), every viewer re-checks before framing, and the Workspace's own and the database's origins are refused. Viewers also see an "outside website, never type your password" notice. Cinema video links are re-checked the same way. |
| 3 | Low | `sync_department_channels(uuid)` (internal) was callable by anyone through the API. | Revoked from `public/anon/authenticated`. |
| 4 | Medium | Tapping a push notification could be sent to another website (`//evil.example` starts with `/`). | Service worker now accepts same-site paths only. |
| 5 | Low | Push delivery accepted every `*.googleapis.com` host. | Only `fcm.googleapis.com` / `android.googleapis.com` now. |
| 6 | Medium | Finance and support pushes showed request titles / ticket subjects on lock screens. | For `fund_request`, `support`, `payroll`, `payment` kinds the push body is now "Open the Workspace to see the details." (headline unchanged). |
| 7 | Medium | Rate limits keyed on the first `X-Forwarded-For` entry, which a caller can choose. | `cf-connecting-ip` / `x-real-ip` are preferred. **Not verified against live Supabase**: check the header your project actually receives. |
| 8 | Low | Public functions read a whole body before checking its size. | `support-intake` and `webhook-inbox` stop reading at the limit; the three `submit-*` forms refuse a declared size over 64 KB. |
| 9 | Low | `.gitignore` did not list `.env`. | Added `.env`, `.env.*`, `!.env.example`. |
| 10 | Info | `AdminSecurity` crashed if the scan result had no `providers` list. | Guarded. |

### Checked and found fine
Markdown renderer (no HTML strings; `javascript:` links dropped), slide images (https / private-bucket only), no `dangerouslySetInnerHTML`/`postMessage`/`eval`, localStorage holds only Supabase's own session and call-panel positions, service worker caches only the app shell, no secrets in the repo or in `dist/`, SSRF surface (only web-push endpoints, allow-listed), integrations function (JWT + role checks), fund/support/presentation tables have no direct write policies, no policy uses `using (true)`, every security-definer function sets `search_path`, support-intake key handling (SHA-256 only, shape check, rate limit).

### Not done / owner decisions
- **CSP is still Report-Only.** Recommendation: review the reports for a week, then enforce. The current policy should already pass for the app itself; the risk is third-party scripts you add later. Keep `frame-ancestors 'none'` and `display-capture=(self)`.
- `npm audit`: 0 issues in production dependencies; 5 in dev tooling (vite, vitest, undici, source-map-js). Not upgraded (a tooling bump deserves its own session).
- `push_subscriptions` still lets a person insert their own row with any endpoint text. This is safe because delivery re-validates the host, but a CHECK on the endpoint would be tidier.
- Phishing risk on the presentation board is reduced (visible notice, own origin blocked) but not removed: a colleague can still present an outside page. Consider restricting who may present, or an allow-list of hosts.
- Storage policies for `finance-docs` / `presentations` and a line-by-line IDOR review of every `p_user` function were sampled, not exhaustively audited.

## UI repair pass: what was checked
Real Chromium (headless), app built against a **mocked backend** (empty lists plus a few departments and workers), every route in `App.tsx` for public, worker, admin and client shells at 360, 768 and 1280 px, reduced motion on. Automated checks: horizontal overflow, elements past the viewport, console/page errors, redirects, touch targets under 40 px; plus screenshots reviewed by eye for the new pages.

Result: **0 horizontal overflows, 0 script errors, 0 wrong redirects** after the fixes (public 26, worker 78, admin 93, client 18 page-width checks).

Fixed:
- Fund requests, Support desk and Presentations showed their title **twice** (shell title plus the page's own header). The shell title now hides when a page draws its own.
- The breadcrumb squeezed the current page to one letter on phones ("Fi…"). It now keeps the name and drops the first crumb on narrow screens.
- Calendar: the **New meeting/event button was clipped off-screen** at 360 px; the toolbar wraps.
- Touch targets: sidebar links, close button, top-bar icon buttons, department switcher chips, small and medium buttons, tabs, search box and calendar/project filter pills are 40 px or taller on phones and touch screens.
- Onboarding tick boxes keep their look but have a 40 px tap area.

The harness is saved as `scripts/ui-scan/scan.mjs` (usage in its header) so the pass can be repeated.

**Not covered (be honest):** screens with real data (tables with many rows, long names, open modals, an active presentation room, a live call panel) because the mock returns empty lists. Tables and modals are scroll-contained by their shared components, but real-data screenshots are still wanted; a few small controls remain (password show/hide 30 px, support status pills 32 px, switch track 23 px tall, inline text links), and light mode was not checked (the app has dark only as far as the scan could tell).

## Tests added
`supabase/tests/security_audit.test.sql` (26 checks, fails against the pre-fix database), `tests/dom/presentationSecurity.test.tsx` (13, 8 fail without the fix), `tests/auditFixes.test.mjs` (6), `tests/uiRepair.test.mjs` (4).
Totals: SQL 463 pass / 0 failed files; vitest 456 pass; node 231 pass; `tsc -b` clean; oxlint 0 errors (22 existing warnings); `npm run build` ok.
