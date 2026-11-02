import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionReport } from '../../src/lib/services'
import { APP_EVENTS, APP_PERMISSIONS, FUNCTION_COMMANDS, MIGRATIONS, SERVER_SECRETS, buildSteps, loadTicks, makeWebhookSecret, progress, saveTicks, stepStatuses, webhookEndpoint } from '../../src/lib/githubSetupGuide'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const { s, calls } = vi.hoisted(() => ({ s: {} as Record<string, any>, calls: [] as string[] })) // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => { calls.push('supabase'); return {} }, functions: { invoke: async () => { calls.push('invoke'); return { data: null, error: null } } }, auth: { getUser: async () => ({ data: { user: null } }) } } }))
vi.mock('../../src/lib/services', async (orig) => {
  const actual = await orig<typeof import('../../src/lib/services')>()
  return {
    ...actual,
    githubInstallations: async () => { calls.push('githubInstallations'); return { data: { app_configured: true, installations: s.installations }, error: null } },
    listLinkedRepositories: async () => { calls.push('listLinkedRepositories'); return { data: s.linked, error: null } },
  }
})
import { GithubSetupGuide } from '../../src/pages/admin/GithubSetupGuide'

const REF = 'abcdefghijkl'
const steps = buildSteps(REF)
const ck = (id: string, status: string, detail = `${id} detail`, group = 'github') => ({ id, group, label: id, status, detail })
const okReport = (over: Any = {}): ConnectionReport => ({ checked_at: '2026-11-01T12:00:00Z', overall: { status: 'ok', failed: 0, warned: 0 }, checks: [
  ck('secret-app-id', 'ok', '', 'server'), ck('secret-key', 'ok', '', 'server'), ck('secret-webhook', 'ok', '', 'server'),
  ck('app', 'ok', 'Signed in as the App.'), ck('app-read', 'ok'), ck('app-write', 'skipped'), ck('app-events', 'ok'),
  ck('installation', 'ok'), ck('webhook', 'ok', 'The last 3 deliveries all succeeded.'), ck('migrations', 'ok', 'Every GitHub table is present.', 'database'),
  ...(over.extra ?? []),
].map((c) => (over[c.id] ? { ...c, ...over[c.id] } : c)) as ConnectionReport['checks'] })
const ctx = { installationsCount: 1, linkedCount: 2 }
const none = new Set<string>()

