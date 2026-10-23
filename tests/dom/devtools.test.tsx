import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/ui'
import { departmentBySlug } from '../../src/workspaces/definitions'
import type { DepartmentRow } from '../../src/lib/services'

type Any = Record<string, unknown>
const s: Any & { inboxes: Any[]; captured: Any[]; boards: Any[]; doc: Any | null; files: Any[]; leads: Any[]; events: Any[]; integrations: Any; repos: Any; detail: Any; pulls: Any[]; runs: Any } = {
  inboxes: [], captured: [], boards: [], doc: null, files: [], leads: [], events: [], integrations: {}, repos: { repos: [], error: null }, detail: {}, pulls: [], runs: { runs: [], deployments: [] },
}
const calls: { fn: string; args: unknown[] }[] = []
const rec = (fn: string, result: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return result }
const subs: { id: string; cb: (v: number) => void }[] = []
let saveResult: Any = { version: 2, conflict: false, error: null }

vi.mock('../../src/lib/supabase', () => ({ supabase: { from: () => ({}), functions: { invoke: async () => ({ data: null, error: null }) }, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {}, auth: { getUser: async () => ({ data: { user: null } }) } } }))
vi.mock('../../src/lib/services', async (orig) => {
  const actual = await orig<typeof import('../../src/lib/services')>()
  return {
    ...actual,
    loadIntegrationState: async () => ({ data: s.integrations, error: null }),
    githubRepos: async () => (s.repos.error ? { data: null, error: new Error(s.repos.error as string) } : { data: s.repos, error: null }),
    githubDetail: async () => ({ data: s.detail, error: null }), githubPulls: async () => ({ data: { pulls: s.pulls }, error: null }), githubRuns: async () => ({ data: s.runs, error: null }),
    listInboxes: async () => ({ data: s.inboxes, error: null }), createInbox: (...a: unknown[]) => rec('createInbox')(...a), deleteInbox: (...a: unknown[]) => rec('deleteInbox')(...a),
    listCaptured: async () => ({ data: s.captured, error: null }), clearCaptured: (...a: unknown[]) => rec('clearCaptured')(...a), subscribeToCaptured: () => () => {},
    listWhiteboards: async () => ({ data: s.boards, error: null }), createWhiteboard: (...a: unknown[]) => rec('createWhiteboard', { data: 'wb-new', error: null })(...a),
    loadWhiteboard: async (...a: unknown[]) => { calls.push({ fn: 'loadWhiteboard', args: a }); return { data: s.doc, error: null } },
    saveWhiteboard: async (...a: unknown[]) => { calls.push({ fn: 'saveWhiteboard', args: a }); return saveResult },
    deleteWhiteboard: (...a: unknown[]) => rec('deleteWhiteboard')(...a),
    subscribeToWhiteboard: (id: string, cb: (v: number) => void) => { subs.push({ id, cb }); return () => {} },
    listDepartmentFiles: async () => ({ data: s.files, error: null }), createResourceWithFile: (...a: unknown[]) => rec('createResourceWithFile')(...a),
    createLinkResource: (...a: unknown[]) => rec('createLinkResource')(...a), downloadResource: async () => ({ error: null }), deleteResource: (...a: unknown[]) => rec('deleteResource')(...a),
    loadLeadStats: async () => ({ data: s.leads, error: null }), listDepartmentCalendar: async () => ({ data: s.events, error: null }),
    createRecord: (...a: unknown[]) => rec('createRecord')(...a), listRecords: async () => ({ data: [], error: null }),
  }
})

import { DepartmentToolPage } from '../../src/workspaces/DepartmentToolPage'

