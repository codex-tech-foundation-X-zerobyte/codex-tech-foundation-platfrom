# Update: Customer Service completion

Six things, each tested: a **customer endpoint** for the connected project's backend, **callbacks** to that backend, **overdue and unassigned alerts**, **shifts and workload**, **attachments**, and **ticket-to-incident links**.

## Apply, in this order
1. **SQL editor** (safe to run twice): `supabase/migrations/20261005000000_support_completion.sql`. It also creates the private `support-attachments` storage bucket (10 MB, PDF/PNG/JPEG/WebP/text/CSV only).
2. **Deploy the functions** (each authenticates itself): `supabase functions deploy support-ticket --no-verify-jwt` and `supabase functions deploy workspace-sweep --no-verify-jwt`. If you already deployed `monitor-sweep` from the previous package, delete it and its schedule: `workspace-sweep` replaces it.
3. **Secret:** `supabase secrets set WORKSPACE_SWEEP_SECRET=...` (a long random value, at least 24 characters; it replaces `MONITOR_SWEEP_SECRET`).
4. **Schedule `workspace-sweep`** every 1 to 2 minutes: `POST https://<project-ref>.supabase.co/functions/v1/workspace-sweep` with header `x-sweep-secret: <that secret>`. It does three jobs: Super Monitor checks, Customer Service alerts, and **delivering callbacks**. Without a schedule, callbacks queue up and wait.
5. Redeploy the frontend.
6. To turn callbacks on for a project: **Support desk → Connected projects → Callbacks to the project → Set up** (Main Admin only), paste the project's https address, and copy the signing secret that appears. It is shown once.

## 1. The customer endpoint (`support-ticket`)
Called by the **connected project's backend**, never a browser (the key would be public). Same `ctfs_…` key as `support-intake`.

```
POST https://<project-ref>.supabase.co/functions/v1/support-ticket
x-support-key: ctfs_…
content-type: application/json
```
| Body | What it does | Answer |
|---|---|---|
| `{"action":"status","external_ref":"ORD-77"}` | The ticket as the customer may see it | `{ ticket: {ref, status, subject, created_at, resolved_at, rating, can_reply, can_rate}, messages: [{id, from: "customer"\|"support", body, at}], attachments: [{id, name, mime_type, size_bytes}] }` |
| `{"action":"reply","external_ref":"ORD-77","body":"…"}` | A customer reply (reopens a resolved ticket) | `{ ok: true }` |
| `{"action":"rating","external_ref":"ORD-77","rating":5,"note":"…"}` | Rate a resolved ticket, once | `{ ok: true }` |
| `{"action":"attachment","external_ref":"ORD-77","attachment_id":"…"}` | A link to a file Customer Service shared | `{ url, name, mime_type, expires_in: 60 }` |

- **Statuses the customer sees:** `open`, `in_progress`, `waiting_for_customer`, `resolved`, `closed`. An internal "assigned" shows as `open` and "escalated" as `in_progress`.
- **Never in any answer:** internal notes, assignee, escalations, internal files, storage paths.
- **Errors:** `401` bad or missing key; `404` the same answer whether the key or the reference was wrong, so nothing leaks; `400` bad input; `409` not possible now (closed ticket, not resolved yet, already rated), with a plain message; `429` slow down; `500` nothing revealed.
- **Fixed in this update** (they were in the earlier functions): rating a ticket that wasn't resolved used to do nothing and report success; a reply to a **closed** ticket used to be accepted; a rating could be overwritten; the customer view showed the internal status "escalated".
- Replies are checked for card numbers and secrets, like new tickets. Limits: 240 requests a minute per address, 600 per key.

## 2. Callbacks to the project's backend
When Customer Service replies publicly, or a ticket's status changes in a way a customer would notice, the project's backend gets a **signed POST**. It is a **nudge, not the source of truth**: for anything that matters, ask `support-ticket` with `action: "status"`.

| Event | When | Payload (nothing else is ever included) |
|---|---|---|
| `ticket.acknowledged` | the first reply | `event, sequence, ticket_ref, external_ref, occurred_at, acknowledged_at` |
| `ticket.reply` | a public reply | `event, sequence, ticket_ref, external_ref, occurred_at, message: {body, at}` |
| `ticket.status` | a change the customer would see | `event, sequence, ticket_ref, external_ref, occurred_at, status` |