describe('setup guide logic', () => {
  it('builds the webhook address from the project reference, with a clear placeholder when it is unknown', () => {
    expect(webhookEndpoint(REF)).toBe(`https://${REF}.supabase.co/functions/v1/github-webhook`)
    expect(webhookEndpoint(null)).toContain('YOUR-PROJECT-REF')
    expect(steps.find((x) => x.id === 'create-app')!.copy[0].value).toBe(webhookEndpoint(REF))
  })

  it('makes a 64-character hex secret from 32 random bytes, different every time', () => {
    expect(makeWebhookSecret()).toMatch(/^[0-9a-f]{64}$/)
    expect(makeWebhookSecret()).not.toBe(makeWebhookSecret())
    let asked = 0
    const fake = { getRandomValues: ((a: Uint8Array) => { asked = a.length; a.forEach((_, i) => { a[i] = i }); return a }) as Crypto['getRandomValues'] }
    expect(makeWebhookSecret(fake)).toBe(Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(''))
    expect(asked).toBe(32)
  })

  it('every step says why, what to do and how you will know; ids are unique; optional steps are last', () => {
    expect(new Set(steps.map((x) => x.id)).size).toBe(steps.length)
    for (const x of steps) { expect(x.why.length, x.id).toBeGreaterThan(20); expect(x.proof.length, x.id).toBeGreaterThan(10); expect(x.actions.length, x.id).toBeGreaterThan(0) }
    const firstOptional = steps.findIndex((x) => !x.required)
    expect(steps.slice(firstOptional).every((x) => !x.required)).toBe(true)
  })

  it('carries every value the owner needs: three migrations, three commands (webhook without a login check), seven permissions, six events, three secrets', () => {
    expect(MIGRATIONS).toHaveLength(3); expect(FUNCTION_COMMANDS).toHaveLength(3); expect(APP_PERMISSIONS).toHaveLength(7); expect(APP_EVENTS).toHaveLength(6); expect(SERVER_SECRETS).toEqual(['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET'])
    expect(FUNCTION_COMMANDS.find((c) => c.includes('github-webhook'))).toContain('--no-verify-jwt')
    expect(FUNCTION_COMMANDS.find((c) => c.includes('integrations'))).not.toContain('--no-verify-jwt')
    expect(APP_PERMISSIONS.some((p) => p.startsWith('Checks'))).toBe(true)                    // the easy one to forget
  })

  it('without a connection check nothing that needs evidence is shown as done', () => {
    const st = stepStatuses(steps, null, { installationsCount: 0, linkedCount: 0 }, none)
    for (const id of ['migrations', 'webhook-secret', 'create-app', 'secrets', 'webhook-test'] as const) expect(st[id].state, id).toBe('unknown')
    expect(st.deploy.state).toBe('unknown'); expect(st.schedule.state).toBe('unknown')
    expect(st.install.state).toBe('todo'); expect(st['link-repos'].state).toBe('todo'); expect(st.select.state).toBe('blocked')
    expect(progress(steps, st)).toMatchObject({ done: 0, next: 'migrations', complete: false })
  })

  it('a clean report plus linked repositories and the two ticked steps completes every required step', () => {
    const st = stepStatuses(steps, okReport(), ctx, new Set(['schedule']))
    for (const x of steps.filter((y) => y.required)) expect(st[x.id].state, x.id).toBe('done')
    expect(progress(steps, st)).toMatchObject({ done: 10, total: 10, next: null, complete: true })
  })

  it('problems are reported as to-do with the check\u2019s own explanation, and later steps wait', () => {
    const report = okReport({ migrations: { status: 'fail', detail: 'Not found: github_actions. Run 20261007000000_github_write_access.sql.' }, 'secret-key': { status: 'fail', label: 'GITHUB_APP_PRIVATE_KEY', detail: 'Set, but it is not a usable private key.' }, webhook: { status: 'fail', detail: 'None of the last 3 deliveries succeeded (status 401).' } })
    const st = stepStatuses(steps, report, ctx, none)
    expect(st.migrations).toEqual({ state: 'todo', note: 'Not found: github_actions. Run 20261007000000_github_write_access.sql.' })
    expect(st.secrets.state).toBe('todo'); expect(st.secrets.note).toContain('not a usable private key')
    expect(st['webhook-test'].state).toBe('todo'); expect(st['webhook-test'].note).toContain('401')
    expect(st.deploy.state).toBe('unknown')                                                  // a failing webhook is NOT evidence the functions are deployed
    expect(progress(steps, st).next).toBe('migrations')
  })

  it('the App step waits for the secrets instead of claiming a failure it cannot know', () => {
    const st = stepStatuses(steps, okReport({ app: { status: 'skipped', detail: 'Needs GITHUB_APP_ID first.' }, installation: { status: 'skipped', detail: 'Needs the App to sign in first.' }, webhook: { status: 'skipped', detail: 'Needs the App to sign in first.' } }), ctx, none)
    expect(st['create-app'].state).toBe('unknown'); expect(st['create-app'].note).toMatch(/secrets are set/)
    expect(st.select.state).toBe('blocked'); expect(st['webhook-test'].state).toBe('blocked')
  })

  it('missing read permissions or events keep the App step open, with the reason', () => {
    const st = stepStatuses(steps, okReport({ 'app-read': { status: 'fail', detail: 'The App is missing: checks (read).' }, 'app-events': { status: 'warn', detail: 'Not subscribed to: workflow run.' } }), ctx, none)
    expect(st['create-app'].state).toBe('todo'); expect(st['create-app'].note).toContain('checks (read)'); expect(st['create-app'].note).toContain('workflow run')
  })

  it('a missing webhook event ALONE keeps the App step open (permissions fine, events not)', () => {
    const st = stepStatuses(steps, okReport({ 'app-events': { status: 'warn', detail: 'Not subscribed to: workflow run.' } }), ctx, none)
    expect(st['create-app'].state).toBe('todo'); expect(st['create-app'].note).toBe('Not subscribed to: workflow run.')
    expect(progress(steps, st).complete).toBe(false)
  })

  it('deploying is recognised from a working webhook or the person\u2019s own tick, never guessed', () => {
    expect(stepStatuses(steps, okReport(), ctx, none).deploy.state).toBe('done')
    expect(stepStatuses(steps, okReport({ webhook: { status: 'warn' } }), ctx, none).deploy.state).toBe('unknown')
    expect(stepStatuses(steps, null, ctx, new Set(['deploy'])).deploy.state).toBe('done')
    expect(stepStatuses(steps, null, ctx, none).deploy.state).toBe('unknown')
  })

  it('selecting an installation waits until GitHub has reported one', () => {
    expect(stepStatuses(steps, okReport(), { installationsCount: 0, linkedCount: 1 }, none).select.state).toBe('blocked')
    expect(stepStatuses(steps, okReport(), { installationsCount: null, linkedCount: null }, none).install.state).toBe('unknown')
  })

  it('optional steps never block completion and describe their state honestly', () => {
    const readOnly = stepStatuses(steps, okReport(), ctx, new Set(['schedule']))
    expect(readOnly.writes.state).toBe('optional'); expect(readOnly.vercel.state).toBe('optional')
    expect(progress(steps, readOnly).complete).toBe(true)
    const writable = stepStatuses(steps, okReport({ 'app-write': { status: 'ok' } }), ctx, none)
    expect(writable.writes.state).toBe('done')
    const vercelBad = stepStatuses(steps, okReport({ extra: [ck('vercel-a/b', 'fail', 'Vercel could not find that project.', 'vercel')] }), ctx, none)
    expect(vercelBad.vercel).toEqual({ state: 'todo', note: 'Vercel could not find that project.' })
    expect(stepStatuses(steps, okReport({ extra: [ck('vercel-a/b', 'ok', '', 'vercel')] }), ctx, none).vercel.state).toBe('done')
  })

  it('ticks survive bad storage: corrupt or odd saved data gives an empty set, a throwing store never breaks the page', () => {
    expect([...loadTicks({ getItem: () => '{not json' })]).toEqual([])
    expect([...loadTicks({ getItem: () => '{"a":1}' })]).toEqual([])
    expect([...loadTicks({ getItem: () => '["deploy",5,null,"schedule"]' })]).toEqual(['deploy', 'schedule'])
    expect([...loadTicks({ getItem: () => { throw new Error('denied') } })]).toEqual([])
    expect([...loadTicks(null)]).toEqual([])
    let saved = ''
    saveTicks(new Set(['deploy']), { setItem: (_k, v) => { saved = v } }); expect(JSON.parse(saved)).toEqual(['deploy'])
    expect(() => saveTicks(new Set(['x']), { setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})

describe('setup guide screen', () => {
  const writeText = vi.fn()
  beforeEach(() => {
    calls.length = 0; localStorage.clear(); writeText.mockReset(); writeText.mockResolvedValue(undefined)
    vi.stubEnv('VITE_SUPABASE_URL', `https://${REF}.supabase.co`)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.assign(s, { installations: [], linked: [] })
  })
  const show = (report: ConnectionReport | null = null, connected = false) => render(<GithubSetupGuide report={report} connected={connected} />)

  it('lists every step in order, opens the one to do next, and claims nothing before the check has run', async () => {
    show()
    const list = await screen.findByRole('list', { name: '' }).catch(() => null); void list
    const titles = steps.map((x) => x.title)
    for (const t of titles) expect(screen.getByText(t, { exact: false })).toBeTruthy()
    expect(screen.getByText(/0 of 10 required steps done/)).toBeTruthy()
    expect(screen.getByText('Do this next')).toBeTruthy()
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.getByText(/Nothing has been checked yet/)).toBeTruthy()
    expect(screen.getByText('Run the three database files').closest('details')!.hasAttribute('open')).toBe(true)
    expect(screen.getByText('Create the GitHub App').closest('details')!.hasAttribute('open')).toBe(false)
  })

  it('updates from a real report: finished steps say Done and the highlight moves on', async () => {
    Object.assign(s, { installations: [{ installation_id: 1, account_login: 'codex', removed: false, suspended: false }], linked: [{ id: 'r1' }] })
    show(okReport({ migrations: { status: 'ok' } }))
    await waitFor(() => expect(screen.getAllByText('Done').length).toBeGreaterThan(3))
    expect(screen.getByText('Run the three database files').closest('summary')!.textContent).toContain('Done')
    expect(screen.getByText('Schedule the background job').closest('details')!.hasAttribute('open')).toBe(true)   // the only required step left
    expect(screen.getByText(/9 of 10 required steps done/)).toBeTruthy()          // everything but the scheduler, which only the person can confirm
  })

  it('shows the webhook address for this project and copies it on request', async () => {
    show()
    const row = (await screen.findByLabelText('Copy Webhook URL')).closest('.ctf-guide__copy') as HTMLElement
    expect(within(row).getByText(webhookEndpoint(REF))).toBeTruthy()
    await userEvent.click(screen.getByLabelText('Copy Webhook URL'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(webhookEndpoint(REF)))
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('says so when the browser blocks copying, instead of pretending it worked', async () => {
    writeText.mockRejectedValue(new Error('blocked'))
    show()
    await userEvent.click(await screen.findByLabelText('Copy Webhook URL'))
    expect(await screen.findByText(/Your browser blocked copying/)).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })

  it('makes a webhook secret in the browser, different each time, and sends it nowhere', async () => {
    show()
    await screen.findByText('Make a webhook secret')
    expect(screen.queryByText(/Your webhook secret/)).toBeNull()                           // nothing is shown before the button is pressed
    const before = calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Make a secret' }))
    const first = (await screen.findByLabelText('Copy Your webhook secret (copy it now)')).closest('.ctf-guide__copy')!.querySelector('code')!.textContent!
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    await userEvent.click(screen.getByRole('button', { name: 'Make a different secret' }))
    const second = screen.getByLabelText('Copy Your webhook secret (copy it now)').closest('.ctf-guide__copy')!.querySelector('code')!.textContent!
    expect(second).toMatch(/^[0-9a-f]{64}$/); expect(second).not.toBe(first)
    expect(calls.slice(before)).toEqual([])                                                // no request of any kind was made
    expect(localStorage.length).toBe(0)                                                    // and nothing was saved
    expect(screen.getByRole('note').textContent).toMatch(/not saved or sent anywhere/)
  })

  it('manual steps are ticked by the person, saved in this browser only, and counted', async () => {
    show()
    const box = (await screen.findAllByRole('checkbox'))[0] as HTMLInputElement
    expect(box.checked).toBe(false)
    await userEvent.click(box)
    expect(JSON.parse(localStorage.getItem('ctf.githubSetup.v1')!)).toContain('deploy')
    await waitFor(() => expect(screen.getByText('Deploy the three functions').closest('summary')!.textContent).toContain('Done'))
    expect(screen.getByText(/1 of 10 required steps done/)).toBeTruthy()
    expect(screen.getAllByText(/saved in this browser only/).length).toBeGreaterThan(0)
  })

  it('reads installations and linked repositories to tell those steps apart', async () => {
    Object.assign(s, { installations: [{ installation_id: 1, account_login: 'codex', removed: false, suspended: false }], linked: [{ id: 'r1' }, { id: 'r2' }] })
    show()
    await waitFor(() => expect(screen.getByText('Install the App on your organisation').closest('summary')!.textContent).toContain('Done'))
    expect(screen.getByText('Link repositories to departments').closest('summary')!.textContent).toContain('Done')
    expect(screen.getByText('Choose the installation in the Workspace').closest('summary')!.textContent).not.toContain('Done')
  })

  it('a removed installation does not count as installed', async () => {
    Object.assign(s, { installations: [{ installation_id: 1, account_login: 'codex', removed: true, suspended: false }], linked: [] })
    show()
    await waitFor(() => expect(calls).toContain('githubInstallations'))
    await waitFor(() => expect(screen.getByText('Install the App on your organisation').closest('summary')!.textContent).toContain('To do'))
  })

  it('marks optional steps as optional and never counts them as required', async () => {
    show()
    const writes = (await screen.findByText(/Optional: let people comment/)).closest('summary')!
    expect(writes.textContent).toContain('Optional')
    expect(screen.getByText(/of 10 required steps done/)).toBeTruthy()
  })
})
