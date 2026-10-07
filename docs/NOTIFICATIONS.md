# Notifications

## Actual state today

In-app notifications only. `notifications` table (user_id, title, body,
read_at, created_at), read via `listNotifications()` /
`markNotificationRead()` in `services/workspace.ts`, rendered by
`NotificationsPage.tsx` (used by both worker and admin — no client-facing
notification page yet). No realtime push to the UI — the page fetches on
mount, it does not subscribe to new rows arriving.

**Nothing currently creates notification rows.** The table and read path
exist; no code path inserts a notification when e.g. a task is assigned or a
project update is published. This is a real gap — the spec's list of
trigger events (task assigned, project update, milestone completed, new
lead, etc.) is not implemented.

## `notification_preferences` / `push_subscriptions`

Both tables exist in the schema (`architecture_rebuild.sql`) with RLS
policies. Nothing in the frontend reads or writes either yet — no
preferences UI, no push subscription registration.

## Target design (not built)

A single notification-creation path — most likely a Postgres function
(`create_notification(user_id, title, body, metadata)`) called from triggers
on the tables that should generate notifications (`tasks` on assignee
change, `project_updates` on insert, etc.) rather than scattered
`insert into notifications` calls from application code in a dozen places.
This keeps the "one implementation per concept" rule from ARCHITECTURE.md.
Email/push delivery would be a separate edge function reading
`notification_preferences` to decide whether to actually send, triggered by
the same insert (e.g. via a Postgres webhook or a scheduled function) — not
built.
