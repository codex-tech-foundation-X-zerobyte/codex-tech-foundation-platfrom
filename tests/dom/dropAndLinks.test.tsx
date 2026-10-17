import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Toast { message: string; tone?: string; action?: { label: string; onClick: () => void | Promise<void> } }
const toasts: Toast[] = []
const calls: string[] = []
let deleteResult: { removed: number; error: Error | null } = { removed: 2, error: null }

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role: 'superadmin' } }) }))
vi.mock('../../src/components/ui', async (orig) => ({
  ...(await orig<typeof import('../../src/components/ui')>()),
  useToast: () => ({ push: (message: string, tone?: string, options?: { action?: Toast['action'] }) => toasts.push({ message, tone, action: options?.action }) }),
}))
vi.mock('../../src/lib/services', () => ({
  deleteMany: async (table: string, ids: string[]) => { calls.push(`delete:${table}:${ids.join(',')}`); return deleteResult },
  restoreDeleted: async (table: string, ids: string[]) => { calls.push(`restore:${table}:${ids.join(',')}`); return { restored: ids.length, error: null } },
}))

import { Linkify, LinkCards } from '../../src/components/Linkify'
import { FileDropZone } from '../../src/components/FileDropZone'
import { BulkBar, BulkDelete } from '../../src/components/BulkActions'
import { Table } from '../../src/components/ui'

const file = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })

