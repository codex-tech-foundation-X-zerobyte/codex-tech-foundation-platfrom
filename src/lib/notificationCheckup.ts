/**
 * Turns what the notification checkup measured into plain-English findings, each with the one thing to do about it.
 * Pure: the checkup gathers the facts (browser, server, a real test notification), this decides what they mean.
 */
export type Severity = 'ok' | 'warn' | 'fail'
export interface Finding { id: string; severity: Severity; title: string; detail: string }

export interface BrowserFacts {
  supported: boolean
  needsInstall: boolean            // iPhone/iPad outside the installed app
  keyInBuild: boolean              // VITE_VAPID_PUBLIC_KEY was present when this app was built
  permission: 'granted' | 'denied' | 'default' | 'unsupported'
  subscribed: boolean              // this browser holds a push subscription
  knownToServer: boolean | null    // the server has THIS browser's endpoint (null = could not tell)
  appInFront: boolean              // the tab is visible and focused right now
}
export interface ServerFacts { configured: boolean; secretSet: boolean; functionPathOk: boolean; functionHost: string | null; devices: number; pgNetAvailable: boolean }
export interface DispatchFacts { handedOver: boolean; error: string | null; answered: boolean; statusCode: number | null; content: string | null; netError: string | null; pgNetAvailable: boolean }
export interface CheckupFacts {
  browser: BrowserFacts
  server: ServerFacts | null
  /** The realtime path: did the test notification arrive in this tab live? null = the test was not run. */
  realtimeArrived: boolean | null
  /** The database-to-function hop for the test notification; null = the test was not run. */
  dispatch: DispatchFacts | null
}

/** What the push-dispatch function said, in its own JSON (only the fields we need). */
export function parseDispatchContent(content: string | null): { ok: boolean; sent: number | null; skipped: string | null; error: string | null } {
  if (!content) return { ok: false, sent: null, skipped: null, error: null }
  try {
    const j = JSON.parse(content) as { ok?: boolean; sent?: number; skipped?: string; error?: string }
    return { ok: j.ok === true, sent: typeof j.sent === 'number' ? j.sent : null, skipped: typeof j.skipped === 'string' ? j.skipped : null, error: typeof j.error === 'string' ? j.error : null }
  } catch { return { ok: false, sent: null, skipped: null, error: null } }
}

const f = (id: string, severity: Severity, title: string, detail: string): Finding => ({ id, severity, title, detail })

