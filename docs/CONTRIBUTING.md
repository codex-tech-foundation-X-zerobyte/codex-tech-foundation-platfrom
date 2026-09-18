# Contributing

## Before you (human or AI) change anything

Read, in this order: `ARCHITECTURE.md` → `DATABASE-SCHEMA.md` →
`AUTH-RULES.md` → `RBAC.md` → (`REALTIME.md` / `FILE-STORAGE.md` /
`NOTIFICATIONS.md` if relevant to your task) → `src/lib/types.ts` →
`src/lib/services/`.

**Do not invent**, if an existing implementation already defines it:
- an API route or Edge Function shape (check `supabase/functions/` and `API-CONTRACT.md`)
- a database table or column (check `supabase/migrations/` and `DATABASE-SCHEMA.md`)
- a storage bucket (check `DATABASE-SCHEMA.md`'s bucket table)
- a permission key or role (check `RBAC.md`)
- a shared TypeScript type (check `src/lib/types.ts`)
- a response format (match whatever's already returned by similar Edge Functions)

**If something is genuinely missing**: say so explicitly in your output
before building around it, add it to the canonical schema/docs, implement
it once, and use it everywhere — don't create a second competing version
"just for this feature."

## Workflow

```
main
 │
 ├─ feature/<short-name>   (branch per feature: chat, files, calls, ...)
 │     │
 │     ├─ implement
 │     ├─ update the relevant /docs file in the SAME change
 │     └─ open a pull request
 │
 └─ review → merge to main
```

Do not push directly to `main`. Every migration file is permanent once
merged — fix forward with a new migration, never edit a merged one.

## Code organization rules

- Supabase queries belong in `src/lib/services/<domain>.ts`, never inline in
  a page component. If you're about to write `supabase.from(...)` inside a
  `.tsx` file, stop and check whether a service function already exists —
  or add one.
- One TypeScript interface per concept in `src/lib/types.ts`. Don't
  redeclare `Project`, `Task`, etc. locally in a page.
- New Edge Functions: copy the shape of an existing one (CORS object,
  `OPTIONS` handling, generic error responses, `check_rate_limit()` call for
  any public/lightly-authenticated endpoint) rather than writing a new
  pattern from scratch.
- New RLS policies: prefer additive policies over modifying an existing
  policy's condition, unless you're deliberately narrowing an over-broad
  one (and if so, say so in a migration comment — see
  `20260913000000_rls_audit_fixes.sql` for the documentation style to
  match).

## Definition of done for a feature (per the project brief)

UI + service + database + RLS + authentication + authorization + validation
+ error handling + real data, connected end to end. A page that renders but
has no working backend behind it is not done — mark it as a `ScaffoldPage`
with an honest description instead of pretending otherwise.

## What you cannot verify in a sandboxed/offline environment — say so

If you don't have network access to run `npm install && npm run build && npm
test`, or don't have live Supabase credentials to apply migrations and
exercise RLS against real requests, say exactly that instead of claiming a
build or test passed. See `DEVELOPMENT.md` for the actual verification
checklist to run once real access is available.
