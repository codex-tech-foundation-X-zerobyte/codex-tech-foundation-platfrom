# Codex Tech Foundation

React/TypeScript/Vite public website and Supabase-backed worker, manager, administrator, and client experiences.

**Start here for architecture, schema, auth, and RBAC details:** [`/docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
and the other files in [`/docs`](docs) — they are the maintained source of
truth referenced by `CONTRIBUTING.md`. This README stays intentionally short.

## Architecture

The browser uses only the Supabase publishable (anon) key. Authentication is Supabase Auth with persisted sessions; authorization is enforced by PostgreSQL RLS and the RBAC tables (`roles`, `permissions`, `role_permissions`, and `user_roles` — see `docs/RBAC.md`). Worker and Manager accounts sign in with a Worker ID, resolved server-side by the `resolve-worker-login` Edge Function, which verifies the password itself and returns a session — the account's email is never sent to the browser (see `docs/AUTH-RULES.md`). Private files use authenticated Storage buckets and signed URLs.

Public content is read from published database records. Drafts and private project/client data are never exposed to anonymous users. Business actions that accept public input belong in Edge Functions with server-side validation, rate limiting (`docs/API-CONTRACT.md`), and audit logging.

## Setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Apply all migrations in `supabase/migrations` with the Supabase CLI, in filename order.

Deploy functions:

```powershell
supabase functions deploy resolve-worker-login
supabase functions deploy resolve-client-login
supabase functions deploy create-worker
supabase functions deploy create-client
supabase functions deploy submit-lead
supabase functions deploy submit-contact
supabase functions deploy submit-job-application
supabase functions deploy create-resume-upload-url
```

Configure `SUPABASE_SERVICE_ROLE_KEY` only as an Edge Function secret — never in `.env.local`.

**Bootstrap your first Super Admin** (do not make the first signup an administrator): create the Auth user manually in Supabase Dashboard → Authentication → Users, then run `select public.bootstrap_super_admin('<uuid>', 'Name');` from the SQL Editor. Full detail in `docs/AUTH-RULES.md`.

## Validation

```powershell
npm run lint
npm test
npm run build
```

See `docs/DEVELOPMENT.md` for what has and hasn't actually been verified against this codebase, and the RLS-by-role checklist to run against a real Supabase project before trusting anything here in production.

The PWA service worker caches only the application shell and does not cache authenticated responses. Extend offline support only for explicitly safe mutations with an IndexedDB queue and conflict handling.