describe('Linkify', () => {
  it('turns links into safe anchors and leaves the rest as text', () => {
    render(<p data-testid="t"><Linkify text="see https://example.com/docs. and www.test.io, ok" /></p>)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/docs', 'https://www.test.io/'])
    for (const a of links) { expect(a.getAttribute('target')).toBe('_blank'); expect(a.getAttribute('rel')).toContain('noopener'); expect(a.getAttribute('rel')).toContain('noreferrer') }
    expect(screen.getByTestId('t').textContent).toBe('see https://example.com/docs. and www.test.io, ok')
  })

  it('never makes a dangerous or deceptive address clickable', () => {
    render(<p data-testid="t"><Linkify text="javascript:alert(1) https://google.com@evil.example/login data:text/html,x" /></p>)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('shows a card with the site name for a link in a message', () => {
    render(<LinkCards text="docs are at https://docs.example.com/guide/start?x=1" />)
    const card = screen.getByRole('link')
    expect(card.textContent).toContain('docs.example.com')
    expect(card.getAttribute('href')).toBe('https://docs.example.com/guide/start?x=1')
  })
})

describe('FileDropZone', () => {
  const setup = (props: Partial<React.ComponentProps<typeof FileDropZone>> = {}) => {
    const onFiles = vi.fn(); const onLinks = vi.fn(); const onReject = vi.fn()
    const view = render(<FileDropZone onFiles={onFiles} onLinks={onLinks} onReject={onReject} {...props} />)
    return { onFiles, onLinks, onReject, zone: view.container.querySelector('.ctf-drop') as HTMLElement }
  }
  const drop = (zone: HTMLElement, dataTransfer: Record<string, unknown>) => fireEvent.drop(zone, { dataTransfer })

  it('accepts dropped files', () => {
    const { zone, onFiles } = setup()
    const f = file('brief.pdf')
    drop(zone, { files: [f], getData: () => '' })
    expect(onFiles).toHaveBeenCalledWith([f])
  })

  it('recognises a dropped link as a link, not as text', () => {
    const { zone, onLinks, onFiles } = setup()
    drop(zone, { files: [], getData: (type: string) => (type === 'text/uri-list' ? '# a comment\nhttps://example.com/a\n' : '') })
    expect(onLinks).toHaveBeenCalledWith(['https://example.com/a'])
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('does not mistake ordinary dropped text for a link', () => {
    const { zone, onLinks, onReject } = setup()
    drop(zone, { files: [], getData: (type: string) => (type === 'text/plain' ? 'remember to look at https://example.com later' : '') })
    expect(onLinks).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/wasn't a file or a web link/))
  })

  it('skips files over the size limit and says so, but still takes the rest', () => {
    const { zone, onFiles, onReject } = setup({ maxMb: 1 })
    const small = file('ok.pdf', 100); const big = file('huge.pdf', 2 * 1024 * 1024)
    drop(zone, { files: [small, big], getData: () => '' })
    expect(onFiles).toHaveBeenCalledWith([small])
    expect(onReject).toHaveBeenCalledWith(expect.stringContaining('huge.pdf'))
  })

  it('treats a link pasted anywhere on the page as a dropped link', () => {
    const { onLinks } = setup()
    fireEvent.paste(document.body, { clipboardData: { files: [], getData: () => 'https://example.com/pasted' } })
    expect(onLinks).toHaveBeenCalledWith(['https://example.com/pasted'])
  })

  it('treats a pasted file (e.g. a screenshot) as a dropped file', () => {
    const { onFiles } = setup()
    const shot = file('screenshot.png')
    fireEvent.paste(document.body, { clipboardData: { files: [shot], getData: () => '' } })
    expect(onFiles).toHaveBeenCalledWith([shot])
  })

  it('leaves a paste alone when it is meant for a text field', () => {
    const { onLinks } = setup()
    const field = document.createElement('input'); document.body.appendChild(field)
    fireEvent.paste(field, { clipboardData: { files: [], getData: () => 'https://example.com/typed-into-a-field' } })
    expect(onLinks).not.toHaveBeenCalled()
    field.remove()
  })

  it('adds a link typed or pasted into its own field, with or without https://', async () => {
    const { onLinks, onReject } = setup()
    const field = screen.getByLabelText('Add a link')
    await userEvent.type(field, 'example.com/page')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(onLinks).toHaveBeenCalledWith(['https://example.com/page'])
    await userEvent.type(field, 'not a link at all')
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(onReject).toHaveBeenCalledWith("That doesn't look like a web link.")
  })

  it('ignores everything while disabled', () => {
    const { zone, onFiles } = setup({ disabled: true })
    drop(zone, { files: [file('a.pdf')], getData: () => '' })
    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('bulk selection and delete', () => {
  beforeEach(() => { toasts.length = 0; calls.length = 0; deleteResult = { removed: 2, error: null } })

  it('the header checkbox selects and clears every row, and shows "some" when partial', async () => {
    const rows = [{ id: 'a', n: 'A' }, { id: 'b', n: 'B' }]
    const onChange = vi.fn()
    const { rerender } = render(<Table rows={rows} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'Name', render: (r) => r.n }]} selection={{ selected: new Set(), onChange }} />)
    await userEvent.click(screen.getByLabelText('Select all rows'))
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b']))
    rerender(<Table rows={rows} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'Name', render: (r) => r.n }]} selection={{ selected: new Set(['a']), onChange }} />)
    expect((screen.getByLabelText('Select all rows') as HTMLInputElement).indeterminate).toBe(true)
    rerender(<Table rows={rows} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'Name', render: (r) => r.n }]} selection={{ selected: new Set(['a', 'b']), onChange }} />)
    await userEvent.click(screen.getByLabelText('Select all rows'))
    expect(onChange).toHaveBeenLastCalledWith(new Set())
  })

  it('shows the bar only while something is selected', () => {
    const { rerender } = render(<BulkBar count={0} onClear={() => undefined}>x</BulkBar>)
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    rerender(<BulkBar count={3} onClear={() => undefined}>x</BulkBar>)
    expect(screen.getByText('3 selected')).toBeTruthy()
  })

  it('deletes after one confirmation, then offers an Undo that restores exactly those rows', async () => {
    const onDone = vi.fn()
    render(<BulkDelete table="leads" ids={['l1', 'l2']} what="lead" onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2' }))
    expect(calls).toEqual([]) // nothing happens before confirming
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 leads' }))
    await waitFor(() => expect(calls).toEqual(['delete:leads:l1,l2']))
    const done = toasts.find((t) => t.message === '2 leads deleted.')
    expect(done?.action?.label).toBe('Undo')
    await done!.action!.onClick()
    expect(calls).toContain('restore:leads:l1,l2')
    expect(toasts.some((t) => t.message === '2 leads restored.')).toBe(true)
    expect(onDone).toHaveBeenCalled()
  })

  it('reports a partial failure honestly and keeps the dialog open', async () => {
    deleteResult = { removed: 1, error: new Error('permission denied for l2') }
    render(<BulkDelete table="leads" ids={['l1', 'l2']} what="lead" onDone={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 leads' }))
    expect((await screen.findByRole('alert')).textContent).toContain('1 deleted before something went wrong')
  })
})
