# Update: GitHub Shadow, slice 5 (connection check) (November 2026)

Slices 1 to 4 were all built and tested without ever touching a real GitHub or Vercel. This slice is how you find out, in one click, whether the live connection actually works, and exactly what to fix when it does not. **It changes nothing and reads only.** No new migration, no new GitHub permission.

## Apply
```powershell
supabase functions deploy integrations
```
then the frontend. In **Admin, Integrations**, the GitHub card has a new **Connection check** section (shown even before GitHub is connected). Press **Run the check**. It never runs by itself, because it calls GitHub and Vercel.

## What it checks, and what each answer means
| Group | Check | What it tells you |
|---|---|---|
| Server settings | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `VERCEL_TOKEN` | Set or not set. For the key: whether it can actually sign (a wrongly pasted key is caught). For the webhook secret: whether it is long enough for the receiver to accept it. **Values are never shown.** Vercel is optional. |
| GitHub | App sign-in | Whether GitHub accepts the App id and key together, and the App's name. |
| GitHub | App permissions (read) | Which of the read permissions the App is missing (including **Checks**, the easy one to forget), in plain words. |
| GitHub | App permissions (write) | Whether the App is allowed to write issues and pull request comments. Read-only is reported as a valid choice, not an error. |
| GitHub | App webhook events | Which events the App is not subscribed to (the activity feed would miss them). |
| GitHub | Installation | Whether a token can be made for the installation chosen in Integrations, and whether it can list repositories. |
| GitHub | Permissions granted to the installation | The real permissions the organisation has granted, compared with what the App asks for. If you changed the App's permissions and an organisation owner has not accepted yet, it says exactly that, instead of blaming the App. |
| GitHub | Webhook deliveries | GitHub's own log of its last 10 calls to your receiver and the status your receiver answered. **A wrong secret is diagnosed here:** a refused request leaves no trace in our database by design, so GitHub's log is the only place it shows. It says: 401 means the secret in Supabase does not match the one in the App; 404 means wrong URL or function not deployed; 503 means the secret is not set on the server; other 5xx means look at the function logs. |
| Database | Migrations | Which of the three GitHub migration files have not been run, by name, from which tables answer. It does not tell you to re-run ones that are fine. |
| Vercel | One line per connected project | Whether Vercel answers for that project, or Vercel's reason in plain words. |

The overall verdict is **All clear** only when everything that could run is fine, **Check this** for warnings, **Needs fixing** for any failure. Anything that could not run (for example, installation checks before an installation is chosen) is shown as **Not checked**, never as OK.

## Suggested order for your first live setup
Run the check, fix the top item, run it again. Typically: secrets first, then the migrations it names, then App permissions (including Checks), then the installation, then webhook deliveries (make a change in a repository or use **Redeliver** in the App's Advanced tab).

## Safety properties (each has a test that fails without it)
- Main Admin only, checked first. It sits before the GitHub credential is needed, so it can diagnose a connection that does not work yet.
- **Read-only:** the action contains no GitHub write call, no database write and no RPC (a test fails if one is added).
- **No secret leaves the server:** only presence flags are passed in, the response contains only findings, the webhook secret is measured and never printed, and a test fails if any secret variable appears in a response.
- It never runs on its own in the browser, and findings are rendered as text, not HTML.
- The new `permissions` field on the installation token is filtered to plain `name: level` pairs.

## Test results at hand-over
`tsc -b` clean. oxlint 26 warnings, 0 errors (unchanged). `node --test` 428/428. `vitest` 643/643. SQL suite 1082 pass, 0 failed files (unchanged: no migration in this slice). `npm run build` succeeds. Edge functions and shared modules type-check. Breaking each rule on purpose was caught by a test: a lower permission level counted as met, a read-only App treated as an error, the Checks permission not required, a newest failed delivery looking healthy, unaccepted permissions blamed on the App, the overall verdict hiding failures, the check open to everyone, a key leaked into the response, a database write added, a secret printed, the panel running by itself, a skipped check shown as OK, and the verdict always saying "All clear".
Two of my own tests were wrong the first time (a count that assumed two responses; a query that matched the card title as well) and were corrected, and the mutations were re-run afterwards so they prove something.

## NOT verified (this is the honest part)
- **This slice is the tool that verifies the rest, and it has not itself run against a real GitHub.** It uses these GitHub endpoints, which I took from GitHub's documented REST API: `GET /app` (authenticated as the App; returns `permissions` and `events`), `GET /app/hook/deliveries` (authenticated as the App; returns each delivery's `status_code`, `delivered_at`, `event`), `POST /app/installations/{id}/access_tokens` (returns `permissions`) and `GET /installation/repositories`. If one answers differently from what I expected, the corresponding finding will say it could not read it and the rest still works.
- The delivery log needs the App to have a webhook configured; without one it will show "GitHub has not sent any deliveries yet".
- Not opened in a browser or run through the accessibility scan.

## What I would do next
Run the check, send me what it says (the findings contain no secrets), and fix whatever it names. After that the unproven pieces are: the first real comment on a throwaway repository, and the first real Vercel project. Merges, branch creation and reviews should wait until those two are proven. See `CONTINUE.md`, item 6.
