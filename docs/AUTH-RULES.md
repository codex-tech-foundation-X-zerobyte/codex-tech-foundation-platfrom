# Auth Rules

## Login flows

All identities authenticate through Supabase Auth (email + password). The
`Login.tsx` page accepts one field that's format-detected:

- `CTF-WKR-...` → `resolve-worker-login` edge function resolves it to an
  email, then `supabase.auth.signInWithPassword`.
- `CTF-CLI-...` → `resolve-client-login`, same pattern.
- Anything containing `@` → treated as a direct email (superadmin/manager).

After sign-in, `AuthProvider.refresh()` loads the `profiles` row and
`Login.tsx` routes based on the **actual resolved role** (`client` → `/client`,
`worker` → `/worker`, anything else → `/admin`) — not based on which ID
format was typed, since a Worker-ID-shaped login could belong to a `worker`
or a `manager` profile.

## Why the resolver functions exist at all

Supabase Auth only knows email/password. Worker ID and Client ID are
human-friendly identifiers stored in `worker_profiles.worker_id` /
`client_users.client_code`. The resolver functions look up the associated
auth email server-side (via `admin.auth.admin.getUserById`, service-role
only) and return just the email — the frontend never sees or stores an
email-to-ID mapping itself.

## Enumeration protection

Both resolvers:

- Return the **same generic error and status code** (`401`, "Invalid
  credentials") whether the ID doesn't exist, is suspended/banned, or the
  associated Auth user is missing — the caller can't distinguish these cases.
- Rate limit by **IP** (`enforceRateLimit`, 10 requests / 5 min) AND
  separately by the **specific ID being probed** (`enforceRateLimitByKey`,
  8 requests / 5 min) — so an attacker rotating source IPs still can't
  brute-force one specific Worker/Client ID. See `_shared/rateLimit.ts` for
  why these use different bucket-keying (a real bug was caught and fixed
  here during implementation — the first draft accidentally combined ID+IP
  into one bucket, which would have let IP rotation bypass the per-ID limit).
- Log failed attempts to `audit_logs` (`login.failed`) with the reason
  (`not_found` / `inactive` / `no_auth_email`) in `metadata` — never logs the
  password, and never logs anything for the *password* check itself (that
  happens client-side via `signInWithPassword`, which the resolver has no
  visibility into — see the comment in `resolve-worker-login/index.ts` about
  why `login.success` isn't logged there).

**Not implemented**: this endpoint is not a full user-enumeration-proof
design in the strictest sense — a genuinely active ID still returns 200
where an inactive/nonexistent one returns 401, which is an inherent
trade-off of needing to know whether to show the password field at all.
Fully closing that would need a UX redesign (e.g., always show a password
field, fail generically at the final sign-in step) — not done here.

## Session resilience (fixed — was causing spurious logouts)

**Root cause found and fixed**: `AuthProvider`'s `onAuthStateChange` listener
called `refresh()` on every event, including the automatic `TOKEN_REFRESHED`
event Supabase fires roughly hourly. `refresh()` independently called
`supabase.auth.getUser()` — a network round-trip to the Auth server — and
immediately cleared the profile (`setProfile(null)`) if that call failed for
*any* reason, including a transient network error. Since the underlying
session in localStorage was still completely valid, this made users appear
logged out purely because of a momentary blip during a routine background
refresh — exactly matching the reported symptom of accounts "logging out
after using the platform for a while."

Fixed in `src/lib/auth.tsx`: the background listener now uses the `session`
object `onAuthStateChange` already provides instead of independently
re-verifying via `getUser()`, only clears the profile on an explicit
`SIGNED_OUT` event, and treats a profile-fetch error as "try again later,"
not "log the user out." The explicit `refresh()` function (used right after
sign-in, where a definitive answer is actually needed) keeps its original,
stricter behavior — the leniency only applies to the passive background
sync, not to user-initiated actions waiting on a fresh result.

## Account status enforcement

- `worker_profiles.status`: `active | suspended | banned | inactive`.
  `resolve-worker-login` refuses anything other than `active`.
- `client_users.status`: `active | suspended | banned | inactive | closed`.
  `resolve-client-login` refuses anything other than `active`.

**Gap, not yet fixed**: this only blocks *new* sign-ins through the resolver
functions. A worker/client who already has a live Supabase session (a valid
JWT) is not automatically signed out the moment an admin suspends them — the
frontend has no session-revocation check on every request. RLS policies on
individual tables would still need to independently check status (they
currently don't — `worker_profiles`' own RLS checks permissions/ownership,
not `status`). Closing this fully needs either short-lived JWTs with
frequent re-validation, or RLS policies that join back to
`worker_profiles.status`/`client_users.status` on every sensitive table. Not
done — flagged here rather than silently left unmentioned.

## Super Admin bootstrap

See `supabase/bootstrap/create-superadmin.sql`. Never run automatically.
Promotes a manually-created Auth user (created via the Supabase dashboard or
Admin API, with the password set there — never in this repo) to superadmin
by UUID. Full instructions are in the file's header comment.

## Password handling

Temporary passwords (worker/client provisioning) are generated with
`crypto.getRandomValues` in `_shared/auth.ts`'s `generateTempPassword()`,
returned exactly once in the provisioning edge function's response, and
never written to any table in plaintext or logged. `worker_profiles.
must_change_password` defaults to `true` on creation — **the frontend does
not yet enforce a forced password-change flow on first login**; the column
exists but nothing reads it yet. That's a real gap, not done.
