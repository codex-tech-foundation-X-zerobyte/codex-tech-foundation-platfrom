import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Any = Record<string, unknown>
const h = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = []
  const state: { attachments: Any[]; links: Any[]; workload: Any; roster: Any[]; callbacks: Any[]; events: Any[]; secret: string | null; addError: string | null } =
    { attachments: [], links: [], workload: { unassigned: 0, people: [] }, roster: [], callbacks: [], events: [], secret: 'a'.repeat(64), addError: null }
  const rec = (fn: string, ret: unknown = { error: null }) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret }
  return { calls, state, rec }
})
const { calls, state } = h

vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (m: string, t?: string) => h.calls.push({ fn: 'toast', args: [m, t] }) }) }))
vi.mock('../../src/lib/services', () => ({
  listAttachments: async () => ({ data: h.state.attachments, error: null }),
  addAttachment: async (...args: unknown[]) => { h.calls.push({ fn: 'addAttachment', args }); return { error: h.state.addError ? new Error(h.state.addError) : null } },
  attachmentLink: async (...args: unknown[]) => { h.calls.push({ fn: 'attachmentLink', args }); return { url: 'https://signed.example/file?t=1', error: null } },
  listIncidentLinks: async () => ({ data: h.state.links, error: null }), linkIncident: h.rec('linkIncident'), unlinkIncident: h.rec('unlinkIncident'),
  getWorkload: async () => ({ data: h.state.workload, error: null }), getRoster: async () => ({ data: h.state.roster, error: null }), addShift: h.rec('addShift'), deleteShift: h.rec('deleteShift'),
  getCallbacks: async () => ({ data: h.state.callbacks, error: null }), listCallbackEvents: async () => ({ data: h.state.events, error: null }), retryCallback: h.rec('retryCallback'), clearCallback: h.rec('clearCallback'),
  setCallback: async (...args: unknown[]) => { h.calls.push({ fn: 'setCallback', args }); return { secret: h.state.secret, error: null } },
}))

import { TicketExtras } from '../../src/pages/support/TicketExtras'
import { SupportTeam } from '../../src/pages/support/SupportTeam'
import { CallbacksPanel } from '../../src/pages/support/CallbacksPanel'

const att = (o: Any = {}): Any => ({ id: 'a1', ticket_id: 't1', path: 't1/1-shot.png', file_name: 'shot.png', mime_type: 'image/png', size_bytes: 2048, visibility: 'internal', created_at: new Date().toISOString(), ...o })
const file = (name = 'proof.png', type = 'image/png', size = 1000) => new File([new Uint8Array(size)], name, { type })
beforeEach(() => { calls.length = 0; Object.assign(state, { attachments: [], links: [], workload: { unassigned: 0, people: [] }, roster: [], callbacks: [], events: [], secret: 'a'.repeat(64), addError: null }); window.open = vi.fn() as never })

describe('ticket files', () => {
  it('lists files with who may see them, and opens one through a short-lived link', async () => {
    state.attachments = [att(), att({ id: 'a2', file_name: 'invoice.pdf', mime_type: 'application/pdf', path: 't1/2-invoice.pdf', visibility: 'public' })]
    render(<TicketExtras ticketId="t1" isAgent canLink={false} closed={false} />)
    expect(await screen.findByText('shot.png')).toBeTruthy()
    expect(screen.getByText('Internal')).toBeTruthy(); expect(screen.getByText('Shared with customer')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'invoice.pdf' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'attachmentLink')?.args).toEqual(['t1/2-invoice.pdf']))
    expect(window.open).toHaveBeenCalledWith('https://signed.example/file?t=1', '_blank', 'noopener,noreferrer')
  })
  it('attaches a file for the team by default, and shares it with the customer only when asked', async () => {
    render(<TicketExtras ticketId="t1" isAgent canLink={false} closed={false} />)
    const input = (await screen.findByText('Add a file')).closest('div')!.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, file('a.png'))
    await waitFor(() => expect(calls.find((c) => c.fn === 'addAttachment')?.args.slice(0, 1).concat(calls.find((c) => c.fn === 'addAttachment')?.args[2])).toEqual(['t1', 'internal']))
    calls.length = 0
    await userEvent.click(screen.getByLabelText(/Share the next file with the customer/))
    await userEvent.upload(input, file('b.png'))
    await waitFor(() => expect(calls.find((c) => c.fn === 'addAttachment')?.args[2]).toBe('public'))
  })
  it('does not offer sharing with the customer to people who are not Customer Service', async () => {
    render(<TicketExtras ticketId="t1" isAgent={false} canLink={false} closed={false} />)
    await screen.findByText('Add a file')
    expect(screen.queryByLabelText(/Share the next file with the customer/)).toBeNull()
  })
  it('tells the person when an upload failed, and does not pretend it worked', async () => {
    state.addError = 'That upload was not found. Upload the file first.'
    render(<TicketExtras ticketId="t1" isAgent canLink={false} closed={false} />)
    const input = (await screen.findByText('Add a file')).closest('div')!.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, file())
    await waitFor(() => expect(calls.some((c) => c.fn === 'toast' && c.args[1] === 'error' && /upload was not found/.test(String(c.args[0])))).toBe(true))
    expect(calls.some((c) => c.fn === 'toast' && c.args[1] === 'success')).toBe(false)
  })
  it('offers no upload on a closed ticket, but still lists its files', async () => {
    state.attachments = [att()]
    render(<TicketExtras ticketId="t1" isAgent canLink={false} closed />)
    expect(await screen.findByText('shot.png')).toBeTruthy()
    expect(screen.queryByText('Add a file')).toBeNull()
  })
})

