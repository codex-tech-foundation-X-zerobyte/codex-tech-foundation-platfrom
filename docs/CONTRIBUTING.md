# Contributing

## Before you build anything

1. Read `/docs/ARCHITECTURE.md`, and whichever of `/docs/DATABASE-SCHEMA.md`,
   `/docs/RBAC.md`, `/docs/AUTH-RULES.md`, `/docs/API-CONTRACT.md`,
   `/docs/REALTIME.md`, `/docs/FILE-STORAGE.md`, `/docs/NOTIFICATIONS.md` are
   relevant to what you're touching.
2. Search the repository for the concept you're about to add — a table, a
   type, a service function, a permission key, an edge function. If it
   already exists, use it. Don't create a second implementation.
3. If something is genuinely missing: add it to the relevant doc above,
   implement it, and make sure the doc still matches reality when you're
   done. A doc that describes something that doesn't exist is worse than no
   doc.

## Hard rules (apply to humans and AI agents alike)

- One canonical table per concept. If you think you need a second `settings`
  table or a second `audit_log`, you're wrong — extend the existing one.
- `profiles.role` is for routing/coarse classification. Real authorization
  is `has_permission()` / RLS. Don't add a new `role === 'x'` check in
  application code where a permission check belongs — see RBAC.md.
- RLS is the actual security boundary. A frontend check that hides a button
  is UX, not security — the underlying table must still be protected.
- Never put the Supabase service-role key, R2 credentials, or any other
  server secret in frontend code or a `VITE_*` env var.
- Don't disable TypeScript checks, RLS, or tests to make something pass.
  Fix the actual problem.

## Git workflow (target — not yet enforced by tooling in this repo)

`main` is the deployable branch. Feature branches per change, PR before
merge, at minimum a build+lint+test pass before merging (see `package.json`
scripts — `npm run lint`, `npm test`, `npm run build`). No CI pipeline exists
in this repository yet to enforce this automatically; it's a process rule
until one is added.