const def = (slug: string) => departmentBySlug(slug)!
const row = (slug: string): DepartmentRow => ({ id: `id-${slug}`, name: def(slug).name, slug, is_system: true, created_at: '' })
const viewer = (o: Any = {}) => ({ id: 'u1', isMainAdmin: false, isDepartmentAdmin: false, ...o }) as never
const page = (slug: string, toolId: string, v = viewer(), base: '/worker' | '/admin' = '/worker', url = '/x') =>
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Routes><Route path="/x" element={<DepartmentToolPage def={def(slug)} row={row(slug)} base={base} toolId={toolId} viewer={v} />} /></Routes></ToastProvider></MemoryRouter>)

beforeEach(() => {
  calls.length = 0; subs.length = 0; saveResult = { version: 2, conflict: false, error: null }
  Object.assign(s, { inboxes: [], captured: [], boards: [], doc: null, files: [], leads: [], events: [], integrations: {}, repos: { repos: [], error: null }, detail: {}, pulls: [], runs: { runs: [], deployments: [] } })
  if (!('PointerEvent' in window)) (window as unknown as Any).PointerEvent = MouseEvent
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Security Lab tools', () => {
  it('header analysis grades pasted headers, and says what to fix', async () => {
    page('cybersecurity', 'headers')
    const button = await screen.findByRole('button', { name: 'Analyse headers' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await userEvent.click(screen.getByLabelText(/Response headers/))
    await userEvent.paste("HTTP/2 200\nstrict-transport-security: max-age=31536000\nx-content-type-options: nosniff\nserver: nginx/1.18.0")
    await userEvent.click(button)
    expect(await screen.findByText('No Content-Security-Policy')).toBeTruthy()
    expect(screen.getByText('Server header reveals a version')).toBeTruthy()
    expect(screen.getByText('HSTS is set')).toBeTruthy()
    expect(screen.getByText(/of checks passed/)).toBeTruthy()
  })

  it('header analysis tells you when nothing in the paste looks like headers', async () => {
    page('cybersecurity', 'headers')
    await userEvent.click(await screen.findByLabelText(/Response headers/))
    await userEvent.paste('this is not headers')
    await userEvent.click(screen.getByRole('button', { name: 'Analyse headers' }))
    expect(await screen.findByText('No headers found')).toBeTruthy()
  })

  it('log analysis flags credential guessing from repeated refusals', async () => {
    page('cybersecurity', 'logs')
    await userEvent.click(await screen.findByLabelText(/Log text/))
    const line = '203.0.113.9 - - [05/Oct/2026:10:00:00 +0000] "POST /login HTTP/1.1" 401 120\n'
    await userEvent.paste(line.repeat(12))
    await userEvent.click(screen.getByRole('button', { name: 'Analyse log' }))
    expect((await screen.findByRole('list', { name: 'Things to look at' })).textContent).toMatch(/203\.0\.113\.9.*credential guessing/)
    expect(screen.getByText('12 lines, 12 recognised')).toBeTruthy()
  })

  it('DNS lookup shows records, and reports a missing domain or an unreachable resolver plainly', async () => {
    const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }))
    vi.stubGlobal('fetch', answer({ Status: 0, Answer: [{ name: 'example.com.', type: 1, TTL: 60, data: '93.184.216.34' }] }))
    page('cybersecurity', 'dns')
    await userEvent.type(await screen.findByLabelText('Domain'), 'Example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText('93.184.216.34')).toBeTruthy()
    vi.stubGlobal('fetch', answer({ Status: 3 }))
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText('No such domain')).toBeTruthy()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText('Lookup failed')).toBeTruthy()
  })

  it('email-authentication check reports missing SPF and DMARC', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Status: 0 }) })))
    page('cybersecurity', 'dns')
    await userEvent.type(await screen.findByLabelText('Domain'), 'example.com')
    await userEvent.click(screen.getByRole('button', { name: /Check email authentication/ }))
    expect(await screen.findByText('No SPF record')).toBeTruthy()
    expect(screen.getByText('No DMARC record')).toBeTruthy()
  })

  it('configuration checks score only applicable answers, then save the audit as a record', async () => {
    page('cybersecurity', 'config')
    const save = await screen.findByRole('button', { name: 'Save audit' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByText('—')).toBeTruthy() // no answers, no invented score
    const groups = screen.getAllByRole('radiogroup')
    await userEvent.click(within(groups[0]).getByRole('radio', { name: 'Pass' }))
    await userEvent.click(within(groups[1]).getByRole('radio', { name: 'Pass' }))
    await userEvent.click(within(groups[2]).getByRole('radio', { name: 'Fix' }))
    await userEvent.click(within(groups[3]).getByRole('radio', { name: 'N/A' }))
    expect(screen.getByText('67%')).toBeTruthy() // 2 of the 3 applicable items pass
    await userEvent.type(screen.getByLabelText(/What was audited/), 'Production app')
    await userEvent.click(save)
    await waitFor(() => expect(calls.find((c) => c.fn === 'createRecord')?.args[0]).toMatchObject({ department_id: 'id-cybersecurity', kind: 'config_audit', stage: 'Saved', fields: { scope: 'Production app', score: 67 } }))
    const fields = (calls.find((c) => c.fn === 'createRecord')!.args[0] as { fields: { results: string } }).fields
    expect(fields.results).toMatch(/2 passed, 1 to fix/)
    expect(fields.results).toMatch(/To fix:/)
  })

  it('training links all open externally and safely', async () => {
    page('cybersecurity', 'training')
    await screen.findByText('PortSwigger Web Security Academy')
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('target') === '_blank') // the page's own back-link is internal
    expect(links.length).toBeGreaterThanOrEqual(5)
    for (const a of links) { expect(a.getAttribute('href')).toMatch(/^https:\/\//); expect(a.getAttribute('rel')).toMatch(/noopener/); expect(a.getAttribute('target')).toBe('_blank') }
    expect(screen.getByText(/Never practise on company or third-party systems/)).toBeTruthy()
  })
})

