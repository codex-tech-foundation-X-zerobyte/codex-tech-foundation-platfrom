import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; department_id: string | null; presenter_id: string; title: string; kind: string; visibility: string; status: 'live' | 'ended'; state: Record<string, unknown>; state_version: number; started_at: string; ended_at: string | null; updated_at: string; presenter_name: string; department_name: string | null }
const mk = (o: Partial<Row> = {}): Row => ({ id: 's1', department_id: 'd1', presenter_id: 'maya', title: 'Demo', kind: 'slides', visibility: 'department', status: 'live', state: {}, state_version: 0, started_at: new Date().toISOString(), ended_at: null, updated_at: new Date().toISOString(), presenter_name: 'Maya', department_name: 'Frontend Development', ...o })

let me = { id: 'me', role: 'worker', display_name: 'Me' }
let row: Row = mk()
let live: Row[] = []
let recent: Row[] = []
const writes: Record<string, unknown>[] = []
const started: Record<string, unknown>[] = []
let emitRow: (r: Partial<Row>) => void = () => {}

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: me }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../src/lib/services', () => ({
  listPresentations: async () => ({ data: { live, recent }, error: null }),
  subscribeToPresentationList: () => () => {},
  getPresentation: async () => ({ data: row, error: null }),
  subscribeToPresentation: (_id: string, cb: (r: Partial<Row>) => void) => { emitRow = cb; return () => {} },
  measureServerOffset: async () => 0,
  writeStageState: async (_id: string, state: Record<string, unknown>) => { writes.push(state); return { version: writes.length, error: null } },
  pingPresentation: async () => {}, endPresentation: async () => ({ error: null }), deletePresentation: async () => ({ error: null }),
  uploadPresentationFile: async () => ({ path: null, error: new Error('no') }), presentationFileUrl: async () => ({ url: null }),
  startPresentation: async (input: Record<string, unknown>) => { started.push(input); return { data: { id: 'new1' }, error: null } },
  getMyDepartments: async () => ({ data: [{ department: { id: 'd-be', name: 'Backend Development', slug: 'backend-development' }, role: 'member', isPrimary: true }, { department: { id: 'd-fe', name: 'Frontend Development', slug: 'frontend-development' }, role: 'member', isPrimary: false }], error: null }),
  listDepartmentSummaries: async () => ({ data: { departments: [], unassigned: 0 }, error: null }),
}))

import { PresentationBoard } from '../../src/pages/present/PresentationBoard'
import { PresentationRoom } from '../../src/pages/present/PresentationRoom'

const room = () => render(<MemoryRouter initialEntries={['/worker/present/s1']}><Routes><Route path="/worker/present/:id" element={<PresentationRoom />} /></Routes></MemoryRouter>)
const board = () => render(<MemoryRouter initialEntries={['/worker/present']}><Routes><Route path="/worker/present" element={<PresentationBoard />} /><Route path="/worker/present/:id" element={<div>ROOM {location.pathname}</div>} /></Routes></MemoryRouter>)

beforeEach(() => { writes.length = 0; started.length = 0; live = []; recent = []; me = { id: 'me', role: 'worker', display_name: 'Me' }; row = mk(); Element.prototype.scrollIntoView = () => {} })

describe('board', () => {
  it('shows an honest empty state when nobody is presenting', async () => {
    board()
    expect(await screen.findByText('Nobody is presenting right now')).toBeTruthy()
  })
  it('lists who is live, in which department and stage, and marks a quiet presenter as paused', async () => {
    live = [mk({ id: 'a', title: 'Checkout demo', kind: 'browser' }), mk({ id: 'b', title: 'Old session', updated_at: new Date(Date.now() - 20 * 60_000).toISOString() })]
    board()
    expect(await screen.findByText('Checkout demo')).toBeTruthy()
    expect(screen.getByText(/Maya · Frontend Development · Browser/)).toBeTruthy()
    expect(screen.getByText('● Live')).toBeTruthy()
    expect(screen.getByText('Paused')).toBeTruthy()
  })
  it("starts a presentation: suggests the department's own stage first and offers every department the worker is in", async () => {
    board()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Start presenting' }))[0])
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'API tour')
    // first department is Backend: Console is suggested
    const consoleRadio = within(dialog).getByRole('radio', { name: /Console/ }) as HTMLInputElement
    expect(consoleRadio.checked).toBe(true)
    expect(within(dialog).getByText('Suggested').closest('label')?.textContent).toMatch(/Console/)
    // switching to the second department changes the suggestion to Browser
    await userEvent.selectOptions(within(dialog).getByLabelText('Department'), 'd-fe')
    expect((within(dialog).getByRole('radio', { name: /Browser/ }) as HTMLInputElement).checked).toBe(true)
    await userEvent.selectOptions(within(dialog).getByLabelText('Who can watch'), 'company')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go live' }))
    await waitFor(() => expect(started).toEqual([{ department_id: 'd-fe', title: 'API tour', kind: 'browser', visibility: 'company' }]))
  })
})