export function diagnose(x: CheckupFacts): Finding[] {
  const out: Finding[] = []
  const b = x.browser

  // 1. This device
  if (!b.supported) out.push(b.needsInstall
    ? f('browser', 'fail', 'This iPhone or iPad needs the app installed first', 'Tap Share, then Add to Home Screen, open the app from the new icon, and turn notifications on there. Safari tabs cannot receive push.')
    : f('browser', 'fail', "This browser can't receive push notifications", 'Use a current Chrome, Edge, Firefox or Safari, or install the app on your phone.'))
  else if (!b.keyInBuild) out.push(f('browser', 'fail', 'This build of the app has no push key', 'VITE_VAPID_PUBLIC_KEY was not set when the app was deployed. Add it in Vercel (Settings, Environment Variables), then redeploy.'))
  else if (b.permission === 'denied') out.push(f('permission', 'fail', 'Notifications are blocked for this site', 'Allow them in the browser (the lock or bell icon beside the address bar), or in the phone Settings for this app, then turn push on again.'))
  else if (b.permission === 'default' || !b.subscribed) out.push(f('subscribed', 'fail', "This device isn't turned on yet", 'Switch on Push notifications above and allow the browser prompt. Without that, nothing can reach this device.'))
  else if (b.knownToServer === false) out.push(f('subscribed', 'fail', "This device is subscribed but the server doesn't know about it", 'Turn push off and on again on this device so it registers itself. If that fails, sign out and back in.'))
  else out.push(f('subscribed', 'ok', 'This device is turned on and registered', 'The browser allows notifications and the server has this device.'))

  // 2. Server setup
  const s = x.server
  if (!s) out.push(f('server', 'warn', "Couldn't read the server setup", 'Check your connection and run the checkup again. If it keeps failing, run supabase db push to apply the latest migrations.'))
  else {
    if (!s.configured) out.push(f('settings', 'fail', 'The database has not been told where to send notifications', 'The push_settings row is missing, so no event ever triggers a push. Insert it (docs/NOTIFICATIONS.md, setup step 4): the address of the push-dispatch function and the shared secret.'))
    else if (!s.functionPathOk) out.push(f('settings', 'fail', 'The push address looks wrong', `It should look like https://<project-ref>.supabase.co/functions/v1/push-dispatch. The database has ${s.functionHost ?? 'nothing'} instead. Correct the function_url in push_settings.`))
    else if (!s.secretSet) out.push(f('settings', 'warn', 'The shared secret looks too short', 'Use a long random value (at least 16 characters) in both push_settings and the PUSH_WEBHOOK_SECRET secret on the function.'))
    else out.push(f('settings', 'ok', 'The database knows where to send notifications', `Events go to ${s.functionHost}.`))
    if (s.configured && !s.pgNetAvailable) out.push(f('pgnet', 'fail', 'The pg_net extension is not enabled', 'The database sends notifications to the function using pg_net. In Supabase, open Database, then Extensions, search pg_net and enable it.'))
  }

  // 3. A real test notification through the real path
  const d = x.dispatch
  if (d) {
    if (!d.handedOver) out.push(f('handover', 'fail', 'The database could not call the push function', d.error ? `The database reported: ${d.error}. This usually means pg_net is not enabled or the address in push_settings is invalid.` : 'Nothing was recorded for the test, so the push trigger did not run. Re-run the notification migrations (20260930000001 and 20261003000003) in the SQL editor.'))
    else if (!d.answered) out.push(f('handover', 'warn', 'The function has not answered yet', 'The database made the call but no reply is recorded. Wait a few seconds and run the checkup again; if it never answers, check the function is deployed and not stuck.'))
    else if (d.netError) out.push(f('handover', 'fail', "The database couldn't reach the function", `${d.netError}. Check the address in push_settings and that the function is deployed.`))
    else {
      const code = d.statusCode ?? 0
      const body = parseDispatchContent(d.content)
      if (code === 401) out.push(f('function', 'fail', 'Supabase rejected the call before the function ran (401)', 'The function was deployed with JWT checking switched on. Redeploy it with: supabase functions deploy push-dispatch --no-verify-jwt'))
      else if (code === 403) out.push(f('function', 'fail', 'The function rejected the secret (403)', 'The secret in push_settings must be exactly the PUSH_WEBHOOK_SECRET set on the function, with no spaces or line breaks. Set both to the same value.'))
      else if (code === 404) out.push(f('function', 'fail', 'Nothing is deployed at that address (404)', 'Deploy it with: supabase functions deploy push-dispatch --no-verify-jwt, and check the function_url in push_settings.'))
      else if (code === 503) out.push(f('function', 'fail', 'The function is missing its keys (503)', `${body.error ?? 'Push is not configured.'} Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and PUSH_WEBHOOK_SECRET with supabase secrets set, then try again.`))
      else if (code >= 500) out.push(f('function', 'fail', `The function crashed (${code})`, `${body.error ?? 'See the function logs in Supabase (Edge Functions, push-dispatch, Logs).'}`))
      else if (code !== 200) out.push(f('function', 'fail', `The function answered with an unexpected status (${code})`, 'Open the function logs in Supabase (Edge Functions, push-dispatch, Logs) for details.'))
      else if (body.sent === 0 || body.sent === null && body.skipped) out.push(f('function', 'fail', 'The function ran, but sent nothing', 'It found no device to send to: this account has no registered device, or push is switched off for this account in Settings, Notifications. Turn push on above, then run the checkup again.'))
      else out.push(f('function', 'ok', 'The push function accepted and sent the test', `It handed ${body.sent ?? 'the'} message${body.sent === 1 ? '' : 's'} to the push service. If it still does not appear on this device, see the tips below.`))
    }
  }

  // 4. Live updates inside the app
  if (x.realtimeArrived === false) out.push(f('realtime', 'warn', 'Live in-app updates did not arrive', 'The test notification was saved but this tab did not hear about it live. The unread badge still refreshes every 90 seconds and when you come back to the tab. For instant updates, make sure the notifications table is in the realtime publication (migration 20260923000000).'))
  else if (x.realtimeArrived === true) out.push(f('realtime', 'ok', 'Live in-app updates work', 'The test notification appeared in this tab the moment it was created.'))

  // 5. The usual reasons a working setup looks broken
  if (x.dispatch && out.some((o) => o.id === 'function' && o.severity === 'ok') && b.subscribed) {
    out.push(f('tips', b.appInFront ? 'warn' : 'ok', 'If the test still does not show up on this device',
      'Switch to another tab or app and send the test again: a system notification is not shown while you are looking at the app, and the test is the exception only for the browser. Then check that the phone or computer is not in Do Not Disturb or Focus mode, and that notifications are allowed for this browser in the operating system settings.'))
  }
  return out
}

/** Worst severity first-aid: true when nothing needs fixing. */
export const checkupPassed = (findings: Finding[]) => findings.every((x) => x.severity !== 'fail')

/** A plain-text copy of the findings for pasting into a message to whoever looks after the setup. Contains no secrets. */
export function reportText(findings: Finding[], when = new Date()): string {
  const mark = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' } as const
  return [`Notification checkup, ${when.toISOString()}`, ...findings.map((x) => `[${mark[x.severity]}] ${x.title}\n       ${x.detail}`)].join('\n')
}