describe('webhook tester', () => {
  it('creates an inbox, and shows its URL and what was received, with JSON made readable', async () => {
    s.inboxes = [{ id: 'i1', name: 'Stripe test', token: 'a'.repeat(64), created_at: '2026-10-01T00:00:00Z' }]
    s.captured = [{ id: 'r1', method: 'POST', path: '/events', query: 'v=2', headers: { 'content-type': 'application/json' }, body: '{"type":"charge.succeeded","amount":500}', received_at: '2026-10-02T10:00:00Z' }]
    page('backend-development', 'webhooks')
    await userEvent.type(await screen.findByLabelText('New inbox'), 'GitHub events')
    await userEvent.click(screen.getByRole('button', { name: 'Create inbox' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'createInbox', args: ['id-backend-development', 'GitHub events'] }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stripe test/ }))
    expect((await screen.findAllByText(new RegExp(`/functions/v1/webhook-inbox/${'a'.repeat(64)}`))).length).toBeGreaterThan(0)
    expect(screen.getByText('1 captured request (latest 50 shown)')).toBeTruthy()
    await userEvent.click(screen.getByText('/events?v=2'))
    expect(screen.getByText(/"charge.succeeded"/)).toBeTruthy()
    expect(screen.getByText('content-type: application/json')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'clearCaptured', args: ['i1'] }))
  })

  it('explains an empty inbox, including the deploy flag people forget', async () => {
    s.inboxes = [{ id: 'i1', name: 'Empty', token: 'b'.repeat(64), created_at: '2026-10-01T00:00:00Z' }]
    page('backend-development', 'webhooks')
    await userEvent.click(await screen.findByRole('button', { name: /^Empty/ }))
    expect(await screen.findByText('Nothing received yet')).toBeTruthy()
    expect(screen.getByText(/--no-verify-jwt/)).toBeTruthy()
  })
})