describe('room: roles', () => {
  it('lets the presenter end it, and shows viewers no way to', async () => {
    row = mk({ presenter_id: 'me' }); room()
    expect(await screen.findByRole('button', { name: /End presentation/ })).toBeTruthy()
    expect(screen.getByText(/You are presenting/)).toBeTruthy()
  })
  it('gives a viewer the stage but not the controls', async () => {
    row = mk({ kind: 'browser', state: { url: 'https://example.com/' } }); room()
    const frame = (await screen.findByTitle('Presented page')) as HTMLIFrameElement
    expect(frame.src).toBe('https://example.com/')
    expect(screen.queryByLabelText('Address')).toBeNull()
    expect(screen.queryByRole('button', { name: /End presentation/ })).toBeNull()
    expect(screen.getByText(/Maya is presenting/)).toBeTruthy()
  })
  it('lets a Main Admin end a presentation they are not running, but not drive its stage', async () => {
    me = { id: 'boss', role: 'superadmin', display_name: 'Boss' }; row = mk({ kind: 'browser', state: { url: 'https://example.com/' } }); room()
    expect(await screen.findByRole('button', { name: /End presentation/ })).toBeTruthy()
    expect(screen.queryByLabelText('Address')).toBeNull()
  })
  it('shows an ended presentation read-only, even to its presenter', async () => {
    row = mk({ presenter_id: 'me', kind: 'browser', status: 'ended', ended_at: new Date().toISOString(), state: { url: 'https://example.com/' } }); room()
    expect(await screen.findByText(/This presentation has ended/)).toBeTruthy()
    expect(screen.queryByLabelText('Address')).toBeNull()
    expect(screen.queryByRole('button', { name: /End presentation/ })).toBeNull()
  })
  it('says so when the presentation does not exist or is not shared with you', async () => {
    row = null as unknown as Row; room()
    expect(await screen.findByText('Presentation not found')).toBeTruthy()
  })
})

describe('browser stage', () => {
  beforeEach(() => { row = mk({ presenter_id: 'me', kind: 'browser', state: {} }) })
  it('refuses unsafe addresses and sends nothing', async () => {
    room()
    await userEvent.type(await screen.findByLabelText('Address'), 'javascript:alert(1){enter}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(writes).toEqual([])
  })
  it('puts a valid address on stage for everyone, sandboxed', async () => {
    room()
    await userEvent.type(await screen.findByLabelText('Address'), 'my-app.vercel.app{enter}')
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ url: 'https://my-app.vercel.app/' }))
    const frame = (await screen.findByTitle('Presented page')) as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  })
  it('changes the device size for everyone', async () => {
    room()
    await userEvent.click(await screen.findByRole('button', { name: 'Phone' }))
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ device: 'mobile' }))
  })
})