- **Headers:** `x-codex-event`, `x-codex-event-id` (stable across retries: use it to ignore repeats), `x-codex-delivery-attempt`, `x-codex-signature: t=<unix seconds>,v1=<hex>`.
- **Verify** with HMAC-SHA256 of `"<t>.<exact raw body>"` using the signing secret, and reject a timestamp more than 5 minutes old. A tested example is shown in the dialog, and is in `src/lib/supportRules.ts` (`CALLBACK_VERIFY_SNIPPET`).
- **Order:** events can arrive out of order. Each has an increasing `sequence`; ignore a `ticket.status` whose sequence is lower than the last one you applied for that ticket.
- **Delivery:** answer `2xx` within 5 seconds. Failures are retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours, then given up (the Customer Service leads are told, and can retry from the delivery log). Redirects are not followed. Finished deliveries are kept 30 days.
- **Where it may point:** `https` only, a real domain name (no IP address, no internal names such as `.internal` or `.local`), port 443 or 8443, no credentials. It is checked when you save it, and again at send time, when **every** address the name resolves to must be public. *Residual risk:* a name could in theory change its answer between that check and the connection; https, no redirects and never reading the response limit what that could reach.
- **The secret** is made on the server, shown once, and stored only where signed-in users cannot read it (not even the Main Admin). Setting the address again replaces it.

## 3. Alerts, once each (the sweep)
- A customer still waiting for a **first reply** past its target: the leads and the assignee are told; at **twice** the target, the Main Admins too. A ticket waiting on the customer is never "late".
- A ticket **unassigned for 15 minutes**: the leads are told.
- The **incident behind a ticket is resolved** (see 6): the assignee and leads are told it is time to update the customer.
- The same reason never notifies twice. No business rule was invented: there is no resolution deadline, because none was specified.

## 4. Shifts and workload (Team tab, leads only)
Per person: open tickets, late for a first reply, waiting on the customer, resolved in 7 days, average first reply, average rating (30 days), and whether they are on shift. Shifts are a **roster only**: at most 24 hours, no overlaps, Customer Service team members only; the team sees the roster, leads change it. Nothing is assigned automatically and nothing is paid from it. *Ratings and response times are about people, so only leads see them.*

## 5. Attachments
A **Files** section on every ticket. Uploads go to a private bucket and are registered on the ticket (the file must exist, be yours, and sit in this ticket's folder). Everything is **internal** unless a Customer Service agent marks it shared; only shared files can ever be fetched through `support-ticket`, as a link that works for 60 seconds. Up to 20 per ticket, and **files cannot be deleted or changed** (evidence). Customers cannot upload through the endpoint yet.

## 6. Tickets and incidents
Engineers (DevOps, the owning department, the Main Admin) **link an incident by reference** to a ticket they can see. Customer Service sees only the incident's reference, severity, status and project, never its title, notes or root cause. A reference that doesn't exist and one you may not see get the same answer.

## Who can do what
| | Main Admin | CS lead | CS agent | Team a ticket was escalated to | Anyone else |
|---|---|---|---|---|---|
| Set or remove a callback | **yes** | no | no | no | no |
| See callback status and delivery log, retry a given-up delivery | yes | yes | no | no | no |
| Workload, set shifts | yes | yes | no | no | no |
| See the roster | yes | yes | yes | no | no |
| Add a file (internal) / share a file with the customer | yes / yes | yes / yes | yes / yes | yes / **no** | no |
| Link an incident | yes (if they can see it) | no (unless they can see the incident) | no | yes (if they can see it) | no |

## Tested
- **SQL:** 144 new checks (969 in the whole suite, fresh database). Five deliberate breaks (internal messages shown to customers, plain-http callbacks, a sweep that forgets whom it told, linking without the incident permission, a status on every payload) each failed the suite.
- **A real defect the tests found in my own first draft, fixed:** a reply event carried a status that was already out of date by the time it was sent (events can arrive out of order), so only status events now carry one and every event has a `sequence`. The other failures along the way were mistakes in my tests, not in the product.
- **Node:** 324 tests (with the earlier ones): request parsing, the URL check **against the same table of cases the SQL test uses**, public-address rules for IPv4 and IPv6, signing against an independent implementation, delivery with a fake network (private addresses are never contacted, redirects are not followed, the secret is never sent, the response is never read), the verification example **run for real**, and limits tied to the SQL.
- **Screens:** 18 new tests. **Browser audit:** the Team tab, Connected projects tab and the callback editor dialog pass axe at 360 and 1280 px. It found and I fixed: the callbacks heading level, and a layout flaw (a wide table or the tab bar could stretch the whole Support Desk page past a phone screen).
- **Found in an existing test:** the content-calendar test used "the 28th or today, whichever is earlier", so it passed only on days 1 to 28 of a month and began failing on the 29th. Fixed.

## Not done, or not verified
- **The two edge functions were never run** (no Deno here). Parsing, URL safety, signing and delivery are tested with a fake network; the real DNS lookup and real HTTPS call are not.
- **Storage policy enforcement against real Supabase storage** is untested: the local test database has a stand-in for storage. The policies exist and are checked by name and command (read and add only, no update, no delete), and the registration function independently requires the object to exist and be yours.
- **The scheduler** is yours to set up. **Customers cannot upload files** through the endpoint. The **delivery-log dialog** and the ticket dialog were covered by tests but not opened in the browser audit (the harness lookup was ambiguous).
- Notification **mute switches** for the new alerts do not exist: they are always on.
- Callbacks cover replies, first reply and status. They do not send ticket creation (the intake call already returns the reference), ratings, or files.
