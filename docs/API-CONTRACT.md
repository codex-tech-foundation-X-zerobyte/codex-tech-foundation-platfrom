# API Contract (Edge Functions)

All functions: CORS `Access-Control-Allow-Origin: *` (public forms need to be
callable from the browser; none of these return anything sensitive to an
unauthenticated caller — see each entry). Rate limits are enforced via
`check_rate_limit()`, not just documented as a claim — see AUTH-RULES.md and
`_shared/rateLimit.ts`.

## `submit-lead`
- **Auth**: none (public). **Rate limit**: 5 / 10 min per IP.
- **Request**: `{ name, email, company?, message? }` or the Start-a-Project
  shape (`project_type`, `problem`, `desired_outcome`, `budget`, `timeline`,
  `existing_system`, `phone`, `additional_info`) — composed into `message`.
- **Response**: `{ ok: true }` or `{ error: string }` (400).
- Writes to `leads` via service role — this table has **no public INSERT
  policy**, this function is the only write path.

## `submit-contact`
- **Auth**: none. **Rate limit**: 5 / 10 min per IP.
- **Request**: `{ name, email, message }`. **Response**: same shape as above.
- Writes to `leads` with `source: 'contact'` (no separate contact-messages
  table).

## `submit-job-application`
- **Auth**: none. **Rate limit**: 5 / 10 min per IP.
- **Request**: `{ career_id, name, email, cover_note, resume_path? }`.
- Validates the career is published before accepting. Writes to
  `applications` (also no public INSERT policy — service role only).

## `create-resume-upload-url`
- **Auth**: none. **Rate limit**: 8 / 10 min per IP.
- **Request**: `{ filename }`. **Response**: `{ path, token, signedUrl }`.
- Only `.pdf`/`.doc`/`.docx` accepted. Path is a random UUID, never derived
  from user input beyond the extension — no way to target another
  applicant's file. Frontend uploads directly to `signedUrl` via
  `supabase.storage.from('applications').uploadToSignedUrl(path, token, file)`.

## `resolve-worker-login` / `resolve-client-login`
- **Auth**: none (this IS the pre-auth step). **Rate limit**: 10/5min per IP
  AND 8/5min per specific ID (see AUTH-RULES.md for why both).
- **Request**: `{ worker_id }` / `{ client_id }`. **Response**: `{ email }`
  on success, generic `{ error: 'Invalid credentials' }` (401) otherwise —
  see AUTH-RULES.md for the enumeration-protection reasoning.
- Never returns anything except the email — no status, no name, no other
  profile data.

## `create-worker`
- **Auth**: required. Caller must be `superadmin` (checked via
  `authorizeCaller()` + profile role — NOT via RLS, since this function uses
  the service-role key which bypasses RLS entirely).
- **Rate limit**: 20 / 10 min per IP (defense-in-depth, not the primary
  control — the primary control is the auth check above).
- **Request**: `{ name, email, phone?, position?, department_id?, role? }`
  (`role` must be `'worker'` or `'manager'`, defaults to `'worker'`).
- **Response**: `{ worker_id, temp_password, user_id }` — temp_password is
  shown exactly once, never stored or logged.
- Creates the Auth user, updates their `profiles` row (role + display_name),
  creates `worker_profiles`, logs `worker.created` to `audit_logs`.

## `create-client`
- **Auth**: required. Caller must be `superadmin`, OR have the
  `clients.create` permission (checked via `has_permission_for()` RPC, since
  `manager` can legitimately create clients per RBAC.md).
- **Rate limit**: 20 / 10 min per IP.
- **Request**: `{ organization, contact_name, email, project_id? }`.
- **Response**: `{ client_id, temp_password, user_id }` (`client_id` here is
  the human-readable `client_code`, e.g. `CTF-CLI-...`, not the `clients.id`
  UUID).
- Creates the `clients` row, the Auth user, `client_users`, optionally links
  `client_projects`, logs `client.created`.

## Not yet implemented as edge functions (per spec, still needed)

Password-change enforcement, notification dispatch (email/push), any
chat/call signaling, R2 upload/download proxying. See ARCHITECTURE.md's
status section.
