# Connecting a project to the Codex Workspace

**For the agent (or developer) wiring up one of the company's own projects.** This file is self-contained: you do not need any earlier conversation. Three things can be connected, and you can do any of them on its own:

| Connection | What the project gets | Runs through | Needs |
|---|---|---|---|
| **A. Super Monitor** | Its errors, speed and "is it alive" show up in the Workspace, and incidents open by themselves | the edge function `monitor-ingest` | a `ctfm_…` key |
| **B. Customer Service** | Customers' reports become tickets; the customer can see replies and rate the help | the edge functions `support-intake` and `support-ticket` | a `ctfs_…` key |
| **C. Super Dashboard** | Nothing to connect (see below) | none | nothing |

Everything the Workspace does for you happens in **Supabase Edge Functions**. **There is nothing to `npm install` in your project**: the client code is two plain files you copy in, with no dependencies. You only need **Node 18 or newer** (or Deno, Bun, a Cloudflare Worker, Vercel or Netlify functions: anything with `fetch`). Any other language can call the same HTTPS endpoints directly (curl examples are below).

---

## 0. What you must get from the project owner first

Ask for these. **Never ask for them to be pasted into a chat or committed to the repository**: they go into the project's host environment variables (Vercel, Netlify, `.env.local`, which must be git-ignored).

