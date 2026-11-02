# Update: GitHub Shadow, slice 2 (pull requests, issues, scheduled clean-up) (November 2026)

Read-only again. Nothing in this slice writes to GitHub. **No new migration.** If slice 1 is applied, only deploys are needed.

## Apply
```powershell
supabase functions deploy integrations
supabase functions deploy workspace-sweep
```
Then deploy the frontend. (`workspace-sweep` only does something if you have scheduled it with `WORKSPACE_SWEEP_SECRET`; see `UPDATE_CUSTOMER_SERVICE.md`. If it is not scheduled, the GitHub clean-up does not run either, and the delivery log and feed simply keep growing.)

## What was built
| Piece | Where |
|---|---|
| **Scheduled clean-up:** every sweep calls `prune_github_data(90)`, so the delivery log and feed keep 90 days. It runs in its own isolated step: a failure there cannot stop monitoring or support. | `supabase/functions/workspace-sweep/index.ts` |
| **Pull request detail:** description, state (open, closed, merged), draft, labels, requested reviewers, review list, conversation, changed files with diffs, and CI check status for the head commit. | `integrations` action `pull-detail`, `_shared/github.ts` (`slimPullDetail`, `summariseChecks`) |
| **Pull request list with a filter** (open, closed, all). | `pulls` action now accepts `state` (default still `open`) |
| **Issues:** list with filter and "load more", detail with labels, assignees, milestone and conversation. Pull requests that GitHub lists as issues are left out. | `issues`, `issue-detail` |
| **Screens:** two new tabs in Code & activity, **Pull requests** and **Issues**, each with a list and a detail view. | `src/workspaces/tools/GithubWork.tsx` |

## Honesty rules built in (each has a test that fails without it)
- A pull request's **conflict status is shown as "not ready yet" when GitHub has not computed it** (it computes lazily), never as "no conflicts".
- **CI status:** "No checks reported" is not "passing"; if the token lacks the Checks permission the screen says "Checks unavailable", never "passing". A failing check is shown on the pull request even when it has approvals.
- Descriptions, reviews and comments are untrusted text written by anyone with GitHub access. They go through the safe Markdown renderer (a `<script>` in a description is shown as text, not run). Only `https://github.com/` links become links.
- Limits so a huge pull request cannot flood the page: description 10,000 characters, each comment 4,000, the newest 30 comments and 30 reviews, 60 files per pull request, 20,000 characters per diff. When something is cut, the screen says so and links to GitHub.
- The pull request or issue number and the filter are validated before GitHub is called. Opening a pull request number through the issue endpoint is refused.
- Who may see a repository is unchanged: the existing row-level security on linked repositories, using the caller's own session.

## Results at hand-over
`tsc -b` clean. oxlint 26 warnings, 0 errors (unchanged). `node --test` 378/378. `vitest` 623/623 (the new tool file has 14 tests). SQL suite unchanged and re-run (see the final numbers in the hand-over message). `npm run build` succeeds. Edge functions type-check with Deno stubs. The mutation checks (mergeability wording, failing-check wording, "no checks" treated as passing, removed number validation) were each caught by a test.

## NOT verified
- Still nothing has run against a real GitHub. Real pull request and check-run payloads may differ from what I coded against: field names are from GitHub's documented API.
- The GitHub App needs the **Checks: read** permission for CI status. Slice 1's list did not include it. Without it the screen shows "Checks unavailable". Add it in the App's permissions (GitHub will ask each organisation to accept the change).
- The new screens were tested with mocked services, not opened in a browser or run through the accessibility scan.
- `workspace-sweep` has not been run in Deno.

## Next (needs your decision before building)
Write actions (comment, create issue, create branch or pull request, review, merge) each with its own permission, an audit row and a test; role-to-capability mapping; a Vercel or Netlify deployment centre. See `CONTINUE.md`, item 6.
