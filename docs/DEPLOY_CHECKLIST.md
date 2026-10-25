# Deploying the 2026-09-30 update (deletes, trash, worker view, resources, push notifications)

Nothing below has been run against your production project. Do these in order; they are safe to re-run.

```bash
supabase db push                                           # 20260930000000 + 20260930000001
supabase functions deploy manage-account                   # NEW: worker/client delete, password reset, sign-in details (normal JWT check)
supabase functions deploy push-dispatch --no-verify-jwt    # NEW: only if you want push — then follow docs/NOTIFICATIONS.md → "One-time setup"
supabase functions deploy push-test                         # NEW: the "Send a test notification" diagnosis button (normal JWT check)
```

| Migration | What it does |
|---|---|
| `20260930000000_admin_deletes_and_account_removal.sql` | `detach_references()` clears the foreign keys that blocked deleting workers/projects/clients; Main-Admin-only `admin_delete_project` and `admin_delete_client_org`; idempotent delete policies for applications, project updates and chat messages |
| `20260930000001_push_notifications.sql` | `pg_net`, `push_settings`, push triggers on notifications/chat/calls, project-update notifications, `register_push_subscription()` |
| `20260930000002_trash_resources_leads_event_prefs.sql` | **Resources:** `mime_type`/`size_bytes` columns and a storage policy so a file can be read exactly when its row can (managers could see files they could never open; workers could read other departments' files by path). **Trash:** every delete of blog posts, leads, careers, case studies, team profiles, applications and resources is kept 30 days and restorable; `restore_deleted()` powers the 5-minute Undo. **Leads:** `internal_notes`. **Notifications:** a `kind` on every notification and per-event in-app/push preferences |

**Why deleting failed before:** the database already allowed the Main Admin to delete blog posts, leads, careers, case studies and
team profiles, but the app had no delete control for them (blog and careers only *archived*, leads and applications only changed status).
Workers, projects and clients *would* have failed on foreign keys (a worker is referenced by ~40 columns with no ON DELETE action).

**What deleting a worker does:** removes the login and their own rows (messages, call records, watches), hands shared work
they created (meetings, records) to the admin who deleted them, and unassigns their tasks. An `account.deleted` audit entry naming them is written first.
Older audit rows that pointed at them lose the link to the person (the foreign key requires it) but keep their text.

Frontend env (optional, push only): `VITE_VAPID_PUBLIC_KEY` — see `.env.example`.

---

# Previous update

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

## What the Trash does and does not cover

- **Restorable for 30 days (Main Admin → System → Trash), and Undo for 5 minutes by whoever deleted it:** blog posts, leads, careers (with their applications), case studies, team profiles, applications, files and links in Resources.
- **Uploaded files are kept until the trash item is purged** (a restore must bring back a complete record), so a deleted résumé or photo lingers in storage for up to 30 days. Items older than 30 days are purged — files included — whenever the Main Admin opens the Trash page; nothing purges them on a schedule, so if nobody opens it, they stay.
- **Not in the trash (hard delete with typed confirmation):** projects, workers and clients. Deleting those removes whole trees of related rows a one-row snapshot cannot bring back.
- A restore can be refused with a plain message if something now conflicts (a new post took the same slug, a new lead the same email) or if something it depended on is gone.

## Resources: what was wrong

1. **The "drop" box was only a label for a hidden file input** — dropping a file did nothing. It is now a real drop zone: drop files, drop or paste links, paste a screenshot, or click. Items appear in the list immediately while they upload.
2. **Download opened the link with `window.open()` after waiting on the network** — browsers (Safari and phones above all) treat that as a pop-up and block it. Download now uses a signed link with `Content-Disposition: attachment`, clicked through an anchor.
3. **There was no way to view a file.** Images, PDFs, video, audio and text now open in an in-page viewer; other types offer Download.
4. **Managers could see a file in the list but never open it**, because the storage policy only allowed workers and the Main Admin. Storage reads now follow the row's own visibility.
5. **A pasted or dropped link was just text.** Links in chat, tasks, comments, updates, announcements and notifications are now clickable (only http/https and e-mail; never `javascript:` or `user@host` tricks), chat shows a link card, and a link dropped into Resources becomes a link resource.
