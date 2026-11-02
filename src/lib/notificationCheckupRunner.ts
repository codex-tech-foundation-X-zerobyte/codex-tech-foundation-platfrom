import type { BrowserFacts, CheckupFacts, DispatchFacts, ServerFacts } from './notificationCheckup'

/** Everything the checkup needs from the outside world, so the sequence can be tested with fakes. */
export interface CheckupDeps {
  browser: () => Promise<BrowserFacts>
  summary: () => Promise<{ configured: boolean; secret_set: boolean; function_host: string | null; function_path_ok: boolean; devices: number; pg_net_available: boolean } | null>
  listen: () => { ready: Promise<boolean>; arrived: (id: string, ms?: number) => Promise<boolean>; stop: () => void }
  sendTest: () => Promise<{ id: string | null; error: Error | null }>
  result: (id: string) => Promise<{ handed_over: boolean; pg_net_available: boolean; error?: string | null; answered?: boolean; status_code?: number | null; content?: string | null } | null>
  sleep: (ms: number) => Promise<void>
}
export interface CheckupProgress { (message: string): void }

/**
 * The checkup, in order: read this device, read the server setup, send a real test notification through the database trigger while listening
 * for it live, then poll for what the push function answered. It never throws: whatever could not be measured is reported as unknown.
 */
export async function runCheckup(deps: CheckupDeps, onProgress: CheckupProgress = () => undefined, opts: { pollEveryMs?: number; pollForMs?: number } = {}): Promise<{ facts: CheckupFacts; testId: string | null; testError: string | null }> {
  const pollEvery = opts.pollEveryMs ?? 1500, pollFor = opts.pollForMs ?? 12000
  onProgress('Looking at this device…')
  const browser = await deps.browser()
  onProgress('Reading the server setup…')
  const s = await deps.summary().catch(() => null)
  const server: ServerFacts | null = s ? { configured: s.configured, secretSet: s.secret_set, functionPathOk: s.function_path_ok, functionHost: s.function_host, devices: s.devices, pgNetAvailable: s.pg_net_available } : null

  onProgress('Sending a real test notification…')
  const live = deps.listen()
  let realtimeArrived: boolean | null = null
  let dispatch: DispatchFacts | null = null
  let testId: string | null = null, testError: string | null = null
  try {
    const subscribed = await live.ready
    const sent = await deps.sendTest()
    if (sent.error || !sent.id) { testError = sent.error?.message ?? 'The test could not be created.' } else {
      testId = sent.id
      const arrival = subscribed ? live.arrived(sent.id) : Promise.resolve(false)
      onProgress('Waiting for the push function to answer…')
      const start = Date.now()
      for (;;) {
        const r = await deps.result(sent.id).catch(() => null)
        if (r) {
          dispatch = { handedOver: r.handed_over, error: r.error ?? null, answered: Boolean(r.answered), statusCode: r.status_code ?? null, content: r.content ?? null, netError: r.answered && !r.status_code && r.error ? r.error : null, pgNetAvailable: r.pg_net_available }
          if (!r.handed_over || r.answered) break
          if (!r.pg_net_available) break
        }
        if (Date.now() - start >= pollFor) break
        await deps.sleep(pollEvery)
      }
      onProgress('Checking live updates…')
      realtimeArrived = await arrival
    }
  } finally { live.stop() }
  return { facts: { browser, server, realtimeArrived, dispatch }, testId, testError }
}
