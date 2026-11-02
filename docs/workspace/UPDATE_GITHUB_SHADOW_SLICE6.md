# Update: GitHub Shadow, slice 6 (setup guide) (November 2026)

So that nothing is missed when you connect GitHub (and optionally Vercel) for the first time. **No migration, no new function, no new permission.** Deploy the frontend only.

## What you get
1. **`docs/workspace/GITHUB_SETUP_GUIDE.md`** - the complete written guide, from "before you start" to "looking after it": exact values to type, the three database files in order, the three deploy commands, the webhook secret, every field of the GitHub App form, the secrets, installing, the connection check with a fix for every message it can show, choosing the installation, linking repositories, proving the webhook, scheduling the background job, the optional write access and Vercel steps, rotating keys, what to do if something leaks, and a final "things people most often miss" checklist.
2. **An in-app Setup guide** at the top of the GitHub card (Admin, Integrations). Twelve steps, each with why, exactly what to do, **copy buttons** for every value (your own webhook address is already filled in from your project), and how you will know it worked. It shows **"Do this next"**, and "N of 10 required steps done".
3. **It ticks itself off from the connection check**, so a step is Done only when GitHub, Supabase or Vercel really say so. Before the check has run, nothing says Done. Two steps cannot be detected from here (deploying the functions before the webhook has ever worked, and scheduling the background job), so you tick those yourself; they are labelled that way and the tick is saved in this browser only.
4. **A "Make a secret" button** for the webhook secret: 64 random characters made in your browser, shown once, never saved and never sent anywhere (a test checks no request is made and nothing is stored).
5. **A test that keeps both guides honest.** It fails if a migration, secret, permission, event or function is added to the code and not to the guides, if the in-app and written guides disagree (including step order), if a deploy command stops matching a real function or loses `--no-verify-jwt`, or if a token, key or hex secret ever appears in either guide.

## How to use it
Open Admin, Integrations, GitHub. Work down the Setup guide. After each step press **Run the check** (in the Connection check section just below) and watch the steps update. The written guide has the same steps in the same order if you prefer to read it on its own.

## Test results at hand-over
`tsc -b` clean. oxlint 26 warnings, 0 errors (unchanged). `node --test` 437/437. `vitest` 668/668. SQL suite 1082 pass, 0 failed files (unchanged). `npm run build` succeeds. Breaking each rule on purpose was caught by a test: "done" without a report, optional steps counted as required, a failing webhook taken as proof of deployment, missing events ignored, the scheduler marked done unprompted, the secret saved to the browser, removed installations counted as installed, the guide not shown in the card, the guide not told about the report, a new migration or secret or permission missing from the guides, a command losing its flag, two steps swapped, and a token pasted into the written guide. One mutation survived at first (my events test also had a failing permission, so it could not tell); I added a test for that case and re-proved it.
Three older tests started failing because the guide repeats words they searched for (secret names, "refused the signature"). I made those assertions precise instead of loosening them; two of them had been passing partly for the wrong reason.

## NOT verified
- **The guide's menu names for GitHub, Supabase and Vercel are from memory and were not checked against the live sites** (the guide says so at the top). The GitHub App form fields, the Supabase secrets page and the Vercel token page are the likeliest places for a name to differ.
- The command-line way of setting the private key (`supabase secrets set GITHUB_APP_PRIVATE_KEY="$(Get-Content -Raw ...)"`) was not tested; the guide says to use the dashboard if it gives trouble.
- "If a secret still shows as not set, redeploy `integrations`" is a precaution, not something I confirmed is needed.
- The screens were tested with mocked services, not opened in a browser, and not run through the accessibility scan.
- Everything underneath (slices 1 to 5) is still unproven against a real GitHub and Vercel. That is what the guide plus the connection check are for.
