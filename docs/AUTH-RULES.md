# Authentication Rules

## Account types and how each logs in today

| Role | Login method | Status |
|---|---|---|
| Worker | Worker ID + password → `resolve-worker-login` Edge Function → session | **Implemented** |
| Manager | Worker ID + password (same flow/table as Worker — a manager IS a `worker_profiles` row with `profiles.role = 'manager'`) | **Implemented** |
| Super Admin | Email + password directly via `supabase.auth.signInWithPassword`, via the "Super Admin" tab on `/login` | **Implemented** (Pass 4 — see "Login page" below; previously a documented gap) |
| Client | Client ID + password → `resolve-client-login` Edge Function → session (mirrors the worker flow exactly) | **Implemented** (Pass 4) |

## Login page

`/login` (`src/pages/auth/Login.tsx`) is a single page with a three-way mode
toggle — Worker/Manager, Client, Super Admin — rather than three separate
routes, since the credential shape (an ID field + password) is identical for
two of the three and the third only swaps the ID field for an email field.
After a successful sign-in, the page fetches the resulting session's
`profiles.role` and routes to that role's home (`/worker`, `/admin`, or
`/client`) — this mapping lives in one place (`ROLE_HOME` in `Login.tsx`) so
it can't drift from `App.tsx`'s route guards.

## Worker/Client login flow (the pattern both share)

```
Browser                          resolve-worker-login / resolve-client-login       Postgres
   │  POST { worker_id | client_id, password }        │                                  │
   │ ──────────────────────────────────────────────── >│                                  │
   │                                        │  check_rate_limit(ip:id)          │
   │                                        │ ────────────────────────────────>│
   │                                        │  worker_profiles / clients+       │
   │                                        │  client_users WHERE code = id     │
   │                                        │  (service role — only place       │
   │                                        │   the email is ever resolved)     │
   │                                        │ ────────────────────────────────>│
   │                                        │  auth.signInWithPassword(email,  │
   │                                        │  password) — via ANON key client,│
   │                                        │  scoped to this one request      │
   │                                        │ ─────────────> Supabase Auth     │
   │  { access_token, refresh_token }       │                                  │
   │ <──────────────────────────────────────│                                  │
   │  supabase.auth.setSession(...)                                            │
```

**Why this shape, specifically:** the email is resolved and the password is
checked entirely inside the Edge Function. The browser never learns the
account's real email address, even on a failed attempt — this was a real
bug found and fixed in Pass 3 (the previous version returned the email to
the browser, which then called `signInWithPassword` itself; any caller
could learn a worker's email by submitting a worker_id and any password).
`resolve-client-login` was built from the start with this fixed shape.
Every failure path — unknown ID, inactive/suspended/banned status, wrong
password — returns the exact same generic error and status code per
function, so neither endpoint can be used to enumerate valid IDs.

Rate limit: 8 attempts per (IP, id) per 5 minutes, via `check_rate_limit()`,
on both functions independently.

## Account status enforcement

`worker_profiles.status` (`active|suspended|banned|inactive`) is checked
inside `resolve-worker-login` **before** the password is even verified —
a suspended/banned/inactive worker cannot obtain a new session through this
path. `resolve-client-login` does the equivalent check against
`client_users.status = 'active'` (a client with no active `client_users` row
gets the same generic failure). Neither check revokes an already-issued
Supabase session token; an account suspended mid-session keeps whatever
access their existing JWT grants until it expires (Supabase's default
access token TTL) or they're signed out. Fully killing an active session on
suspension would require either short access-token TTLs + a server-side
revocation list, or moving sensitive reads behind a check that re-verifies
status on every request (expensive) — neither is implemented. **This is a
known, documented limitation, not a silent gap**: don't assume suspension
is instantaneous.

## Super Admin bootstrap

No Super Admin credentials exist anywhere in source, migrations, or `.env.example` — by design.

```
1. Supabase Dashboard → Authentication → Users → Add user (manually).
2. Copy that user's UUID.
3. Run, from the SQL Editor (or any service-role connection):
     select public.bootstrap_super_admin('paste-uuid-here', 'Founder Name');
4. That user signs in via the standard Supabase email/password flow and is
   recognized as superadmin (profiles.role = 'superadmin', a `user_roles`
   link to the 'superadmin' role, and an audit_logs entry recording the bootstrap).
```

`bootstrap_super_admin()` is idempotent (safe to re-run for the same UUID)
and its `EXECUTE` grant is revoked from `anon`/`authenticated` — it cannot
be invoked through the exposed PostgREST RPC endpoint by a logged-in client
no matter what role they hold. It is not gated on `auth.role() =
'service_role'` because that claim doesn't exist in a SQL Editor session
(no JWT context) — gating on it would lock out the very workflow the
function exists for. The REVOKE is the actual security boundary here, not a JWT check.

## Resolved in Pass 4: Super Admin sign-in UX

Previously `/login` only had a Worker-ID field, so a bootstrapped superadmin
had no dedicated UI path. Fixed: `Login.tsx` now has a three-way mode
toggle, and the "Super Admin" mode calls `supabase.auth.signInWithPassword`
directly with an email field (no Edge Function needed — superadmin has no
short ID to resolve).

## Session/profile loading

`src/lib/auth.tsx` (`AuthProvider`) loads the `profiles` row for the current
session on every auth state change and exposes it via `useAuth()`. This is
the single source of the current user's role for routing (`ProtectedRoute`
in `App.tsx`) — never duplicate this query in a page component.
