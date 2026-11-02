> **Setting this up for the first time? Follow `GITHUB_SETUP_GUIDE.md` (same folder) instead: it covers slices 1 to 5 in one ordered checklist, and the same checklist is in the app (Admin, Integrations, GitHub, Setup guide).**

# Update: GitHub Shadow, slice 1 (GitHub App, signed webhooks, read-only code browser) (November 2026)

Decisions from the owner: **use a GitHub App: yes.** Organisation and repositories: **no preference**, so nothing is linked automatically; the Main Admin links repositories in Integrations.

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261006000000_github_app_and_activity.sql`. New tables only; nothing existing is changed.
2. **Create the GitHub App** (GitHub, Settings, Developer settings, GitHub Apps, New). Read-only permissions: Metadata, Contents, Issues, Pull requests, Actions, Deployments, and **Checks** (Checks is only needed from slice 2, for CI status on pull requests; add it now to avoid a second approval). Subscribe to events: Push, Pull request, Pull request review, Issues, Workflow run, Deployment status. Webhook URL: `https://<your-project>.supabase.co/functions/v1/github-webhook`. Choose a long random webhook secret. Generate a private key (a `.pem` file). Install the App on your organisation and choose the repositories it may see.
3. **Edge Function secrets** (Supabase, Edge Functions, Secrets). Do not put these anywhere else:
   - `GITHUB_APP_ID` (the numeric App ID)
   - `GITHUB_APP_PRIVATE_KEY` (the whole `.pem` text; `\n` written as literal `\n` also works)
   - `GITHUB_WEBHOOK_SECRET` (the same string you gave GitHub; at least 16 characters, shorter is refused)
4. **Deploy** (note the flag on the webhook: GitHub cannot send a Supabase login token, the signature is the authentication):
   ```powershell
   supabase functions deploy github-webhook --no-verify-jwt
   supabase functions deploy integrations
   ```
5. **Frontend**: deploy to Vercel as usual.
6. In **Admin, Integrations**, the GitHub card has a new **GitHub App** section. When GitHub has reported the installation (it does so as soon as the App is installed and the webhook works), press **Use this installation**. The server mints a real token and makes one real call before saving, and saves nothing if either fails. Then link repositories to departments or projects as before.

The old personal-token connection keeps working until you choose an installation. After that the App is used. Disconnecting GitHub clears both.

## What was built
| Piece | Where |
|---|---|
| App authentication: signs a short-lived JWT, mints installation tokens in memory (never stored), refuses to fall back silently to the shared token if the App is configured but failing | `supabase/functions/_shared/githubApp.ts` |
| Signed webhook receiver: size cap, signature checked before anything is parsed, delivery-id replay protection, only linked repositories get feed rows, no internals in error bodies | `supabase/functions/github-webhook/`, `_shared/githubWebhook.ts` |
| Tables: `github_installations` (Main Admin read only), `github_webhook_deliveries` (service role only), `github_activity` (visible only for repositories the caller may already see) | migration `20261006000000` |
| Failure alerts: a failed build or deployment notifies the owning department's admins and the Main Admin, once per delivery | `record_github_delivery()` |
| Retention: `prune_github_data(days)` (minimum 7). **Not scheduled yet.** | migration |
| Read-only browser actions in `integrations`: `contents`, `readme`, `commits`, `commit`, `branches`, plus `installations` and `select-installation` (Main Admin) | `supabase/functions/integrations/index.ts`, `_shared/github.ts` |
| "Code & activity" tool (files, README, commits with diffs, activity feed) in Frontend, Backend and DevOps | `src/workspaces/tools/GithubCode.tsx` |
| GitHub App panel in Integrations | `src/pages/admin/AdminIntegrations.tsx` |

## Safety properties (each has a test that fails without it)
- A request without a valid signature is refused (401) and **leaves no trace**; an unset secret answers 503, never "accept anything"; a secret under 16 characters never verifies.
- A repeated delivery id changes nothing (an old "suspend" cannot be replayed over a newer state).
- Paths and refs are validated (no `..`, absolute paths, backslashes, control characters, `?`, `#`, `%`); binary files and files over 256 KB return a reason, never content; README text is rendered as text (markup inside it does not run); only `https://github.com/` links are ever shown as links.
- The App token can reach every repository the installation covers, so **which repository a person may open is still decided by the existing row-level security on `integration_repositories`**, using the caller's own session. Workspace membership alone grants nothing.
- Browser sessions cannot call the recording, installation or pruning functions or read the delivery log (tested, including a Main Admin session).

## Test results at hand-over
`npx tsc -b` clean. `npx oxlint src` 26 warnings, 0 errors (unchanged). `node --test tests/*.test.mjs` 369/369. `npx vitest run` 619/619. SQL suite 1008 pass, 0 failed files (the new file: 39 checks). `npm run build` succeeds. Each new test group was also checked by deliberately breaking the code and watching it fail (row-level security, replay handling, grants, alert condition, signature check, installation ordering, link filtering).

## NOT verified (be honest about this)
- **Nothing has run against a real GitHub.** The JWT signing is checked against an RSA key generated locally (and the PKCS#1 to PKCS#8 conversion is byte-identical to OpenSSL's), but whether GitHub accepts it, the exact token response, and real webhook payloads are untested. Expect small differences; report them rather than hiding them.
- The edge functions were type-checked with Deno stubs, never executed in Deno. The receiver's decision logic is tested in Node with a fake database.
- The Code & activity screens were tested with mocked services, not screenshotted in a browser, and not re-run through the accessibility scan harness.
- The IP used by the receiver's rate limit depends on the header your Supabase project receives (same caveat as finding 7 in `UPDATE_SECURITY_AND_UI_REPAIR.md`); it is a generous ceiling, not the security control.

## Known gaps / next
Read-only only: no creating issues, branches or pull requests, no review or merge. No role-to-capability mapping beyond the existing department/project visibility. No Vercel/Netlify deployment centre. `prune_github_data()` needs scheduling. The feed covers push, pull request, review, issue, workflow run and deployment events only. See `CONTINUE.md`, item 6.
