# Update: GitHub Shadow, slice 3 (write access control, audit trail, comments and new issues) (November 2026)

This is the first slice that **changes things on GitHub**. It is deliberately small (two actions) and **everything is off until the Main Admin turns it on, per repository**.

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261007000000_github_write_access.sql`. New tables and functions only.
2. **Deploy**:
   ```powershell
   supabase functions deploy integrations
   supabase functions deploy workspace-sweep
   ```
   then the frontend.
3. **Only when you want people to write:** in the GitHub App's settings, change **Issues** and **Pull requests** from *Read-only* to *Read & write*. GitHub will ask the organisation to accept the change. Until you do this, the screens still work and a write attempt shows a plain message ("The GitHub App is not allowed to write here...") instead of failing silently. Keeping the App read-only is a valid way to keep writing switched off at GitHub's end too.
4. In **Admin, Integrations**, under each linked repository there are now two switches, **Comments** and **New issues**, each **Off**, **Admins only** or **Everyone who can see it**. They are locked until the GitHub App connection is used (writes never use the old shared token).

## Who can do what
| Level | Who |
|---|---|
| **Off** (default) | Nobody, including the Main Admin. It is a kill switch. |
| **Admins only** | The Main Admin, the admins of the repository's department, or the owner of the project the repository is linked to. |
| **Everyone who can see it** | Any internal user (worker, manager, Main Admin) who can already see that repository. |
| Clients | Never, at any level, even if they can see a repository they own the project of (tested). |

Being able to see a repository never grants writing. A Frontend member cannot write to a Backend repository even at the widest level, because they cannot see it.

## What was built
| Piece | Where |
|---|---|
| Per-repository policy, default off, changed only by the Main Admin through a function that also writes `audit_logs` | `github_repo_policy`, `set_github_repo_policy()` |
| The decision `github_can(repo, capability)`: runs under the **caller's own** row-level security, so an invisible repository is simply "no" | migration |
| Audit trail of every attempt (`github_actions`): allowed, failed **and refused**. The Main Admin sees all, a person sees their own | migration |
| `begin_github_action` (service role): refuses a repeated request id, caps a person at 20 changes per 10 minutes. `finish_github_action`: closes it once; success also writes `audit_logs` | migration |
| `expire_github_actions()`: a request that never got an answer is closed as failed after 10 minutes (runs from the sweep) | migration, `workspace-sweep` |
| The order of every write: validate, App credential, ask the database, record, call GitHub, confirm, record the outcome | `_shared/githubWrite.ts`, `integrations` actions `comment`, `create-issue` |
| Comment box on issues and pull requests, "New issue" form, shown only when allowed | `GithubCompose.tsx` |
| Per-repository switches and a "Recent GitHub changes" history in Integrations | `AdminIntegrations.tsx` |

## Safety properties (each has a test that fails without it)
- The permission question is asked of the database **with the caller's own session**, after the repository-visibility check; the actor recorded is the verified caller, never a value from the request.
- A refused attempt is recorded as `denied` and **GitHub is never contacted**. The shared personal token cannot write at all.
- The attempt is recorded **before** GitHub is called; a repeated request id (double click, retry) is refused; success is claimed **only** when GitHub returns an id and a `github.com` link, otherwise the row says failed and the screen says nothing was confirmed.
- Comments and issues go out as the App, signed with the person's name (reduced to plain letters, so a hostile display name cannot inject links or mentions). Text is trimmed and bounded (comment 8,000 characters, title 256) and rejected if it contains control characters.
- The policy and audit tables cannot be written from a browser at all; only the functions can.

## Test results at hand-over
`tsc -b` clean. oxlint 26 warnings, 0 errors (unchanged). `node --test` 398/398. `vitest` 631/631. SQL suite 1057 pass, 0 failed files (the new file has 49 checks). `npm run build` succeeds. Edge functions type-check with Deno stubs. Each guard was proven by deliberately breaking it (visibility ignored, kill switch bypassed, replay allowed, rate limit loosened, finished action rewritable, clients allowed, GitHub called when denied, personal token allowed, success claimed without GitHub confirming, writing before recording, permission asked with the service role, actor taken from the body, controls unlocked without the App, text lost on failure, box shown without permission).
One test caught a real bug during the build: the policy table is Main Admin only, so the permission function could not read it for anyone else and every ordinary user looked "off". It now reads the level through one narrow helper (`github_policy_level`).

## NOT verified
- **No write has been made to a real GitHub.** The request shape follows GitHub's documented REST API (`POST /repos/{repo}/issues/{n}/comments`, `POST /repos/{repo}/issues`) but is unproven. The first real comment should be made on a throwaway repository.
- The edge functions were type-checked, not run in Deno. The screens were tested with mocked services, not opened in a browser or run through the accessibility scan.

## Known limits (deliberate)
- Each click gets a new request id. If the server did the work but the answer was lost on the way back, pressing the button again would post twice. The history shows what was posted.
- Comments appear on GitHub as the App (with "Posted from Codex Workspace by <name>"), not as the person's own GitHub account. Acting as the person needs per-user GitHub sign-in, which is a separate, larger decision.
- Audit rows are kept indefinitely (the feed and delivery log are pruned at 90 days; audit is not).
- Not built: line-level review comments, submitting a review or approval, editing or deleting a comment, labels and assignees on new issues, creating branches or pull requests, merging, repository creation. See below.

## How to add the next capability (e.g. `review`, `merge`)
1. Migration: add a `<name>_level` column to `github_repo_policy` (default `'off'`), extend `github_can`, `github_policy_level`, `github_capabilities`, `set_github_repo_policy` and the `github_actions.action` check. 2. Add the validator and path to `githubWrite.ts` and a test for it. 3. Add the action to `integrations`. 4. Add the switch and the button. Merge in particular must never report success unless GitHub confirms it, and must leave GitHub's branch protection in charge.