| Variable | What it is | Which connection | Where it may live |
|---|---|---|---|
| `CODEX_FUNCTIONS_URL` | `https://<project-ref>.supabase.co/functions/v1` (the Workspace's Supabase address; not secret) | A, B | server or browser |
| `MONITOR_KEY` | `ctfm_` + 48 characters. Made by the Main Admin in **Workspace → Super Monitor → Setup**; shown once | A | server (preferred) or browser (it can only *write* telemetry) |
| `SUPPORT_KEY` | `ctfs_` + 48 characters. Made in **Workspace → Support desk → Connected projects**; shown once | B | **server only, never a browser** |
| `SUPPORT_CALLBACK_SECRET` | 64 hex characters. Made by the Main Admin when they set the project's callback address; shown once | B (optional) | server only |

If the project has not been registered yet, ask the Main Admin to do it (you cannot): *Super Monitor → Setup → Register a project*, then *Create key*; *Support desk → Connected projects → add the project*, then (optionally) *Callbacks to the project → Set up*.

Also ask: **is the project a long-running server, serverless functions (Vercel/Netlify), or a browser-only app?** The answer changes how you wire A (section 2).

---

## 1. Workspace side: what must already be true (the owner's checklist)

You cannot fix these from the project, but if a smoke test fails, check them first:

1. The database updates `20261004000000_super_monitor.sql` and `20261005000000_support_completion.sql` have been run.
2. The edge functions are deployed, each with `--no-verify-jwt` (the key *is* the authentication): `monitor-ingest`, `support-intake`, `support-ticket`, `workspace-sweep`.
3. The secret `WORKSPACE_SWEEP_SECRET` is set and `workspace-sweep` is **scheduled every 1 to 2 minutes** (`POST …/workspace-sweep` with header `x-sweep-secret`). Without this: "no heartbeat" incidents never open, late-ticket alerts never fire, and **callbacks are never delivered**.
4. The project is registered and its key(s) made (section 0).

---

## 2. Connection A: Super Monitor

### Copy two files into the project
From the workspace repository, copy `sdk/super-monitor/index.mjs` and `sdk/super-monitor/index.d.mts` (types for TypeScript) into the project, for example into `lib/super-monitor/`. **Do not run `npm install` anything.** They have no imports.

### Pick the pattern that matches the project

**Long-running server (Express, Fastify, a worker, a VPS):**
```js
import { createMonitor } from './lib/super-monitor/index.mjs'

export const monitor = createMonitor({
  endpoint: `${process.env.CODEX_FUNCTIONS_URL}/monitor-ingest`,
  key: process.env.MONITOR_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'staging',
  release: process.env.GIT_SHA ?? 'unknown',
  heartbeatSeconds: 300,                 // must be the "Expected heartbeat" the owner registered (default 300)
})
monitor.start()                          // heartbeat now and every 5 minutes
process.on('uncaughtException', (e) => { monitor.captureError(e, { fatal: true }); void monitor.flush().finally(() => process.exit(1)) })
process.on('unhandledRejection', (e) => monitor.captureError(e))
// in your error handler:  monitor.captureError(err, { route: req.path })
// after each request, if you want speed tracked:  monitor.latency(req.path, elapsedMs, res.statusCode)
```

**Serverless (Vercel, Netlify functions, Cloudflare Workers):** a timer will not keep running, so **do not rely on `start()`**. Instead:
```js
const monitor = createMonitor({ endpoint: `${process.env.CODEX_FUNCTIONS_URL}/monitor-ingest`, key: process.env.MONITOR_KEY, release: process.env.VERCEL_GIT_COMMIT_SHA })
export async function handler(req, res) {
  try { /* … */ } catch (err) { monitor.captureError(err, { route: req.url }); throw err }
  finally { await monitor.flush() }      // IMPORTANT: send before the function freezes, or the events are lost
}
```
and, if "is it alive" matters, add a **scheduled route** (Vercel Cron / Netlify scheduled function, every 5 minutes) that does `monitor.heartbeat(); await monitor.flush()`. **Without regular heartbeats the Workspace cannot tell the project is down** (it stays "healthy" or "no data yet"). That is expected, not a bug.

**Browser-only app (React, Vite, a static site):**
```js
import { createMonitor } from './lib/super-monitor/index.mjs'
const monitor = createMonitor({ endpoint: `${import.meta.env.VITE_CODEX_FUNCTIONS_URL}/monitor-ingest`, key: import.meta.env.VITE_MONITOR_KEY, release: import.meta.env.VITE_APP_VERSION })
monitor.start({ heartbeat: false })     // global error handlers ON, heartbeats OFF
```
**`heartbeat: false` matters:** nobody may be visiting, and a quiet site must not look "down". The key is visible to anyone who opens the page; that is acceptable only because it can *only write telemetry* within a quota and can be revoked. Never put a `ctfs_` support key in a browser.

### What to send, and what never to
- **Send:** errors (`captureError`), slow or failing requests (`latency`), warnings (`message(text, 'warning')`), and heartbeats.
- **Never put in a message:** passwords, tokens, card numbers, customer personal data. The database redacts common shapes (tokens, e-mail addresses, card-length numbers, `password=…`, and query strings in routes), but that is a safety net, not a licence.
- Repeated identical errors are grouped automatically. If you set your own `fingerprint`, keep it stable for "the same error".

### What happens in the Workspace
The project appears in **Super Monitor**. The same error 10 times in 10 minutes (the owner can change the number), any `fatal` error, or three missed heartbeat intervals opens an **incident**, which a person acknowledges, investigates and resolves. A `401` from the endpoint means the key was revoked or expired: the client stops by itself and calls `onAuthFailure`.

---

## 3. Connection B: Customer Service

**Server only.** The project's **backend** calls the Workspace; never a browser.

### Copy two files into the project
`sdk/support-client/index.mjs` and `sdk/support-client/index.d.mts`. No `npm install`. (The client refuses to start in a browser, on purpose.)

### Create a ticket when a customer asks for help
```js
import { createSupportClient } from './lib/support-client/index.mjs'
const support = createSupportClient({ baseUrl: process.env.CODEX_FUNCTIONS_URL, key: process.env.SUPPORT_KEY })

const { ticket, duplicate } = await support.createTicket({
  external_ref: `ORD-${order.id}`,      // REQUIRED. A stable id from YOUR system. The same value never makes a second ticket, so retries are safe.
  customer_ref: user.id,                // your id for the customer (optional)
  customer_name: user.name,             // optional
  subject: 'Cannot log in',             // 3 to 200 characters
  description: 'I get an error after the reset email.',   // up to 8000
  category: 'account',                  // bug | billing | account | how_to | feedback | other
  priority: 'high',                     // low | normal | high | urgent
})
// store `ticket` (like "TCK-000042") next to your own record and show it to the customer
```
The report is refused (HTTP 422) if the text contains a card number, a secret key or a password. Tell the customer not to include them. One ticket per real customer request: do not create one per page view.

### Let the customer see replies, answer, and rate
```js
const view = await support.getTicket('ORD-77')   // { ticket: { status, can_reply, can_rate, … }, messages: [{ from: 'support' | 'customer', body, at }], attachments: [...] }
await support.reply('ORD-77', 'Thanks, still failing.')   // not retried automatically (a retry would send it twice)
await support.rate('ORD-77', 5, 'Quick and helpful')       // once, after the ticket is resolved
const f = await support.attachmentLink('ORD-77', attachmentId)   // { url, expires_in: 60 }: use the link immediately
```
Statuses a customer may see: `open`, `in_progress`, `waiting_for_customer`, `resolved`, `closed`. Internal notes, staff names and internal files never appear. A `404` means "no such ticket for this key" (the same answer for a wrong key and a wrong reference).

### Optional but recommended: receive callbacks
So the project can show a reply the moment it is sent, the Workspace **POSTs a signed message** to an address the Main Admin sets (Support desk → Connected projects → Callbacks to the project). Build a route for it in the project:

```js
// Next.js route handler: app/api/support-callback/route.js
import { verifyCallback } from '@/lib/support-client/index.mjs'

export async function POST(request) {
  const raw = await request.text()                          // the EXACT text received: do not parse before verifying
  const ok = await verifyCallback(process.env.SUPPORT_CALLBACK_SECRET, request.headers.get('x-codex-signature'), raw)
  if (!ok) return new Response('invalid signature', { status: 401 })
  const event = JSON.parse(raw)                              // { event, sequence, ticket_ref, external_ref, occurred_at, … }
  // 1. Ignore a repeat: remember x-codex-event-id (or the sequence) you already processed.
  // 2. Ignore a status event whose `sequence` is lower than the last one you applied for that external_ref.
  // 3. For anything important, confirm with support.getTicket(event.external_ref) instead of trusting the message alone.
  return new Response(null, { status: 204 })                 // answer 2xx within 5 seconds; do slow work afterwards
}
```
(Express: use `express.text({ type: '*/*' })` so `req.body` is the raw string.)

Events: `ticket.acknowledged` (first reply), `ticket.reply` (`message: { body, at }`), `ticket.status` (`status`). Failures are retried after 1 min, 5 min, 30 min, 2 h, 12 h, then given up (the Customer Service leads are told). **Rules for the address you give the owner:** `https`, a real domain name (no IP address, no `localhost`, no internal names), port 443 or 8443, no credentials in it, and it must answer from the public internet. A local development machine cannot receive callbacks; poll `getTicket` there instead.

---

## 4. Connection C: Super Dashboard

There is **nothing to install or connect**. The Super Dashboard reads the Workspace's own data, so a project appears in it automatically once A and/or B work: the **Monitoring** card counts the project's health and incidents; the **Customer support** card counts its tickets. Each person sees only the cards their role allows (monitoring: DevOps, Cybersecurity, Main Admin; support: Customer Service lead, Main Admin; spending, renewals and audit come from the Workspace itself). If a card is missing for someone, that is permissions, not a broken connection.

---

## 5. Prove it works (smoke tests)

Run these from the project's server with the real values in the environment. Expected results are shown.

```bash
# A. heartbeat → HTTP 202   {"accepted":1,"duplicates":0,"rejected":0,"out_of_scope":0,"reasons":[]}
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/monitor-ingest" -H "x-monitor-key: $MONITOR_KEY" -H "content-type: application/json" \
  -d '{"events":[{"event_id":"smoke-1","kind":"heartbeat"}]}'
# run it again unchanged → "duplicates":1  (proves a retry is not counted twice)

# B1. ticket → HTTP 201 {"ticket":"TCK-…","duplicate":false}; the same call again → HTTP 200, "duplicate":true
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/support-intake" -H "x-support-key: $SUPPORT_KEY" -H "content-type: application/json" \
  -d '{"external_ref":"smoke-001","subject":"Connection test","description":"Please ignore","category":"other","priority":"low"}'

# B2. what the customer sees → HTTP 200 {"ticket":{…},"messages":[],"attachments":[]}
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/support-ticket" -H "x-support-key: $SUPPORT_KEY" -H "content-type: application/json" \
  -d '{"action":"status","external_ref":"smoke-001"}'

# wrong key → HTTP 401 (both functions), unknown reference → HTTP 404
```
Then ask the owner to confirm: the project is listed in **Super Monitor** (heartbeat just now), and the test ticket is in the **Support desk** (they should close it). Delete nothing yourself.

---

## 6. Rules for agents (read before writing any code)

1. **Never** put a `ctfs_` key, a callback secret, or the Workspace's service-role key in a browser, a public repo, a log line or an error message. Keys go in host environment variables only.
2. **Do not modify the Workspace** (its database, functions or `index.html`). If something there is wrong, tell the owner exactly what and why.
3. **Do not invent fields, categories or statuses.** Use only what is listed here. Unknown categories and priorities quietly become `other` and `normal`.
4. **Do not send personal data or secrets** in monitor messages or ticket text.
5. **Do not trust a callback until its signature is verified**, and verify against the **raw** body.
6. **Handle failure gracefully**: a monitoring or support call failing must never break the project's own page or request (the SDKs do not throw from `captureError`; wrap `createTicket` in try/catch and tell the customer plainly if it failed).
7. **Never claim it works until the smoke tests above pass against the real Workspace.**

## 7. Troubleshooting

| You see | It means | Do this |
|---|---|---|
| `401` from `monitor-ingest` or `support-*` | Key missing, mistyped, revoked, expired, or the wrong kind (`ctfm_` vs `ctfs_`) | Check the variable; ask the Main Admin to make a new key |
| `404` from `support-ticket` | No ticket for this key and reference (same answer for both) | Check `external_ref` is exactly what you sent on creation, and the key belongs to this project |
| `409` | Not possible now: ticket closed, not resolved yet, or already rated | Show the message to the user |
| `422` from `support-intake` | The text contains a card number, secret or password | Remove it and resend |
| `429` | Too many requests | Wait `retryAfterSeconds`, then retry; do not hammer |
| `413` / `400` | Body too large / not valid JSON / a required field missing | Check the field limits above |
| `401` whose body is NOT one of our messages (e.g. says "Missing authorization header" or "Invalid JWT", not "Missing or malformed x-support-key") | The function was deployed **with** JWT checking on, so Supabase rejects the call before our code runs | Ask the owner to redeploy that function with `--no-verify-jwt` |
| `404` whose body says the function was not found (not our "Ticket not found.") | That function is not deployed, or `CODEX_FUNCTIONS_URL` points at the wrong Supabase project | Check the function list and the project reference with the owner |
| `5xx`, or the client says "could not reach" | Network problem, or a function is failing | Retry later; if it persists, tell the owner which function and the time (their function logs will show it) |
| Project never shows as "down" | No heartbeats were ever sent (serverless/browser) | Expected; add a scheduled heartbeat if you need down detection |
| Project shows "down" while it is running | The heartbeat interval registered by the owner is shorter than what you send | Match `heartbeatSeconds` to the registered value |
| Callbacks never arrive | The schedule for `workspace-sweep` is not running, or the address is not public https | Check section 1 item 3 and the Delivery log in the Support desk |
| Callback signature fails | You parsed the body before verifying, or the wrong secret | Verify the raw text; the secret is replaced every time the address is re-saved |

## 8. Definition of done (report this back to the owner)

- [ ] Which pattern was used (server / serverless / browser) and why.
- [ ] The two files were copied, nothing was `npm install`ed, and TypeScript (if used) compiles.
- [ ] All keys are in environment variables; none appears in the repository or the browser bundle (except `MONITOR_KEY` for a browser-only app, on purpose).
- [ ] Smoke test A and B outputs pasted (with the key values removed), and the owner confirmed the project and the test ticket are visible in the Workspace.
- [ ] If callbacks are used: the route verifies the signature on the raw body, ignores repeats and stale `sequence`s, and answers 2xx quickly.
- [ ] What was *not* verified, stated plainly.
