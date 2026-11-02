# Super Monitor client

For the company's **own** projects. (The external Codex Monitor product is separate and unrelated.)

```js
import { createMonitor } from './index.mjs'

const monitor = createMonitor({
  endpoint: 'https://<project-ref>.supabase.co/functions/v1/monitor-ingest',
  key: process.env.MONITOR_KEY,      // ctfm_… , made in Workspace → Super Monitor → Setup, shown once
  environment: 'production',
  release: '1.4.0',
})
monitor.start()                       // heartbeat now and every 5 minutes, plus window error and unhandledrejection handlers
// browser app?  monitor.start({ heartbeat: false })   (a site nobody is visiting must not look "down")
// serverless?   don't rely on start(): call await monitor.flush() before the function returns, and send monitor.heartbeat() from a scheduled route
monitor.captureError(err, { route: '/checkout' })     // fatal: { fatal: true }
monitor.latency('/api/users', 120, 200)               // route, milliseconds, status code
monitor.message('Cache cold', 'warning')
await monitor.flush()                 // optional: before a process exits
```

- No dependencies; browsers and Node 18+. Events are queued (max 200) and sent in batches of up to 20 (the server accepts 50).
- Every event has an id, so a retry is never counted twice. Failures back off (2, 4, 8 … 60 s) and honour `Retry-After`.
- A `401` means the key was revoked or expired: the client stops sending, empties its queue and calls `onAuthFailure`.
- The key is sent only as the `x-monitor-key` header. Do not log it. A key in a browser bundle is visible to anyone: it can only write telemetry within a quota, but revoke and replace it if it leaks.
- The server redacts tokens, e-mails, card-like numbers and `password=…` values, and drops query strings from routes. Still, do not put personal data in messages.

See `docs/workspace/CONNECT_A_PROJECT.md` for the full guide (server, serverless and browser patterns, smoke tests, troubleshooting). TypeScript: `index.d.mts` sits next to the code.