describe('slides stage', () => {
  const deck = '# One\n\n---\n\n# Two\n\n---\n\n# Three'
  it('lets the presenter write slides, then advance them, and syncs the slide number', async () => {
    row = mk({ presenter_id: 'me', kind: 'slides', state: {} }); room()
    await userEvent.type(await screen.findByRole('textbox'), 'A{enter}---{enter}B')
    await userEvent.click(screen.getByRole('button', { name: /Present 2 slides/ }))
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ index: 0 }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next slide' }))
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ index: 1 }))
  })
  it("makes a viewer follow the presenter, and lets them wander and come back", async () => {
    row = mk({ kind: 'slides', state: { markdown: deck, index: 1 } }); room()
    expect((await screen.findByRole('heading', { name: 'Two' }))).toBeTruthy()
    expect(screen.getByText(/Following the presenter/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(await screen.findByRole('heading', { name: 'Three' })).toBeTruthy()
    expect(writes).toEqual([])                                   // a viewer never writes
    // the presenter moves on while the viewer is browsing: the viewer stays where they are
    await act(async () => emitRow({ state: { markdown: deck, index: 0 }, state_version: 5 }))
    expect(screen.getByRole('heading', { name: 'Three' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Back to presenter \(slide 1\)/ }))
    expect(await screen.findByRole('heading', { name: 'One' })).toBeTruthy()
  })
  it("follows the presenter live when a Realtime update arrives", async () => {
    row = mk({ kind: 'slides', state: { markdown: deck, index: 0 } }); room()
    await screen.findByRole('heading', { name: 'One' })
    await act(async () => emitRow({ state: { markdown: deck, index: 2 }, state_version: 1 }))
    expect(await screen.findByRole('heading', { name: 'Three' })).toBeTruthy()
  })
  it('ignores a stale update that arrives after a newer one', async () => {
    row = mk({ kind: 'slides', state: { markdown: deck, index: 0 }, state_version: 4 }); room()
    await screen.findByRole('heading', { name: 'One' })
    await act(async () => emitRow({ state: { markdown: deck, index: 2 }, state_version: 6 }))
    await screen.findByRole('heading', { name: 'Three' })
    await act(async () => emitRow({ state: { markdown: deck, index: 1 }, state_version: 5 }))
    expect(screen.getByRole('heading', { name: 'Three' })).toBeTruthy()
  })
})

describe('console stage', () => {
  it('logs a command and pasted output for the audience, without pretending to run anything', async () => {
    row = mk({ presenter_id: 'me', kind: 'console', state: { lines: [] } }); room()
    await userEvent.click(await screen.findByRole('button', { name: 'Command' }))
    expect(screen.getByText(/does not run it/)).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Command'), 'npm test{enter}')
    await waitFor(() => expect((writes.at(-1)?.lines as { k: string; text: string }[]).map((l) => l.text)).toEqual(['npm test']))
    await userEvent.click(screen.getByRole('button', { name: 'Paste output' }))
    await userEvent.type(screen.getByLabelText('Paste output'), 'PASS a{enter}PASS b')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect((writes.at(-1)?.lines as { text: string }[]).map((l) => l.text)).toEqual(['npm test', 'PASS a', 'PASS b']))
  })
  it('runs a real HTTP request from the presenter\'s browser and shows status, timing and a formatted body', async () => {
    row = mk({ presenter_id: 'me', kind: 'console', state: { lines: [] } })
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    room()
    await userEvent.type(await screen.findByLabelText('HTTP request'), 'GET https://api.example.com/health{enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/health', expect.objectContaining({ method: 'GET', credentials: 'omit' })))
    await waitFor(() => { const t = (writes.at(-1)?.lines as { text: string }[]).map((l) => l.text); expect(t[0]).toBe('GET https://api.example.com/health'); expect(t[1]).toMatch(/^HTTP 200 OK {2}· {2}\d+ ms {2}· {2}application\/json$/); expect(t.slice(2)).toEqual(['{', '  "ok": true', '}']) })
    vi.unstubAllGlobals()
  })
  it('explains a blocked request (CORS) honestly instead of failing silently', async () => {
    row = mk({ presenter_id: 'me', kind: 'console', state: { lines: [] } })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    room()
    await userEvent.type(await screen.findByLabelText('HTTP request'), 'https://api.example.com/x{enter}')
    await waitFor(() => expect((writes.at(-1)?.lines as { k: string; text: string }[]).some((l) => l.k === 'err' && /CORS/.test(l.text))).toBe(true))
    vi.unstubAllGlobals()
  })
  it("never sends a request to an unsafe address", async () => {
    row = mk({ presenter_id: 'me', kind: 'console', state: { lines: [] } })
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    room()
    await userEvent.type(await screen.findByLabelText('HTTP request'), 'GET javascript:alert(1){enter}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals()
  })
  it('shows a viewer the lines but no input', async () => {
    row = mk({ kind: 'console', state: { lines: [{ id: '1', k: 'cmd', text: 'ls -la', at: 1 }, { id: '2', k: 'out', text: 'total 0', at: 2 }] } }); room()
    expect(await screen.findByText('ls -la')).toBeTruthy(); expect(screen.getByText('total 0')).toBeTruthy()
    expect(screen.queryByLabelText('Command')).toBeNull()
  })
})

