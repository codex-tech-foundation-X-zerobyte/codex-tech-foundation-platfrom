# Deployment

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

## Git workflow

```powershell
git add .
git commit -m "describe the change"
git push
```

Once the repo is connected to Vercel (below), every push does the rest
automatically — you do not run a separate deploy command.

- Push/merge to `main` → production deployment, overwrites your production URL.
- Push to any other branch, or open a Pull Request → a preview deployment
  with its own unique URL, production is untouched.

## Connecting the repo to Vercel (one-time)

1. Push this repo to GitHub if it isn't there yet (see below).
2. vercel.com → **Add New → Project** → import the GitHub repo.
3. Vercel should auto-detect **Vite** as the framework. If it offers a
   framework dropdown, confirm it says "Vite", not "Next.js" or "Other" —
   picking the wrong one is a common cause of a blank deployed page.
4. **Root Directory**: leave as the repo root, unless this project lives in
   a subfolder of a larger repo — if so, set Root Directory to that
   subfolder. Getting this wrong is another common blank-page cause: Vercel
   builds the wrong `package.json` (or none at all).
5. **Build Command**: `npm run build` (this runs `tsc -b && vite build` —
   see `package.json`).
6. **Output Directory**: `dist` (Vite's default; do not point this at `src`).
7. **Environment Variables** (Project Settings → Environment Variables) —
   add both, for all three environments (Development/Preview/Production):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Optionally also `VITE_CONTACT_EMAIL` / `VITE_CONTACT_WHATSAPP_URL` if
   you want the public Contact page to show real values instead of "Not yet
   configured."
8. Deploy.

**Never add `SUPABASE_SERVICE_ROLE_KEY`, or any Vercel/GitHub token, as a
`VITE_*` variable.** Anything prefixed `VITE_` is bundled into the
JavaScript that ships to every visitor's browser — it is not private, no
matter how it's stored in Vercel's dashboard. The service-role key only
ever belongs in Supabase's own Edge Function secrets (`supabase secrets
set`), never in this app's environment variables.

## `vercel.json`

This repo includes one, and it needs to stay:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This is required because the app is a client-side-routed SPA (React
Router). Without it, Vercel serves a real 404 for any URL that isn't
exactly `/` — including refreshing the page on `/admin`, `/worker/chat`,
or any route a user navigates to directly instead of clicking through from
the homepage. If you ever see "blank page on refresh, works on first
load," this file (or its absence) is the first thing to check.

## GitHub Pages (optional second deployment target)

`.github/workflows/pages.yml` builds and deploys this app to GitHub Pages
on every push to `main`, producing a real
`https://<your-github-username>.github.io/<repo-name>/` URL — shown in the
workflow run's summary and in Settings → Pages once it's run at least once.

**One-time setup:**
1. Repo → Settings → Pages → **Source: GitHub Actions** (not "Deploy from a branch").
2. Repo → Settings → Secrets and variables → Actions → add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as **repository
   secrets**. These are separate from Vercel's environment variables — the
   two platforms don't share them, so both need to be configured
   independently if you use both.
3. Push to `main`. Check the Actions tab for the run; the deployed URL
   appears there once it succeeds.

**Why this needed more than "just deploy the dist folder"**: unlike
Vercel, GitHub Pages has no server-side rewrite capability — there's no
equivalent of `vercel.json`'s SPA rewrite rule. Without a workaround, a
direct visit or a page refresh on any nested route (e.g. `/admin/workers`)
would 404. `public/404.html` + the inline script in `index.html`'s `<head>`
implement the standard, widely-used fix for this (the
[rafgraph spa-github-pages pattern](https://github.com/rafgraph/spa-github-pages)):
GitHub Pages serves `404.html` for the unmatched route, which re-encodes
the path and redirects to `index.html`, and a script there decodes it back
with `history.replaceState` before React Router ever initializes. This was
verified with an actual encode/decode round-trip test (including a route
with both query params and a hash fragment) before shipping, not assumed
correct from memory.

Also unlike Vercel (root domain), a GitHub Pages *project* site is served
from a subpath (`/<repo-name>/`) — every asset URL needs that prefix. The
workflow derives this from the real repository name automatically
(`github.event.repository.name`) and passes it to the Vite build as
`VITE_BASE_PATH`; `vite.config.ts` reads that env var for `base`, and
defaults to `/` when it's unset (which is what happens on every Vercel
build, since Vercel never sets it) — so the same codebase builds correctly
for both targets without manual toggling.

**One thing this does NOT currently need, but will if a feature changes
this**: with only Worker-ID / Client-ID / Super-Admin-email sign-in (no
password-reset or magic-link flow exists in the UI yet — see
AUTH-RULES.md), there's no dependency on Supabase's Site URL/redirect URL
configuration. If a password-reset or magic-link flow is added later,
*both* the Vercel and GitHub Pages domains would need to be added to
Supabase's allowed redirect URLs at that point.

**Vercel remains the recommended primary deployment** — it needs none of
the above workaround, supports preview deployments per branch/PR, and (per
the definitions repo brief) is what production traffic should point at.
GitHub Pages here is a genuine, working secondary target, not a
replacement.

## Troubleshooting a blank deployed page

In rough order of how often each one is actually the cause:

1. **Open the deployed URL, then open browser DevTools → Console.** A
   blank page with a red error in the console (not a blank console) is
   almost always the real answer — read the actual error before guessing.
   Common ones:
   - `Failed to fetch` / Supabase client throwing on init → `VITE_SUPABASE_URL`
     or `VITE_SUPABASE_ANON_KEY` is missing or wrong for this environment
     (Preview vs Production have separate env var sets in Vercel — confirm
     both are filled in, not just Production).
   - A 404 on a `.js` module in the Network tab → usually a Root Directory
     or Output Directory misconfiguration (see steps 4/6 above) — the build
     succeeded but Vercel is serving from the wrong folder.
   - Nothing in console, blank white page, page title is correct → check
     the Network tab for the initial HTML document; if the *document
     itself* 404s on a nested route, `vercel.json` is missing or wrong.
2. **Check the Vercel build log itself** (not just "deployment succeeded").
   A build can succeed and still produce a broken app if, for example, an
   environment variable that's read at build time (none currently are —
   all Supabase config here is read at runtime) was missing.
3. **Confirm the framework preset is Vite**, not auto-detected as something
   else — Project Settings → General → Framework Preset.
4. **Hard-refresh** (Ctrl+Shift+R) before concluding anything — a stale
   service worker or browser cache showing an old broken build is
   indistinguishable from a live broken deployment until you rule it out.

## Supabase production configuration

Authentication → URL Configuration, in your Supabase project:
- **Site URL**: your production Vercel URL (e.g. `https://your-app.vercel.app`).
- **Redirect URLs**: add both your production URL and, if you want password
  recovery/magic links to work from preview deployments too, a wildcard
  like `https://*-your-vercel-team.vercel.app/**` (Vercel preview URLs are
  unique per deployment, so a wildcard is the practical option — an exact
  URL allowlist would need updating on every single preview).

## GitHub Actions CI (optional, lightweight)

If you want a build to be blocked from looking "done" before Vercel even
tries to deploy it, add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

This does not deploy anything — Vercel's own Git integration still owns
deployment. This only fails the GitHub check (visible on PRs) if lint,
build, or tests fail, so a broken PR is visible before it's merged to `main`.

## Rollback

Vercel Dashboard → your project → Deployments → find a previous known-good
deployment → **⋯ → Promote to Production**. This does not require a new
Git push or revert commit; it re-points production at an already-built
deployment instantly.
