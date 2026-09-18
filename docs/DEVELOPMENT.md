# Development & Verification

## Setup

```bash
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

Apply all migrations in order (`npx supabase db push` or the CLI's
migration-apply command) against your Supabase project before expecting
anything beyond the public marketing pages to work.

Deploy Edge Functions:

```bash
supabase functions deploy resolve-worker-login
supabase functions deploy create-worker
supabase functions deploy submit-lead
supabase functions deploy submit-contact
supabase functions deploy submit-job-application
supabase functions deploy create-resume-upload-url
```

Configure `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret only —
never in `.env.local`, never referenced by anything Vite bundles.

## Bootstrap your first Super Admin

See `AUTH-RULES.md` § Super Admin bootstrap. In short: create the Auth user
manually in the Supabase Dashboard, then run
`select public.bootstrap_super_admin('<uuid>', 'Your Name');` from the SQL Editor.

## Required checks before trusting any change

```bash
npm run lint
npm run build
npm test
```

**This document does not claim these have been run against this codebase in
this pass.** The working environment used to produce this pass's changes has
no network access — `npm install`/`build`/`lint`/`test` could not be
executed here, matching the same limitation noted in `ROADMAP.md` for every
prior pass. What was checked instead, manually, against every file touched:
import resolution, unused-import/parameter patterns (matching
`noUnusedLocals`/`noUnusedParameters`), `verbatimModuleSyntax` compliance
(type-only imports use `import type`), and bracket/paren balance in both the
`.tsx`/`.ts` changes and the new SQL migrations. **This is not a substitute
for the real build.** Run the four commands above, and apply the new
migrations against a real Supabase project, before treating this pass as verified.

## RLS verification checklist (not yet executed against a live project)

For each of these, sign in as the role in question (or stay anonymous) and
attempt the listed operations from the browser console or a REST client —
don't just read the policy and assume it's correct:

| Table | Anonymous | Client | Worker | Manager | Superadmin |
|---|---|---|---|---|---|
| `profiles` | no access | self only | self + admin update if granted | self + worker rows (scoped) | full |
| `worker_profiles` | no access | no access | self only | worker-role rows only | full |
| `clients` | no access | own record | read (all) | read + create/update | full |
| `projects` | published only | own project(s) | full (operational) | full (operational) | full |
| `tasks` | no access | read own project's | full | full | full |
| `leads` | insert only | no access | view/manage (granted) | view/manage | full |
| `applications` | insert only | no access | review (granted) | review | full |
| `blog_posts`/`careers`/`content_pages` | published only | published only | view drafts + manage (granted) | view drafts + manage | full |
| `roles`/`permissions`/`role_permissions`/`user_roles` | no access | no access | no access | no access | full |
| `system_settings` | no access | no access | no access | no access | full |
| `audit_logs` | no access | no access | no access unless granted | no access unless granted | full |

Run this against a real project and fix this table (and the underlying
policy) if reality disagrees with it — this table is a claim to verify, not
a guarantee.
