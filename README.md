# Codex Tech Foundation

React/TypeScript/Vite public website and Supabase-backed worker, administrator, and client experiences.

## Architecture

The browser uses only the Supabase publishable (anon) key. Authentication is Supabase Auth with persisted sessions; authorization is enforced by PostgreSQL RLS and the RBAC tables (`roles`, `permissions`, `role_permissions`, and `user_roles`). Worker IDs are resolved server-side by the `resolve-worker-login` Edge Function and are never treated as passwords. Private files use authenticated Storage buckets and signed URLs.

Public content is read from published database records. Drafts and private project/client data are never exposed to anonymous users. Business actions that accept public input belong in Edge Functions with server-side validation, rate limiting, and audit logging.

## Setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Apply all migrations in `supabase/migrations` with the Supabase CLI. Configure `SUPABASE_SERVICE_ROLE_KEY` only as an Edge Function secret.

Deploy functions with `supabase functions deploy resolve-worker-login`. Provision the first administrator deliberately in Supabase; do not make the first signup an administrator.

## Validation

```powershell
npm run lint
npm test
npm run build
```

The PWA service worker caches only the application shell and does not cache authenticated responses. Extend offline support only for explicitly safe mutations with an IndexedDB queue and conflict handling.
