import { describe, expect, it, vi } from 'vitest'
import { checkupPassed, diagnose, parseDispatchContent, reportText, type BrowserFacts, type CheckupFacts, type DispatchFacts, type ServerFacts } from '../../src/lib/notificationCheckup'
import { runCheckup, type CheckupDeps } from '../../src/lib/notificationCheckupRunner'

const browser = (o: Partial<BrowserFacts> = {}): BrowserFacts => ({ supported: true, needsInstall: false, keyInBuild: true, permission: 'granted', subscribed: true, knownToServer: true, appInFront: false, ...o })
const server = (o: Partial<ServerFacts> = {}): ServerFacts => ({ configured: true, secretSet: true, functionPathOk: true, functionHost: 'abc.supabase.co', devices: 1, pgNetAvailable: true, ...o })
const dispatch = (o: Partial<DispatchFacts> = {}): DispatchFacts => ({ handedOver: true, error: null, answered: true, statusCode: 200, content: '{"ok":true,"sent":1}', netError: null, pgNetAvailable: true, ...o })
const facts = (o: Partial<CheckupFacts> = {}): CheckupFacts => ({ browser: browser(), server: server(), realtimeArrived: true, dispatch: dispatch(), ...o })
const find = (fs: ReturnType<typeof diagnose>, id: string) => fs.find((f) => f.id === id)

