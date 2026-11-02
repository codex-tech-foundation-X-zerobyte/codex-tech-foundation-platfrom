# Update: GitHub Shadow, slice 4 (deployment centre, read-only, Vercel) (November 2026)

Shows what Vercel is deploying for each linked repository: whether production is healthy, and the recent history with commit, branch, author and time. **Read-only: nothing here can deploy, redeploy, roll back, cancel or change anything in Vercel.** No new GitHub permissions are needed.

I picked this slice rather than reviews, branches or merges because: approving a pull request as the App would be posted by a bot, not by the person, so it would misattribute approvals; merging and branch creation need broader GitHub permissions and should wait until the live GitHub flow has been proven. Netlify is not built: `deployment_targets.provider` is a column so it can be added without reshaping anything.

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261008000000_deployment_targets.sql`.
2. **Create a Vercel access token** (Vercel, your account menu, Settings, Tokens) and add it as the Edge Function secret **`VERCEL_TOKEN`** (Supabase, Edge Functions, Secrets). Do not put it anywhere else.
   - Vercel tokens cannot be limited to read-only. This code only ever sends GET requests to one endpoint (a test fails if a write method or a deploy/rollback endpoint is ever added), but the token itself could do more if it leaked. If your Vercel plan has a **Viewer** role for team members, create the token from an account with that role so the token itself cannot change anything. I could not verify your plan's options.
3. **Deploy**:
   ```powershell
   supabase functions deploy integrations
   ```
   then the frontend.
4. In **Admin, Integrations**, under each linked repository there is now **Vercel project (name or id)** and **Vercel team (optional)**. Enter the project's name (or its `prj_...` id from Vercel, project Settings, General). If the project belongs to a team, enter the team id (`team_...`) or its URL slug. Press **Connect deployments**. A line at the top of the list tells you if `VERCEL_TOKEN` is not set yet.
5. People who can see the repository now have a **Deployments** tab in Code & activity.

## What people see
- A **Production** summary judged on the **newest production deployment only**: finished successfully, failed, in progress, canceled, unrecognised, or none found. If the newest failed, the last good one is shown beside it ("visitors are probably still seeing that one"), so an old success can never hide a new failure.
- The wording is deliberately modest: *"finished successfully"* means what Vercel reports, and the screen says it does **not** check that the website is answering.
- The recent history (latest 20): production or preview, state, commit message, branch, short commit id, author, time, and a link. Links are only shown for `https://<name>.vercel.app` hosts (and Vercel's own inspector pages); anything else is not turned into a link.
- Clear messages when the repository has no Vercel project connected, when the server has no token, and when Vercel rejects the token or cannot find the project.

## Safety properties (each has a test that fails without it)
- Who may see deployments is the same rule as the repository itself: the server checks the caller can see the repository **under their own session** before any Vercel call, and reads the mapping under the caller's session too (never the service role).
- The Vercel project and team come **only** from the stored mapping, never from the request. A hostile project or team value never reaches the network.
- The token is read from the server environment, never put in any response, never handled by browser code; Vercel's own error text is never echoed.
- Only the Main Admin can connect or disconnect a mapping (database functions; the table is not browser-writable) and every change is written to `audit_logs`. Mappings disappear when a repository is unlinked.
- An unknown Vercel state is shown as "Unknown", never as success; previews never count as production.

## Test results at hand-over
`tsc -b` clean. oxlint 26 warnings, 0 errors (unchanged). `node --test` 412/412. `vitest` 639/639. SQL suite 1082 pass, 0 failed files (the new file has 25 checks). `npm run build` succeeds. Edge functions type-check with Deno stubs. Everything above was proven by deliberately breaking it: visibility, Main Admin checks, table grants and the project-reference check in SQL; links to non-Vercel hosts, unknown state treated as ready, an old success hiding a failed latest deployment, previews counted as production and an unvalidated project reference in the Vercel module; the mapping read with the service role, the project taken from the request, an unrestricted status check and a added write method in the wiring tests; and in the screens a failed deployment shown as live, the last-good line hidden, links without `noopener`, and Connect enabled with no project.
The Vercel request and response shape was checked against Vercel's published REST documentation (`GET /v6/deployments` with `projectId`, `teamId` or `slug`, `target`, `limit`; response fields `uid`, `url`, `created`, `readyState`/`state`, `target`, `inspectorUrl`). The documentation pages I found did **not** show the Git commit details (`meta.githubCommit...`) I read for message, branch, commit and author; they are treated as optional, and a deployment without them still shows correctly (without those details).

## NOT verified
- **Nothing has run against a real Vercel.** The first real check is to connect one project and open the Deployments tab. Whether commit details appear depends on Vercel's actual response.
- Only the latest 20 deployments and latest 10 production deployments are fetched; there is no paging.
- The edge function was type-checked, not run in Deno. The screens were tested with mocked services, not opened in a browser or run through the accessibility scan.

## Not built
Redeploy, rollback, promote, environment variables, logs, domains, Netlify, deployment alerts (failed GitHub-reported deployments already notify admins through slice 1's webhook feed). See `CONTINUE.md`, item 6.
