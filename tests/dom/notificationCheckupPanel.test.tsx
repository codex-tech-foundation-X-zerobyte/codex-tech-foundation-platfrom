import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profile: { id: 'me', role: 'worker' } as { id: string; role: string } | null,
  summary: { configured: true, secret_set: true, function_host: 'abc.supabase.co', function_path_ok: true, devices: 1, pg_net_available: true } as Record<string, unknown> | null,
  sent: { id: 'n1', error: null } as { id: string | null; error: Error | null },
  result: { handed_over: true, pg_net_available: true, answered: true, status_code: 200, content: '{"ok":true,"sent":1}' } as Record<string, unknown>,
  arrived: true,
  stop: vi.fn(),
  toasts: [] as string[],
}))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: h.profile }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (m: string) => { h.toasts.push(m) } }) }))
vi.mock('../../src/lib/push', () => ({
  getBrowserFacts: async () => ({ supported: true, needsInstall: false, keyInBuild: true, permission: 'granted', subscribed: true, knownToServer: true, appInFront: true }),
}))
vi.mock('../../src/lib/services', () => ({
  pushSetupSummary: async () => ({ data: h.summary, error: null }),
  sendTestNotification: async () => h.sent,
  pushDispatchResult: async () => ({ data: h.result, error: null }),
  listenForLiveNotifications: () => ({ ready: Promise.resolve(true), arrived: async () => h.arrived, stop: h.stop }),
}))
import { NotificationCheckup } from '../../src/components/NotificationCheckup'

beforeEach(() => {
  h.profile = { id: 'me', role: 'worker' }
  h.summary = { configured: true, secret_set: true, function_host: 'abc.supabase.co', function_path_ok: true, devices: 1, pg_net_available: true }
  h.sent = { id: 'n1', error: null }
  h.result = { handed_over: true, pg_net_available: true, answered: true, status_code: 200, content: '{"ok":true,"sent":1}' }
  h.arrived = true; h.stop.mockClear(); h.toasts.length = 0
})
const run = async () => { render(<NotificationCheckup />); await userEvent.click(screen.getByRole('button', { name: /Run a full checkup/ })); return screen.findByLabelText('Notification checkup results') }

describe('the notification checkup panel', () => {
  it('shows nothing for someone who is not signed in', () => {
    h.profile = null
    const { container } = render(<NotificationCheckup />)
    expect(container.textContent).toBe('')
  })
  it('reports that nothing is broken when every step works, and still gives the "looks broken but is not" tips', async () => {
    const results = await run()
    expect(within(results).getByText('Nothing is broken.')).toBeTruthy()
    expect(within(results).getByText('The push function accepted and sent the test')).toBeTruthy()
    expect(within(results).getByText('Live in-app updates work')).toBeTruthy()
    expect(within(results).getByText(/If the test still does not show up/)).toBeTruthy()
    expect(h.stop).toHaveBeenCalled()
  })
  it('names the broken step and the exact fix: the function rejects the secret', async () => {
    h.result = { handed_over: true, pg_net_available: true, answered: true, status_code: 403, content: '{"error":"Forbidden"}' }
    const results = await run()
    expect(within(results).getByText('Found something to fix:')).toBeTruthy()
    expect(within(results).getByText('The function rejected the secret (403)')).toBeTruthy()
    expect(within(results).getByText(/exactly the PUSH_WEBHOOK_SECRET/)).toBeTruthy()
  })
  it('names the broken step: the function was deployed with JWT checking on', async () => {
    h.result = { handed_over: true, pg_net_available: true, answered: true, status_code: 401, content: null }
    expect(within(await run()).getByText(/--no-verify-jwt/)).toBeTruthy()
  })
  it('names the broken step: the database cannot call out', async () => {
    h.result = { handed_over: false, pg_net_available: false, error: 'schema "net" does not exist' }
    const results = await run()
    expect(within(results).getByText('The database could not call the push function')).toBeTruthy()
    expect(within(results).getByText(/schema "net" does not exist/)).toBeTruthy()
  })
  it('names the broken step: nobody told the database where to send', async () => {
    h.summary = { configured: false, secret_set: false, function_host: null, function_path_ok: false, devices: 1, pg_net_available: true }
    h.result = { handed_over: false, configured: false, pg_net_available: true }
    expect(within(await run()).getByText('The database has not been told where to send notifications')).toBeTruthy()
  })
  it('warns, without failing, when live updates did not arrive', async () => {
    h.arrived = false
    const results = await run()
    expect(within(results).getByText('Nothing is broken.')).toBeTruthy()
    expect(within(results).getByText('Live in-app updates did not arrive')).toBeTruthy()
  })
  it('shows a test that could not be created, in words', async () => {
    h.sent = { id: null, error: new Error('Wait a few seconds between tests.') }
    render(<NotificationCheckup />)
    await userEvent.click(screen.getByRole('button', { name: /Run a full checkup/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('Wait a few seconds between tests.')
  })
  it('copies a report with no secrets in it', async () => {
    const write = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    h.result = { handed_over: true, pg_net_available: true, answered: true, status_code: 403, content: '{"error":"Forbidden"}' }
    const results = await run()
    await userEvent.click(within(results).getByRole('button', { name: /Copy report/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const text = (write.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('Notification checkup'); expect(text).toContain('[FAIL] The function rejected the secret (403)'); expect(text).not.toMatch(/secret-value|eyJ/)
    expect(h.toasts).toContain('Report copied.')
  })
})