describe('related incidents', () => {
  it('shows the linked incident\'s reference, severity and status', async () => {
    state.links = [{ id: 'i1', ref: 'INC-000007', status: 'resolved', severity: 'high', project: 'Portfolio site', linked_at: new Date().toISOString() }]
    render(<TicketExtras ticketId="t1" isAgent canLink={false} closed={false} />)
    expect(await screen.findByText('INC-000007')).toBeTruthy()
    expect(screen.getByText('high')).toBeTruthy(); expect(screen.getByText('resolved')).toBeTruthy(); expect(screen.getByText('Portfolio site')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull()
    expect(screen.queryByLabelText('Incident reference')).toBeNull()
  })
  it('lets an engineer link by reference, only when it looks like one', async () => {
    render(<TicketExtras ticketId="t1" isAgent={false} canLink closed={false} />)
    const box = await screen.findByLabelText('Incident reference')
    const btn = screen.getByRole('button', { name: 'Link incident' }) as HTMLButtonElement
    await userEvent.type(box, 'hello'); expect(btn.disabled).toBe(true)
    await userEvent.clear(box); await userEvent.type(box, 'inc-000123'); expect(btn.disabled).toBe(false)
    await userEvent.click(btn)
    await waitFor(() => expect(calls.find((c) => c.fn === 'linkIncident')?.args).toEqual(['t1', 'inc-000123']))
  })
  it('lets an engineer unlink', async () => {
    state.links = [{ id: 'i1', ref: 'INC-000007', status: 'open', severity: 'low', project: 'P', linked_at: new Date().toISOString() }]
    render(<TicketExtras ticketId="t1" isAgent={false} canLink closed={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'unlinkIncident')?.args).toEqual(['t1', 'i1']))
  })
})