describe('GitHub in the department tools', () => {
  it('says what is missing when GitHub is not connected, and who can fix it', async () => {
    const first = page('frontend-development', 'repos')
    expect(await screen.findByText('GitHub is not connected')).toBeTruthy()
    expect(screen.getByText(/needs to connect GitHub/)).toBeTruthy()
    first.unmount()
    page('frontend-development', 'repos', viewer({ isMainAdmin: true }), '/admin')
    expect((await screen.findByRole('link', { name: 'Open Integrations' })).getAttribute('href')).toBe('/admin/integrations')
  })

  it('says when no repository is linked to the department', async () => {
    s.integrations = { github: { status: 'connected', config: {} } }
    page('frontend-development', 'repos')
    expect(await screen.findByText('No repositories linked to this department')).toBeTruthy()
  })

  it('shows repository detail from GitHub, with links that open safely', async () => {
    s.integrations = { github: { status: 'connected', config: {} } }
    s.repos = { repos: [{ full_name: 'codex/web', description: '', private: true, default_branch: 'main', open_issues: 1, pushed_at: null, html_url: 'https://github.com/codex/web', language: 'TypeScript' }], error: null }
    s.detail = { repo: { full_name: 'codex/web', description: 'The web app', private: true, default_branch: 'main', open_issues: 1, pushed_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/web', language: 'TypeScript' }, branches: [{ name: 'main', protected: true }, { name: 'feature/auth-ui', protected: false }], commits: [{ sha: 'abc1234', message: 'Add login form', author: 'sam', date: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/web/commit/abc1234' }], issues: [{ number: 7, title: 'Fix header', author: 'ike', labels: ['bug'], created_at: '', html_url: 'https://github.com/codex/web/issues/7' }] }
    page('frontend-development', 'repos')
    expect(await screen.findByText('The web app')).toBeTruthy()
    expect(screen.getByText('feature/auth-ui')).toBeTruthy()
    expect(screen.getByText('protected')).toBeTruthy()
    expect(screen.getByText(/Add login form/)).toBeTruthy()
    expect(screen.getByText('#7 Fix header')).toBeTruthy()
    const open = screen.getByRole('link', { name: /Open in GitHub/ })
    expect(open.getAttribute('rel')).toMatch(/noopener/)
  })

  it('shows pull requests with their review state', async () => {
    s.integrations = { github: { status: 'connected', config: {} } }
    s.repos = { repos: [{ full_name: 'codex/web', description: '', private: false, default_branch: 'main', open_issues: 0, pushed_at: null, html_url: 'u', language: null }], error: null }
    const pr = (o: Any) => ({ author: 'sam', draft: false, state: 'open', head: 'feat', base: 'main', created_at: '', updated_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/web/pull/1', approved: 0, changes_requested: 0, ...o })
    s.pulls = [pr({ number: 1, title: 'Ready one', approved: 2 }), pr({ number: 2, title: 'Blocked one', changes_requested: 1 }), pr({ number: 3, title: 'Draft one', draft: true }), pr({ number: 4, title: 'Waiting one' })]
    page('frontend-development', 'prs')
    expect(await screen.findByText('#1 Ready one')).toBeTruthy()
    expect(screen.getByText('2 approved')).toBeTruthy()
    expect(screen.getByText('1 changes requested')).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Needs review')).toBeTruthy()
  })

  it('shows CI runs and deployments', async () => {
    s.integrations = { github: { status: 'connected', config: {} } }
    s.repos = { repos: [{ full_name: 'codex/infra', description: '', private: false, default_branch: 'main', open_issues: 0, pushed_at: null, html_url: 'u', language: null }], error: null }
    s.runs = { runs: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'success', branch: 'main', event: 'push', actor: 'sam', created_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/infra/actions/runs/1' }, { id: 2, name: 'Deploy', status: 'completed', conclusion: 'failure', branch: 'main', event: 'push', actor: 'sam', created_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/codex/infra/actions/runs/2' }], deployments: [{ id: 9, environment: 'production', ref: 'main', created_at: '2026-10-01T00:00:00Z', creator: 'sam' }] }
    page('devops', 'actions')
    expect(await screen.findByText('success')).toBeTruthy()
    expect(screen.getByText('failure')).toBeTruthy()
    expect(screen.getByText('production')).toBeTruthy()
  })

  it('shows GitHub\'s own error rather than an empty page', async () => {
    s.integrations = { github: { status: 'connected', config: {} } }
    s.repos = { repos: [], error: 'GitHub rejected the saved token. Reconnect GitHub.' }
    page('frontend-development', 'repos')
    expect(await screen.findByText("GitHub couldn't be reached")).toBeTruthy()
    expect(screen.getByText('GitHub rejected the saved token. Reconnect GitHub.')).toBeTruthy()
  })
})

