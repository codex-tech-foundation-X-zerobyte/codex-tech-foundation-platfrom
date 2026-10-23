# Development

## Setup

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Supabase

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                    # applies supabase/migrations/ in order
supabase functions deploy           # deploys everything in supabase/functions/
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   # required by edge functions
```

First-time setup also needs the super admin bootstrap — see
`supabase/bootstrap/create-superadmin.sql`'s header comment for the exact
steps (create the Auth user manually first, then run that script with the
user's UUID).

## Checks before pushing anything

```bash
npm run lint
npm test
npm run build
```

All three must pass. If `npm run lint` shows warnings (not errors), read
them — don't assume they're noise. See the project history for examples of
warnings that pointed at real bugs (an unused-import warning once flagged a
leftover `React.ReactNode` reference that would have failed the actual
TypeScript build).

## Deploying (Vercel)

Two things that previously caused a broken/blank deployment, both fixed but
worth knowing:

1. **`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` must be set in your
   deployment platform's own environment variable settings** — `.env` is
   gitignored and never gets deployed. `src/lib/supabase.ts` used to
   silently fall back to a fake placeholder project when these were
   missing, meaning the app would build and deploy fine, then have every
   single Supabase call fail with no visible error. It now throws a clear
   error on startup instead, caught in `main.tsx` and rendered as a visible
   message rather than a blank page — but you still need to actually set
   the real values in Vercel's project settings for both Production and
   Preview environments.
2. **`vercel.json`** at the repo root rewrites every path to `/index.html`
   — without it, Vercel's static file server 404s on direct navigation or
   refresh to any client-side route (`/worker`, `/admin/roles`, etc.),
   since only `/index.html` actually exists as a file. This is a standard
   requirement for any client-side-routed SPA on Vercel, not specific to
   this app.

## CI

`.github/workflows/ci.yml` runs lint/build/test plus a couple of grep-based
guards (no hardcoded service-role/R2 keys in `src/`, no `@ts-ignore`/
`@ts-nocheck`). Written but not run against a real GitHub Actions runner in
the environment this was developed in — verify it actually passes on your
first real push before treating it as a merge gate.

## Project structure

See ARCHITECTURE.md.