describe('diagnosis: this device', () => {
  it('says all is well when everything is in place', () => {
    const fs = diagnose(facts())
    expect(checkupPassed(fs)).toBe(true)
    expect(find(fs, 'subscribed')?.severity).toBe('ok')
    expect(find(fs, 'function')?.severity).toBe('ok')
  })
  it('explains each way a device is not ready, and what to do', () => {
    expect(find(diagnose(facts({ browser: browser({ supported: false, needsInstall: true }) })), 'browser')?.detail).toMatch(/Add to Home Screen/)
    expect(find(diagnose(facts({ browser: browser({ supported: false }) })), 'browser')?.title).toMatch(/can't receive push/)
    expect(find(diagnose(facts({ browser: browser({ keyInBuild: false }) })), 'browser')?.detail).toMatch(/VITE_VAPID_PUBLIC_KEY/)
    expect(find(diagnose(facts({ browser: browser({ permission: 'denied' }) })), 'permission')?.detail).toMatch(/lock or bell/)
    expect(find(diagnose(facts({ browser: browser({ permission: 'default', subscribed: false }) })), 'subscribed')?.severity).toBe('fail')
    expect(find(diagnose(facts({ browser: browser({ knownToServer: false }) })), 'subscribed')?.title).toMatch(/server doesn't know/)
  })
})

describe('diagnosis: the server setup', () => {
  it('names a missing, wrong or weak configuration', () => {
    expect(find(diagnose(facts({ server: server({ configured: false }) })), 'settings')?.detail).toMatch(/push_settings row is missing/)
    expect(find(diagnose(facts({ server: server({ functionPathOk: false, functionHost: 'example.com' }) })), 'settings')?.detail).toMatch(/example\.com/)
    expect(find(diagnose(facts({ server: server({ secretSet: false }) })), 'settings')?.severity).toBe('warn')
    expect(find(diagnose(facts({ server: server({ pgNetAvailable: false }) })), 'pgnet')?.detail).toMatch(/Extensions/)
    expect(find(diagnose(facts({ server: null })), 'server')?.severity).toBe('warn')
  })
  it('does not complain about pg_net when push is not configured at all', () => {
    expect(find(diagnose(facts({ server: server({ configured: false, pgNetAvailable: false }) })), 'pgnet')).toBeUndefined()
  })
})

describe('diagnosis: what happened to the real test notification', () => {
  const only = (d: Partial<DispatchFacts>) => find(diagnose(facts({ dispatch: dispatch(d) })), d.handedOver === false || d.answered === false || d.netError ? 'handover' : 'function')!
  it('the database could not make the call', () => {
    const f = only({ handedOver: false, error: 'schema "net" does not exist' })
    expect(f.severity).toBe('fail'); expect(f.detail).toMatch(/schema "net" does not exist/); expect(f.detail).toMatch(/pg_net/)
    expect(only({ handedOver: false }).detail).toMatch(/20261003000003/)
  })
  it('no answer yet is a warning, not a failure', () => { expect(only({ answered: false, statusCode: null, content: null }).severity).toBe('warn') })
  it('each status code gets its own cure', () => {
    expect(only({ statusCode: 401 }).detail).toMatch(/--no-verify-jwt/)
    expect(only({ statusCode: 403 }).detail).toMatch(/PUSH_WEBHOOK_SECRET/)
    expect(only({ statusCode: 404 }).detail).toMatch(/supabase functions deploy push-dispatch/)
    expect(only({ statusCode: 503, content: '{"error":"VAPID_PRIVATE_KEY is not a valid key"}' }).detail).toMatch(/VAPID_PRIVATE_KEY is not a valid key/)
    expect(only({ statusCode: 503, content: null }).detail).toMatch(/supabase secrets set/)
    expect(only({ statusCode: 500, content: '{"error":"boom"}' }).title).toMatch(/crashed \(500\)/)
    expect(only({ statusCode: 302, content: null }).title).toMatch(/unexpected status \(302\)/)
  })
  it('a function that ran but sent nothing points at devices and account settings', () => {
    const f = only({ content: '{"ok":true,"sent":0}' })
    expect(f.severity).toBe('fail'); expect(f.detail).toMatch(/no registered device|switched off/)
  })
  it('a delivered test is a pass, with tips for when it still does not show', () => {
    const fs = diagnose(facts({ browser: browser({ appInFront: true }) }))
    expect(find(fs, 'function')?.detail).toMatch(/1 message to the push service/)
    expect(find(fs, 'tips')?.severity).toBe('warn')
    expect(find(fs, 'tips')?.detail).toMatch(/another tab/); expect(find(fs, 'tips')?.detail).toMatch(/Do Not Disturb/)
  })
  it('does not show the tips when the test has failed earlier in the chain', () => {
    expect(find(diagnose(facts({ dispatch: dispatch({ statusCode: 403 }) })), 'tips')).toBeUndefined()
  })
})

describe('diagnosis: live in-app updates', () => {
  it('passes, warns or stays quiet', () => {
    expect(find(diagnose(facts({ realtimeArrived: true })), 'realtime')?.severity).toBe('ok')
    const w = find(diagnose(facts({ realtimeArrived: false })), 'realtime')
    expect(w?.severity).toBe('warn'); expect(w?.detail).toMatch(/90 seconds/); expect(w?.detail).toMatch(/20260923000000/)
    expect(find(diagnose(facts({ realtimeArrived: null, dispatch: null })), 'realtime')).toBeUndefined()
  })
  it('a warning alone does not fail the checkup', () => { expect(checkupPassed(diagnose(facts({ realtimeArrived: false })))).toBe(true) })
})

describe('reading the function reply, and the pasteable report', () => {
  it('parses its JSON safely', () => {
    expect(parseDispatchContent('{"ok":true,"sent":2}')).toMatchObject({ ok: true, sent: 2 })
    expect(parseDispatchContent('{"ok":true,"skipped":"no channel"}')).toMatchObject({ skipped: 'no channel', sent: null })
    expect(parseDispatchContent('<html>nope</html>')).toEqual({ ok: false, sent: null, skipped: null, error: null })
    expect(parseDispatchContent(null).ok).toBe(false)
  })
  it('builds a plain-text report that holds no secret', () => {
    const text = reportText(diagnose(facts({ dispatch: dispatch({ statusCode: 403 }) })), new Date('2026-10-25T10:00:00Z'))
    expect(text).toContain('Notification checkup, 2026-10-25T10:00:00.000Z'); expect(text).toContain('[FAIL] The function rejected the secret (403)'); expect(text).toContain('[OK  ]')
  })
})

describe('the checkup sequence', () => {
  const base = (o: Partial<CheckupDeps> = {}): CheckupDeps => ({
    browser: async () => browser(),
    summary: async () => ({ configured: true, secret_set: true, function_host: 'abc.supabase.co', function_path_ok: true, devices: 1, pg_net_available: true }),
    listen: () => ({ ready: Promise.resolve(true), arrived: async () => true, stop: vi.fn() }),
    sendTest: async () => ({ id: 'n1', error: null }),
    result: async () => ({ handed_over: true, pg_net_available: true, answered: true, status_code: 200, content: '{"ok":true,"sent":1}' }),
    sleep: async () => undefined, ...o,
  })
  it('starts listening BEFORE it sends, and stops listening afterwards', async () => {
    const order: string[] = []
    const stop = vi.fn(() => order.push('stop'))
    const r = await runCheckup(base({ listen: () => { order.push('listen'); return { ready: Promise.resolve(true), arrived: async () => true, stop } }, sendTest: async () => { order.push('send'); return { id: 'n1', error: null } } }))
    expect(order).toEqual(['listen', 'send', 'stop'])
    expect(r.facts.realtimeArrived).toBe(true); expect(r.facts.dispatch?.statusCode).toBe(200); expect(r.testId).toBe('n1')
    expect(checkupPassed(diagnose(r.facts))).toBe(true)
  })
  it('waits for the function to answer, polling until it does', async () => {
    let calls = 0; const sleep = vi.fn(async () => undefined)
    const r = await runCheckup(base({ result: async () => (++calls < 3 ? { handed_over: true, pg_net_available: true, answered: false } : { handed_over: true, pg_net_available: true, answered: true, status_code: 403, content: '{"error":"Forbidden"}' }), sleep }))
    expect(calls).toBe(3); expect(sleep).toHaveBeenCalledTimes(2); expect(r.facts.dispatch?.statusCode).toBe(403)
  })
  it('gives up after the time limit and reports "no answer yet"', async () => {
    const r = await runCheckup(base({ result: async () => ({ handed_over: true, pg_net_available: true, answered: false }) }), undefined, { pollEveryMs: 1, pollForMs: 5, })
    expect(r.facts.dispatch?.answered).toBe(false)
    expect(diagnose(r.facts).find((f) => f.id === 'handover')?.severity).toBe('warn')
  })
  it('stops waiting immediately when the database could not hand the call over', async () => {
    const result = vi.fn(async () => ({ handed_over: false, pg_net_available: false, error: 'schema "net" does not exist' }))
    const r = await runCheckup(base({ result }))
    expect(result).toHaveBeenCalledTimes(1)
    expect(diagnose(r.facts).find((f) => f.id === 'handover')?.detail).toMatch(/schema "net" does not exist/)
  })
  it('reports a test that could not be created without throwing, and still stops listening', async () => {
    const stop = vi.fn()
    const r = await runCheckup(base({ listen: () => ({ ready: Promise.resolve(true), arrived: async () => true, stop }), sendTest: async () => ({ id: null, error: new Error('Wait a few seconds between tests.') }) }))
    expect(r.testError).toBe('Wait a few seconds between tests.'); expect(r.facts.dispatch).toBeNull(); expect(stop).toHaveBeenCalled()
  })
  it('records that live updates did not arrive, or could not even be listened for', async () => {
    const a = await runCheckup(base({ listen: () => ({ ready: Promise.resolve(true), arrived: async () => false, stop: vi.fn() }) }))
    expect(a.facts.realtimeArrived).toBe(false)
    const b = await runCheckup(base({ listen: () => ({ ready: Promise.resolve(false), arrived: async () => true, stop: vi.fn() }) }))
    expect(b.facts.realtimeArrived).toBe(false)
  })
  it('survives a failing server summary and a failing result lookup', async () => {
    const r = await runCheckup(base({ summary: async () => { throw new Error('offline') }, result: async () => { throw new Error('offline') } }), undefined, { pollEveryMs: 1, pollForMs: 3 })
    expect(r.facts.server).toBeNull(); expect(r.facts.dispatch).toBeNull()
  })
  it('narrates its progress', async () => {
    const seen: string[] = []
    await runCheckup(base(), (m) => seen.push(m))
    expect(seen[0]).toMatch(/device/); expect(seen.some((m) => /real test notification/.test(m))).toBe(true)
  })
})
