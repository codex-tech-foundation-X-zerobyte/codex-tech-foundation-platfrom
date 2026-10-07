# Security monitor

Admin → Security (superadmin only). One score, one prioritised "Needs attention" list, and a section per source.

| Source | Where it comes from | Needs setup? |
|---|---|---|
| Database & storage | `security_posture()` SQL function (RLS coverage, buckets, privileged functions, accounts, failed sign-ins) | No (migration `20260925…`) |
| This browser | The page itself (HTTPS, API URL, no secret key in the build) | No |
| GitHub | `security-monitor` Edge Function → Dependabot alerts, leaked secrets, code scanning, branch protection, CI | `GITHUB_TOKEN`, `GITHUB_REPOSITORY` |
| Vercel | Edge Function → production deployment health | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` |
| Website headers | Edge Function → HSTS, CSP, nosniff, framing, referrer, permissions | none (uses `SITE_URL` or your own origin) |

Sources that aren't connected say so and show the exact commands. A check that can't run (a missing token scope, a disabled GitHub feature)
is reported as **"Could not check"** with the fix, and is not counted for or against the score.

Score = 100 − 15 per failure − 5 per warning. Rules: `src/lib/securityChecks.ts` (unit-tested). Adapters: `supabase/functions/_shared/securityProviders.ts`.

**Everything external is read-only** (GET/HEAD only; asserted in tests). Tokens never reach the browser and are never returned or logged.

Not covered: it doesn't replay every role against every policy live (see `supabase/tests/`), and audit logs don't record IP addresses or devices.
