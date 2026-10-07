# Deploying this update

Nothing below has been run against your production project — I had no access to it. Do these in order.

## 1. Database (required — several fixes are in SQL)

```bash
supabase db push
```

This applies, in order:

| Migration | What it fixes |
|---|---|
| `20260923000000_functional_gap_fixes.sql` | Clients couldn't see their projects/milestones; client requests were rejected; staff names invisible to workers; call rows could be rewritten; notifications not realtime |
| `20260924000000_fix_audit_trigger_and_project_updates.sql` | **`worker_profiles` PATCH → 400** and **`project_updates` POST → 403** |
| `20260925000000_chat_dm_uploads_security_posture.sql` | Duplicate "General" channels, private DMs, chat media, project-file upload/download policies, security report |

All three are idempotent (safe to re-run). To confirm the two production errors are gone, run in the SQL editor:

```sql
-- should list an INSERT policy "staff publish project updates"
select policyname, cmd from pg_policies where tablename = 'project_updates';
-- should return the function body mentioning "user_id"
select pg_get_functiondef('public.audit_row_change'::regproc);
```

## 2. Edge Functions

```bash
supabase functions deploy security-monitor      # new
supabase functions deploy create-worker create-client change-password   # temp-password generator changed (shared code)
```

Optional, to light up the Security monitor's external checks (all read-only; secrets stay on the server):

```bash
supabase secrets set GITHUB_TOKEN=<fine-grained token> GITHUB_REPOSITORY=<owner>/<repo>
supabase secrets set VERCEL_TOKEN=<token> VERCEL_PROJECT_ID=<id> [VERCEL_TEAM_ID=<id>]
supabase secrets set SITE_URL=https://your-domain.com
```

The GitHub token needs *read* access to: Metadata, Dependabot alerts, Secret scanning alerts, Code scanning alerts, Administration, Actions.

## 3. Frontend

Redeploy on Vercel. The build now **refuses to run** if a service-role/secret key is in any `VITE_*` variable.
`vercel.json` now sends security headers. The CSP is **report-only**: after deploying, browse the app with the console open;
if there are no "Content Security Policy" violation messages, rename `Content-Security-Policy-Report-Only` to
`Content-Security-Policy` in `vercel.json`.

## 4. Verify in the browser (things only a real browser can prove)

1. **System status** page → "TURN relay" should say *Operational* (this forces relay-only, so it proves your ExpressTURN credentials work).
2. Two people, two browsers: call each other; then start a group call and confirm the other person gets a **Join** banner from another page.
3. Chat → People → message someone; confirm only the two of you see it (an admin should not).
4. Upload a screenshot (e.g. a macOS one with "AM/PM" in the name) in a project's Files tab and in chat.
5. Suspend and reactivate a worker. Publish a project update as a worker.
6. Look at each role's Overview page.

## 5. Known limits

- TURN credentials in `VITE_TURN_*` are visible to anyone who loads the site (browsers need them). If you see abuse of your TURN quota, move to short-lived credentials issued by an Edge Function.
- Realtime *presence* channels are not protected by Row Level Security. The presence payload is only an online/away flag keyed by user id.
- Group calls are a full mesh: comfortable to about six people.