describe('team: workload and shifts', () => {
  const person = (o: Any = {}): Any => ({ user_id: 'u1', name: 'Agent One', open: 3, overdue: 1, waiting_for_customer: 2, resolved_7d: 5, avg_first_response_minutes_7d: 95, avg_rating_30d: 4.5, on_shift: true, ...o })
  it('shows each person\'s load, who is on shift, and what nobody has taken', async () => {
    state.workload = { unassigned: 2, people: [person(), person({ user_id: 'u2', name: 'Agent Two', open: 0, overdue: 0, avg_first_response_minutes_7d: null, avg_rating_30d: null, on_shift: false })] }
    render(<SupportTeam />)
    expect(await screen.findByText('Agent One', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('On shift')).toBeTruthy()
    expect(screen.getByText('1h 35m')).toBeTruthy(); expect(screen.getByText('4.5 / 5')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBe(2)
    expect(screen.getByText(/ticket(s)? (has|have) nobody assigned/).closest('p')?.textContent).toMatch(/^2 tickets have nobody assigned/)
  })
  it('adds a shift in exact times, and will not submit an impossible one', async () => {
    state.workload = { unassigned: 0, people: [person()] }
    render(<SupportTeam />)
    await screen.findByText('Agent One', { selector: 'strong' })
    const add = screen.getByRole('button', { name: 'Add shift' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    await userEvent.selectOptions(screen.getByLabelText('Who'), 'u1')
    await userEvent.type(screen.getByLabelText('Starts'), '2026-11-02T09:00')
    await userEvent.type(screen.getByLabelText('Ends'), '2026-11-02T08:00')
    expect(add.disabled).toBe(true)   // ends before it starts
    await userEvent.clear(screen.getByLabelText('Ends')); await userEvent.type(screen.getByLabelText('Ends'), '2026-11-02T17:00')
    await userEvent.type(screen.getByLabelText('Note (optional)'), ' cover ')
    expect(add.disabled).toBe(false)
    await userEvent.click(add)
    await waitFor(() => expect(calls.find((c) => c.fn === 'addShift')?.args).toEqual(['u1', new Date('2026-11-02T09:00').toISOString(), new Date('2026-11-02T17:00').toISOString(), 'cover']))
  })
  it('lists the roster and removes a shift', async () => {
    state.workload = { unassigned: 0, people: [person()] }
    state.roster = [{ id: 's1', user_id: 'u1', name: 'Agent One', starts_at: '2026-11-02T09:00:00Z', ends_at: '2026-11-02T17:00:00Z', note: 'cover', on_now: false }]
    render(<SupportTeam />)
    expect(await screen.findByText('cover')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'deleteShift')?.args).toEqual(['s1']))
  })
  it('says plainly when nobody has a shift', async () => {
    render(<SupportTeam />)
    expect(await screen.findByText('No shifts set')).toBeTruthy()
  })
})

describe('callbacks to a project', () => {
  const cb = (o: Any = {}): Any => ({ source_id: 's1', name: 'Portfolio site', configured: true, enabled: true, host: 'api.shopfront.dev', pending: 1, dead: 2, delivered_24h: 9, last_delivery_at: new Date().toISOString(), last_error: null, ...o })
  it('shows the host, not the full address, with what is waiting or given up', async () => {
    state.callbacks = [cb()]
    render(<CallbacksPanel canManage={false} />)
    expect(await screen.findByText('api.shopfront.dev')).toBeTruthy()
    expect(screen.getByText('2 given up')).toBeTruthy(); expect(screen.getByText('1 waiting')).toBeTruthy()
    expect(screen.getByText(/9 delivered in 24 h/)).toBeTruthy()
  })
  it('lets only the Main Admin change it; a lead sees who can', async () => {
    state.callbacks = [cb({ configured: false, host: '', pending: 0, dead: 0 })]
    const { unmount } = render(<CallbacksPanel canManage={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
    expect(await screen.findByText('Only a Main Admin can change the address.')).toBeTruthy()
    expect(screen.queryByLabelText(/Address/)).toBeNull()
    unmount()
    render(<CallbacksPanel canManage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(await screen.findByLabelText(/Address/)).toBeTruthy()
  })
  it('refuses a non-https address before sending it, then shows the signing secret exactly once', async () => {
    state.callbacks = [cb({ configured: false, host: '', pending: 0, dead: 0 })]
    render(<CallbacksPanel canManage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    const save = screen.getByRole('button', { name: 'Save and make a secret' }) as HTMLButtonElement
    await userEvent.type(screen.getByLabelText(/Address/), 'http://api.shopfront.dev/hook')
    expect(save.disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText(/Address/)); await userEvent.type(screen.getByLabelText(/Address/), 'https://api.shopfront.dev/hook')
    await userEvent.click(save)
    expect(await screen.findByText('a'.repeat(64))).toBeTruthy()
    expect(calls.find((c) => c.fn === 'setCallback')?.args).toEqual(['s1', 'https://api.shopfront.dev/hook'])
    expect(screen.getByLabelText('How to verify a callback').textContent).toMatch(/createHmac/)
    await userEvent.click(screen.getByRole('button', { name: 'I have saved it' }))
    expect(screen.queryByText('a'.repeat(64))).toBeNull()
  })
  it('can remove a callback', async () => {
    render(<CallbacksPanel canManage />)
    state.callbacks = [cb()]
    const { unmount } = render(<CallbacksPanel canManage />)
    unmount()
    state.callbacks = [cb()]
    render(<CallbacksPanel canManage />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Remove callback' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'clearCallback')?.args).toEqual(['s1']))
  })
  it('shows the delivery log and lets a lead retry only a delivery that was given up on', async () => {
    state.callbacks = [cb()]
    state.events = [
      { id: 'e1', event: 'ticket.reply', ticket_ref: 'TCK-1', status: 'dead', attempts: 6, last_http: 503, last_error: 'The receiver answered HTTP 503.', created_at: new Date().toISOString(), delivered_at: null },
      { id: 'e2', event: 'ticket.status', ticket_ref: 'TCK-2', status: 'delivered', attempts: 1, last_http: 200, last_error: null, created_at: new Date().toISOString(), delivered_at: new Date().toISOString() },
    ]
    render(<CallbacksPanel canManage={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Log' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Reply to customer')).toBeTruthy()
    expect(within(dialog).getByText('Given up')).toBeTruthy(); expect(within(dialog).getByText('Delivered')).toBeTruthy()
    expect(within(dialog).getByText(/The receiver answered HTTP 503\. \(HTTP 503\)/)).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(calls.find((c) => c.fn === 'retryCallback')?.args).toEqual(['e1']))
  })
})
