import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let role = 'superadmin'
const toasts: string[] = []
const LONG_BIO = 'Builds systems that last. '.repeat(20).trim()
const team = [
  { id: 't1', display_name: 'Ada Lovelace', public_title: 'Engineer', bio: LONG_BIO, photo_path: null, skills: ['TS', 'SQL', 'Go', 'Rust', 'C', 'Zig'], social_links: {}, display_order: 1, featured: false },
  { id: 't2', display_name: 'Grace Hopper', public_title: 'Admiral', bio: 'Short bio.', photo_path: null, skills: ['COBOL'], social_links: {}, display_order: 2, featured: false },
]

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role } }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (m: string) => toasts.push(m) }) }))
vi.mock('../../src/lib/services', () => ({ listPublicTeam: async () => ({ data: team, error: null }), getTeamPhotoUrl: () => null }))
vi.mock('../../src/layouts/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

import { MemoryRouter } from 'react-router'
import { DeleteButton } from '../../src/components/DeleteButton'
import { Team } from '../../src/pages/public/Team'

describe('DeleteButton', () => {
  beforeEach(() => { role = 'superadmin'; toasts.length = 0 })

  it('is only offered to the Main Admin — the one role the database lets delete', () => {
    role = 'worker'
    const { container } = render(<DeleteButton what="post" name="Hello" onDelete={async () => ({ error: null })} />)
    expect(container.textContent).toBe('')
  })

  it('asks first, names what will be deleted, and does nothing until confirmed', async () => {
    const onDelete = vi.fn(async () => ({ error: null }))
    const onDeleted = vi.fn()
    render(<DeleteButton what="post" name="Hello world" onDelete={onDelete} onDeleted={onDeleted} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText('Hello world')).toBeTruthy()
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(toasts.join(' ')).toContain('Hello world')
  })

  it('with type-to-confirm, the button stays disabled until the exact text is typed (any case)', async () => {
    const onDelete = vi.fn(async () => ({ error: null }))
    render(<DeleteButton what="worker" name="Ada" typeToConfirm="CTF-0042" onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    const confirm = screen.getByRole('button', { name: 'Delete worker' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await userEvent.type(screen.getByRole('textbox'), 'ctf-004')
    expect(confirm.disabled).toBe(true)
    await userEvent.type(screen.getByRole('textbox'), '2')
    expect(confirm.disabled).toBe(false)
    await userEvent.click(confirm)
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
  })

  it('keeps the dialog open and shows the reason when the delete fails', async () => {
    const onDeleted = vi.fn()
    render(<DeleteButton what="lead" name="Spam" onDelete={async () => ({ error: new Error("You don't have permission to delete this lead.") })} onDeleted={onDeleted} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete lead' }))
    expect((await screen.findByRole('alert')).textContent).toContain("don't have permission")
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})

describe('Team page bios', () => {
  it('cuts a long bio short with a Read more that opens the full text, and leaves short bios alone', async () => {
    render(<MemoryRouter><Team /></MemoryRouter>)
    await screen.findByText('Ada Lovelace')
    // Only the long profile (and its overflowing skills) gets the control.
    const buttons = screen.getAllByRole('button', { name: /read more/i })
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toContain('Ada Lovelace')
    expect(screen.getByText('+2')).toBeTruthy() // 6 skills, 4 shown
    await userEvent.click(buttons[0])
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(LONG_BIO)
    expect(dialog.textContent).toContain('Zig') // the skills hidden on the card are all here
  })
})
