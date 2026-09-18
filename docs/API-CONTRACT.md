# API Contract — Edge Functions

All Edge Functions live in `supabase/functions/<name>/index.ts`, are invoked
via `supabase.functions.invoke('<name>', { body })`, and share this shape:
CORS via a shared `cors` header object, `OPTIONS` short-circuited, errors
returned as `{ error: string }` with a 4xx/5xx status, success as JSON with a
`Content-Type: application/json` header. Every one of these that accepts
anonymous or lightly-authenticated input is rate-limited via
`check_rate_limit()` (see DATABASE-SCHEMA.md).

Do not create a new Edge Function for something one of these already does.
Do not duplicate validation logic that already exists in one of these —
extend it.

## `submit-lead` — public, unauthenticated
Used by the "Start a Project" form and general lead capture.
- **Request**: `{ name, email, company?, source?, message? }` — or the
  Start-a-Project shape (`project_type`, `problem`, `desired_outcome`,
  `budget?`, `timeline?`, `existing_system?`, `phone?`, `additional_info?`),
  which is composed into `message` server-side.
- **Response**: `{ ok: true }` or `{ error }`.
- **Rate limit**: 5 / 10 min per IP.
- **Writes**: `leads` (service role).

## `submit-contact` — public, unauthenticated
- **Request**: `{ name, email, message }`.
- **Response**: `{ ok: true }` or `{ error }`.
- **Rate limit**: 5 / 10 min per IP.
- **Writes**: `leads` with `source: 'contact'`.

## `submit-job-application` — public, unauthenticated
- **Request**: `{ career_id, name, email, cover_note?, resume_path? }`.
  `resume_path` comes from `create-resume-upload-url` below.
- **Validates**: `career_id` refers to a career that is published and not archived.
- **Response**: `{ ok: true }` or `{ error }`.
- **Rate limit**: 5 / 10 min per IP.
- **Writes**: `applications`.

## `create-resume-upload-url` — public, unauthenticated
- **Request**: `{ filename }` (only `.pdf`/`.doc`/`.docx` accepted).
- **Response**: `{ path, token, signedUrl }` — a single-use Supabase Storage
  signed upload URL scoped to a random path in the private `applications`
  bucket. The browser uploads directly to `signedUrl`; the resulting `path`
  is then passed to `submit-job-application`.
- **Rate limit**: 10 / 10 min per IP.

## `resolve-worker-login` — public, unauthenticated (this IS the login step)
- **Request**: `{ worker_id, password }`.
- **Response on success**: `{ access_token, refresh_token }` — pass directly
  to `supabase.auth.setSession()`. **Never returns the account's email.**
- **Response on any failure** (unknown worker_id, inactive/suspended/banned
  status, wrong password): identical generic `{ error: "Worker ID or
  password is incorrect." }`, so this cannot be used to enumerate valid IDs.
- **Rate limit**: 8 / 5 min per (IP, worker_id).
- See AUTH-RULES.md for the full flow diagram and why it's shaped this way.

## `create-client` — authenticated, permission-gated
- **Auth**: requires `has_permission('clients.create')` on the caller (same
  two-client trust split as `create-worker`).
- **Request**: `{ contact_name, email, organization? , client_id?, project_ids? }`
  — provide `organization` to create a brand-new company record, or
  `client_id` to add another login to an existing one (a company can have
  more than one client-portal user). `project_ids` optionally grants access
  to one or more projects immediately via `client_projects`.
- **Response**: `{ user_id, client_id, client_code, email, temporary_password }`.
  `temporary_password` returned exactly once, never stored or logged.
- **Rate limit**: 20 / 10 min per IP.
- **Writes**: creates a real Supabase Auth user, `clients` (if new),
  `profiles` (`role: 'client'`), `client_users`, `client_projects` rows, and
  an `audit_logs` entry (`client.created`).

## `resolve-client-login` — public, unauthenticated (this IS the client login step)
- **Request**: `{ client_id, password }` (`client_id` is the `CTF-CLT-NNNN` code).
- **Response on success**: `{ access_token, refresh_token }` — never the email.
- **Response on any failure**: identical generic
  `{ error: "Client ID or password is incorrect." }`.
- **Rate limit**: 8 / 5 min per (IP, client_id).
- Exact mirror of `resolve-worker-login`'s shape — see AUTH-RULES.md.

## `create-worker` — authenticated, permission-gated
- **Auth**: requires a valid session; the caller's own JWT is forwarded and
  checked against `has_permission('workers.create')` before anything happens.
  Creating a `role: 'manager'` account additionally requires
  `profiles.role = 'superadmin'` for the caller — a manager can create
  workers but never another manager.
- **Request**: `{ display_name, email, phone?, position?, bio?, role? }` —
  `role` is `'worker'` unless explicitly `'manager'` (and the caller is superadmin).
- **Response**: `{ user_id, worker_id, email, temporary_password, role }`.
  `temporary_password` is generated per-request, returned exactly once, and
  never stored or logged anywhere.
- **Rate limit**: 20 / 10 min per IP (this is an authenticated action, so the
  limit exists to blunt a compromised admin session rather than anonymous abuse).
- **Writes**: creates a real Supabase Auth user (service role,
  `auth.admin.createUser`), `profiles`, `worker_profiles`, `user_roles`, and
  an `audit_logs` entry (`worker.created` or `manager.created`).