describe('department files, lead statistics and the dated-work calendar', () => {
  it('lists the department\'s files and adds dropped files and links into the right category, scoped to the department', async () => {
    s.files = [{ id: 'f1', title: 'Logo pack', description: 'v2, approved by Ada', category: 'brand', storage_path: 'x/logo.zip', url: null, mime_type: null, size_bytes: 2048, created_at: '2026-10-01T00:00:00Z', owner_id: 'u1' }]
    const { container } = page('ui-ux-design', 'brand')
    expect(await screen.findByText('Logo pack')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Note'), 'v3 final')
    // Nothing to type first: the title comes from the file name, and the note applies to what is dropped next.
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'colors_final.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createResourceWithFile')?.args[0]).toEqual({ title: 'colors final', description: 'v3 final', category: 'brand', department_id: 'id-ui-ux-design' }))
    // A link is recognised as a link and stored as one, in the same department and category.
    await userEvent.type(screen.getByLabelText('Add a link'), 'https://figma.com/file/abc')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'createLinkResource')?.args[0]).toEqual({ title: 'figma.com/file/abc', url: 'https://figma.com/file/abc', description: 'v3 final', category: 'brand', department_id: 'id-ui-ux-design' }))
  })

  it('rejects a file that is too large before uploading it', async () => {
    const { container } = page('ui-ux-design', 'brand')
    await screen.findByLabelText('Add a link')
    const big = new File(['x'], 'huge.zip'); Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 })
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, big)
    expect(await screen.findByText(/huge\.zip is over 25 MB/)).toBeTruthy()
    expect(calls.some((c) => c.fn === 'createResourceWithFile')).toBe(false)
  })

  it('shows lead totals and an honest empty state', async () => {
    const first = page('marketing', 'lead-stats')
    expect(await screen.findByText('No leads yet')).toBeTruthy()
    first.unmount()
    s.leads = [{ status: 'new', created_at: new Date().toISOString() }, { status: 'won', created_at: new Date().toISOString() }]
    page('marketing', 'lead-stats')
    expect(await screen.findByText('2 leads in the last 13 weeks')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Leads per week/ })).toBeTruthy()
  })

  it('the content calendar shows dated work, or says nothing is dated this month', async () => {
    const first = page('content', 'calendar')
    expect(await screen.findByText('Nothing dated this month')).toBeTruthy()
    first.unmount()
    const d = new Date(); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d.getDate(), 28)).padStart(2, '0')}`
    s.events = [{ id: 'e1', date, title: 'Launch script', detail: 'Content · Publishing', group: 'work' }]
    page('content', 'calendar')
    expect(await screen.findByText('Launch script')).toBeTruthy()
    expect(screen.queryByText('Nothing dated this month')).toBeNull()
  })
})

describe('whiteboard', () => {
  const doc = (o: Any = {}) => ({ id: 'wb1', department_id: 'id-ui-ux-design', title: 'Login flow', version: 1, updated_at: '2026-10-01T00:00:00Z', board: { shapes: [] }, ...o })
  const openBoard = () => page('ui-ux-design', 'whiteboard', viewer(), '/worker', '/x?board=wb1')
  const draw = async (toolName: string) => {
    await userEvent.click(await screen.findByRole('button', { name: toolName }))
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Whiteboard canvas' }), { clientX: 200, clientY: 150, pointerId: 1 })
  }

  it('lists boards, and creates one by name', async () => {
    s.boards = [{ id: 'wb1', title: 'Login flow', version: 3, updated_at: '2026-10-01T00:00:00Z' }]
    s.doc = doc()
    page('ui-ux-design', 'whiteboard')
    expect(await screen.findByText('Login flow')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('New whiteboard'), 'Onboarding')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'createWhiteboard', args: ['id-ui-ux-design', 'Onboarding'] }))
  })

  it('draws a shape, shows it as unsaved, then autosaves on top of the version it loaded', async () => {
    s.doc = doc({ version: 4 })
    openBoard()
    expect(await screen.findByText('0 shapes')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('All changes saved')
    await draw('Rectangle')
    expect(await screen.findByText('1 shape')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes…')
    await waitFor(() => expect(calls.find((c) => c.fn === 'saveWhiteboard')).toBeTruthy(), { timeout: 3000 })
    const [id, version, board] = calls.find((c) => c.fn === 'saveWhiteboard')!.args as [string, number, { shapes: Any[] }]
    expect([id, version, board.shapes.length, board.shapes[0].type]).toEqual(['wb1', 4, 1, 'rect'])
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'))
  })

  it('undo and redo walk back and forward, and are disabled when there is nothing to do', async () => {
    s.doc = doc()
    openBoard()
    const undo = await screen.findByRole('button', { name: 'Undo' }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement
    expect([undo.disabled, redo.disabled]).toEqual([true, true])
    await draw('Ellipse')
    await screen.findByText('1 shape')
    await userEvent.click(undo)
    expect(await screen.findByText('0 shapes')).toBeTruthy()
    expect(redo.disabled).toBe(false)
    await userEvent.click(redo)
    expect(await screen.findByText('1 shape')).toBeTruthy()
  })

  it('refuses to overwrite someone else\'s save, and tells you plainly', async () => {
    saveResult = { version: null, conflict: true, error: null }
    s.doc = doc()
    openBoard()
    await draw('Sticky note')
    expect((await screen.findByRole('alert', {}, { timeout: 3000 })).textContent).toMatch(/Someone else saved a newer version/)
    expect(screen.getByRole('status').textContent).toMatch(/Not saved/)
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(calls.filter((c) => c.fn === 'loadWhiteboard').length).toBeGreaterThan(1))
  })

  it('picks up someone else\'s change straight away when you have no unsaved edits, and warns when you do', async () => {
    s.doc = doc({ version: 1 })
    openBoard()
    await screen.findByText('0 shapes')
    subs.at(-1)!.cb(2)
    await waitFor(() => expect(calls.filter((c) => c.fn === 'loadWhiteboard').length).toBeGreaterThan(1)) // clean: reload silently
    saveResult = new Promise(() => {}) as never // keep the next save pending so the board stays dirty
    await draw('Text')
    await screen.findByText('1 shape')
    subs.at(-1)!.cb(9)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Someone else saved a newer version/) // dirty: warn, do not discard
  })

  it('has a labelled toolbar and only a Department Admin can delete a board', async () => {
    s.doc = doc()
    const first = openBoard()
    for (const name of ['Select', 'Rectangle', 'Ellipse', 'Sticky note', 'Text', 'Frame', 'Line', 'Arrow']) expect(await screen.findByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Delete board/ })).toBeNull()
    first.unmount()
    page('ui-ux-design', 'whiteboard', viewer({ isDepartmentAdmin: true }), '/worker', '/x?board=wb1')
    await userEvent.click(await screen.findByRole('button', { name: /Delete board/ }))
    await waitFor(() => expect(calls).toContainEqual({ fn: 'deleteWhiteboard', args: ['wb1'] }))
  })
})