describe('dashboard stage', () => {
  const csv = 'Channel,Spend,Leads\nEmail,"1,000",40\nSocial,2500,55'
  it('builds KPIs, a chart and a table from the presenter\'s own CSV, and syncs the data', async () => {
    row = mk({ presenter_id: 'me', kind: 'dashboard', state: {} }); room()
    await userEvent.click(await screen.findByLabelText('CSV data'))
    await userEvent.paste(csv)
    await userEvent.click(screen.getByRole('button', { name: 'Build dashboard' }))
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ data: { columns: ['Channel', 'Spend', 'Leads'], rows: [['Email', '1,000', '40'], ['Social', '2500', '55']] }, chart: { type: 'bar', x: 0, y: 1 } }))
    expect(await screen.findByText('3,500')).toBeTruthy()          // Spend total: 1,000 + 2,500, computed from the rows
    expect(screen.getByRole('img', { name: 'Spend by Channel' })).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('Email')).toBeTruthy()
  })
  it('rejects data that is not a table instead of showing an empty dashboard', async () => {
    row = mk({ presenter_id: 'me', kind: 'dashboard', state: {} }); room()
    await userEvent.click(await screen.findByLabelText('CSV data'))
    await userEvent.paste('just one line')
    await userEvent.click(screen.getByRole('button', { name: 'Build dashboard' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(writes).toEqual([])
  })
  it('shows a viewer the same dashboard with no editing controls, and an honest empty state before data', async () => {
    row = mk({ kind: 'dashboard', state: {} }); const first = room()
    expect(await screen.findByText(/has not loaded any data/)).toBeTruthy()
    first.unmount()
    row = mk({ kind: 'dashboard', state: { title: 'Q3 results', data: { columns: ['Channel', 'Spend'], rows: [['Email', '1000'], ['Social', '2500']], truncated: false }, chart: { type: 'pie', x: 0, y: 1 } } }); room()
    expect(await screen.findByText('Q3 results')).toBeTruthy()
    expect(screen.queryByLabelText('Dashboard title')).toBeNull(); expect(screen.queryByText('Replace data')).toBeNull()
    expect(screen.getByRole('img', { name: 'Spend by Channel' })).toBeTruthy()
  })
})

describe('cinema stage', () => {
  it('gives a viewer no player controls, only mute, re-sync and full screen', async () => {
    row = mk({ kind: 'cinema', state: { source: 'url', url: 'https://cdn.example.com/a.mp4', playing: false, position: 0 } }); room()
    const video = (await screen.findByRole('button', { name: 'Re-sync with the presenter' })).closest('.ctf-cinema')!.querySelector('video') as HTMLVideoElement
    expect(video.controls).toBe(false)
    expect(video.getAttribute('src')).toBe('https://cdn.example.com/a.mp4')
  })
  it('gives the presenter a real player and tells them YouTube cannot be synced', async () => {
    row = mk({ presenter_id: 'me', kind: 'cinema', state: { source: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' } }); room()
    expect(await screen.findByText(/cannot be synced/)).toBeTruthy()
    expect(screen.getByTitle('Video').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })
  it('refuses a video link that is not https', async () => {
    row = mk({ presenter_id: 'me', kind: 'cinema', state: {} }); room()
    await userEvent.type(await screen.findByLabelText('Video link'), 'javascript:alert(1){enter}')
    expect(await screen.findByRole('alert')).toBeTruthy(); expect(writes).toEqual([])
  })
})
