# Notifications

## What exists

- `notifications` table (`user_id`, `title`, `body`, `read_at`,
  `created_at`), RLS scoped to the owning user for select/update.
- `notification_preferences` table (`in_app`/`email`/`push` booleans per
  user), RLS scoped to self — **schema exists, no UI reads or writes it yet**.
- `push_subscriptions` table (Web Push subscription JSON per user) —
  **schema exists, nothing subscribes or sends a push yet.**
- `src/lib/services/workspace.ts`: `listNotifications()`,
  `markNotificationRead()`.
- `src/pages/NotificationsPage.tsx`: real in-app list, unread/all tabs,
  mark-as-read on click. Wired into worker and admin/manager workspaces.

## What's deliberately not claimed as done

**No event actually creates a notification row today.** A task assignment,
project update, new lead, or account-status change does not insert into
`notifications` — the table and UI can display rows, but nothing writes
them outside of someone doing it manually. This is the single biggest gap
between "notifications work" and reality; don't assume task/project/chat
flows notify anyone until this is built.

**No email or push delivery exists.** `notification_preferences` and
`push_subscriptions` are schema only.

## Target design for the next pass

A single `notify(userId, { title, body, type, resourceId? })` helper — not
one insert call duplicated in every mutation site — called from:
- the `create-worker` Edge Function (and future `create-client`) on account creation
- task assignment/status change (once task RLS-safe writes go through a service function rather than inline table calls)
- project update publish
- new lead/application (notify whoever has `leads.view`/`applications.review`)
- account status change (suspend/reactivate)

This should live in `src/lib/services/notifications.ts` for in-app inserts
made from the client (where RLS already allows it, e.g. a worker updating
their own task) and inside relevant Edge Functions for anything already
running server-side (worker creation, public form submissions that should
alert staff).

Email/push are out of scope until `notification_preferences` has a UI and a
delivery mechanism (a Postgres trigger → Edge Function → provider, most
likely) is chosen — do not fake either being "supported" in the UI before then.
