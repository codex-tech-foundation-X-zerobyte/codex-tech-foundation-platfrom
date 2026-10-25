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


---

## Push notifications (reaching people when the app is closed)

In-app notifications, the toast, the unread badges and the ringing screen all need the app open. **Web Push** is the
extra channel that wakes a closed browser tab or installed app. Everything below is built; it only needs the one-time
setup at the end to be switched on.

### What triggers a push

| Event | Who is pushed | Tap opens |
|---|---|---|
| Any row inserted into `notifications` (task assigned, announcement, comment, @mention, meeting, **project update published**, …) | that user | their Notifications page |
| New chat message (not deleted) | every other member of the channel | that conversation (`/…/chat?channel=<id>`) |
| 1:1 call starts ringing | the callee (stays on screen until handled; expires after 45 s) | chat |
| Group call starts | every other channel member | that channel |

A notification is **not** shown by the service worker when the person is already looking at the app (focused tab) — which can make a working setup look broken if you test with the app open in front of you; background the app first. — the
app handles it. Calls are the exception and always show. Someone who has turned push off (`notification_preferences.push = false`)
is skipped. A device that the push service reports as gone (404/410) is deleted automatically.

### How it fits together

```
INSERT on notifications / chat_messages / calls / group_calls
  → trigger public.dispatch_push()            (never fails the original insert)
  → pg_net POST  →  edge function push-dispatch   (authenticated by a shared secret header)
  → Web Push (encrypted, RFC 8291 + VAPID RFC 8292, in _shared/webpush.ts — no npm dependency) to each row of push_subscriptions
  → the browser's push service → public/sw.js shows it
```

Per device: Settings → Notifications → **Push notifications**, or the one-time banner at the top of the workspace.
Registration goes through `register_push_subscription()`, which also hands a browser over to whoever is signed in on it now.
Signing out removes that browser's subscription first, so a shared computer never keeps notifying the previous person.

### One-time setup (nothing here has been run for you)

1. **Generate VAPID keys** (once, anywhere with Node): `npx web-push generate-vapid-keys`
2. **Pick a shared secret**: `openssl rand -hex 32`
3. **Set the function secrets and deploy** — `push-dispatch` is called by the database, not by a signed-in user, so it must be deployed *without* JWT verification (the secret header is its authentication):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@your-domain.com PUSH_WEBHOOK_SECRET=<secret>
   supabase functions deploy push-dispatch --no-verify-jwt
   ```
4. **Tell the database where to send events** (SQL editor; the table has no policies, so only the service role and the trigger can read it):
   ```sql
   insert into public.push_settings (function_url, webhook_secret)
   values ('https://<project-ref>.supabase.co/functions/v1/push-dispatch', '<secret>')
   on conflict (id) do update set function_url = excluded.function_url, webhook_secret = excluded.webhook_secret, updated_at = now();
   ```
5. **Expose the public key to the app**: set `VITE_VAPID_PUBLIC_KEY=<public>` in your hosting environment and redeploy the frontend.
6. **Deploy the test function** (this one *does* use normal JWT verification): `supabase functions deploy push-test`
7. **Test**: Settings → Notifications → turn **Push notifications** on, then press **Send a test notification**. It checks every link in the chain and tells you, in plain words, which one is broken (missing secret, invalid key, `push_settings` row missing, `push-dispatch` deployed with JWT verification still on, no device registered, or the push service refusing the message), then sends a real notification to your device. Once that arrives, close the tab and have someone message you.

Until step 5 the toggle explains that push is "not set up yet"; until step 4 nothing is sent. In both cases in-app behaviour is unchanged.

### Limits worth knowing

- **iPhone / iPad** only deliver push to an app that has been added to the Home Screen (Share → Add to Home Screen). The settings switch says so.
- Browsers require a click for the permission prompt, which is why it is a banner/switch and not automatic.
- Delivery is "best effort" by design (the push services decide timing); calls use a 45-second lifetime so a stale ring is never delivered.
- **Start with the test button** (step 7) — it names the broken link. Then check `supabase functions logs push-dispatch` if real events still don't arrive. A `503` means a secret is missing; `403` means the secret in `push_settings` doesn't match.


### Choosing what to be told about

Settings → Notifications → **Tell me about** lets each person switch each kind of event on or off, separately for *In app* and *Push*:
chat messages, calls, mentions, tasks, project updates, announcements, meetings and approvals (shown by role — a client only sees project updates).
Chat and calls have no in-app notification row, so they only offer Push.

- **In app off** → the notification is never created (no badge, no list entry, and therefore no push either).
- **Push off** → the notification still appears in the app; only the push to devices is skipped (decided in `push-dispatch`).
- Messages an admin sends on purpose (`kind = general`) always arrive.
- The kind of an existing notification is derived from its title in `public.notification_kind()` — if you add a new place that creates notifications, either set `kind` yourself or extend that function.
