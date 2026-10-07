import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const GENERAL = { id: 'c1', type: 'group', name: 'General', project_id: null, created_at: '2026-01-01' }
const DM = { id: 'dm1', type: 'dm', name: '', project_id: null, created_at: '2026-02-01' }
const TEAM = [
  { id: 'me', display_name: 'Me Myself', role: 'worker' },
  { id: 'u2', display_name: 'Ada Lovelace', role: 'worker' },
  { id: 'u3', display_name: 'Grace Hopper', role: 'manager' },
]

let channels: unknown[] = [GENERAL]
const sent: { body: string; attachments: unknown[] }[] = []
const dmRequests: string[] = []
const uploads: string[] = []
const toasts: { message: string; tone?: string }[] = []

vi.mock('../../src/lib/services', () => ({
  listMyChannels: async () => ({ data: channels, error: null }),
  listMessages: async () => ({ data: [], error: null }),
  listTeamMembers: async () => ({ data: TEAM, error: null }),
  listDmPartners: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'u2'])),
  listChannelMemberIds: async () => ['me', 'u2', 'u3'],
  getOrCreateDm: async (other: string) => { dmRequests.push(other); channels = [GENERAL, DM]; return { data: 'dm1', error: null } },
  subscribeToChannel: () => () => {},
  subscribeToMyChannelMembership: () => () => {},
  getDisplayNames: async () => ({}),
  getChatMediaUrl: async () => 'https://example.test/signed',
  deleteChatMedia: async () => {},
  uploadChatMedia: async (_c: string, file: File) => { uploads.push(file.name); return { data: { path: `c/me/${file.name}`, name: file.name, mime: file.type, size: file.size }, error: null } },
  sendMessage: async (_c: string, body: string, attachments: unknown[] = []) => {
    sent.push({ body, attachments })
    return { data: { id: `m${sent.length}`, channel_id: 'c1', sender_id: 'me', body, attachments, created_at: new Date().toISOString() }, error: null }
  },
}))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me Myself', role: 'worker' } }) }))
vi.mock('../../src/components/CallProvider', () => ({ useCall: () => ({ phase: 'idle', startCallWith: vi.fn() }) }))
vi.mock('../../src/components/GroupCallProvider', () => ({ useGroupCall: () => ({ call: null, joining: false, joinChannelCall: vi.fn() }) }))
vi.mock('../../src/components/PresenceProvider', () => ({
  usePresence: () => ({ onlineIds: new Set(['u2']), statusOf: (id: string) => (id === 'u2' ? 'online' : 'offline') }),
}))
vi.mock('../../src/components/ChatActivityProvider', () => ({ useChatActivity: () => ({ unread: { dm1: 3 }, totalUnread: 3, setActiveChannel: vi.fn() }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (message: string, tone?: string) => toasts.push({ message, tone }) }) }))

import { TeamChat } from '../../src/pages/TeamChat'

describe('chat', () => {
  beforeEach(() => {
    channels = [GENERAL]; sent.length = 0; dmRequests.length = 0; uploads.length = 0; toasts.length = 0
    Element.prototype.scrollTo = () => {}
    globalThis.URL.createObjectURL = () => 'blob:preview'; globalThis.URL.revokeObjectURL = () => {}
  })

  describe('composer', () => {
    it('keeps focus after sending, so you can keep typing without clicking back in', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      const box = await screen.findByLabelText('Message General')
      await user.click(box)
      await user.keyboard('first message{Enter}')
      await waitFor(() => expect(screen.getByText('first message')).toBeTruthy())
      expect(document.activeElement).toBe(box)
      await user.keyboard('second message')
      expect((box as HTMLTextAreaElement).value).toBe('second message')
      expect(sent.map((s) => s.body)).toEqual(['first message'])
    })
    it('Shift+Enter inserts a newline instead of sending', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      const box = (await screen.findByLabelText('Message General')) as HTMLTextAreaElement
      await user.click(box)
      await user.keyboard('line one{Shift>}{Enter}{/Shift}line two')
      expect(box.value).toBe('line one\nline two')
      expect(sent).toHaveLength(0)
    })
    it('does not send empty or whitespace-only messages', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      const box = await screen.findByLabelText('Message General')
      await user.click(box)
      await user.keyboard('   {Enter}')
      expect(sent).toHaveLength(0)
      expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('channel list (the "five Generals" bug)', () => {
    it('shows General exactly once', async () => {
      render(<TeamChat />)
      await screen.findByLabelText('Message General')
      const sidebar = screen.getByRole('complementary', { name: /conversations/i })
      expect(within(sidebar).getAllByRole('button', { name: /^General/ })).toHaveLength(1)
    })
  })

  describe('private chat from the People directory', () => {
    it('lists teammates (not yourself), online first, with their status', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      await user.click(await screen.findByRole('tab', { name: /people/i }))
      const people = screen.getAllByRole('button', { name: /^Message / })
      expect(people.map((b) => b.getAttribute('aria-label'))).toEqual(['Message Ada Lovelace, Online', 'Message Grace Hopper, Offline'])
      expect(screen.queryByRole('button', { name: /Message Me Myself/ })).toBeNull()
    })
    it('the directory can be searched', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      await user.click(await screen.findByRole('tab', { name: /people/i }))
      await user.type(screen.getByPlaceholderText(/find a teammate/i), 'grace')
      expect(screen.getAllByRole('button', { name: /^Message / })).toHaveLength(1)
      expect(screen.getByRole('button', { name: /Message Grace Hopper/ })).toBeTruthy()
    })
    it('clicking a person opens a private conversation labelled with their name', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      await user.click(await screen.findByRole('tab', { name: /people/i }))
      await user.click(screen.getByRole('button', { name: /Message Ada Lovelace/ }))
      expect(dmRequests).toEqual(['u2'])
      expect(await screen.findByLabelText('Message Ada Lovelace')).toBeTruthy() // the thread is open
      expect(screen.getByText(/Only the two of you can see/)).toBeTruthy()
      const sidebar = screen.getByRole('complementary', { name: /conversations/i })
      expect(within(sidebar).getByText('Direct messages')).toBeTruthy()
      expect(within(sidebar).getByRole('button', { name: /Ada Lovelace/ })).toBeTruthy()
    })
    it('a DM shows its unread count and a live presence status; calling is offered when they are online', async () => {
      channels = [GENERAL, DM]
      render(<TeamChat />)
      const sidebar = await screen.findByRole('complementary', { name: /conversations/i })
      expect(await within(sidebar).findByLabelText('3 unread')).toBeTruthy()
      expect(within(sidebar).getByLabelText('Online')).toBeTruthy()
      await userEvent.setup().click(within(sidebar).getByRole('button', { name: /Ada Lovelace/ }))
      expect((await screen.findByRole('button', { name: /voice/i }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  describe('attachments', () => {
    // applyAccept:false == the "All files" option in an OS picker, or a drag-and-drop: the input's accept= hint doesn't protect us there.
    const pick = async (files: File[]) => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.setup({ applyAccept: false }).upload(input, files)
    }
    it('uploads a chosen file, then sends it with the message', async () => {
      const user = userEvent.setup()
      render(<TeamChat />)
      await screen.findByLabelText('Message General')
      await pick([new File(['x'.repeat(2048)], 'Screenshot 5.12\u202fPM.png', { type: 'image/png' })])
      await waitFor(() => expect(uploads).toEqual(['Screenshot 5.12\u202fPM.png']))
      const chip = await screen.findByRole('list', { name: /attachments to send/i })
      await waitFor(() => expect(within(chip).getByText('2.0 KB')).toBeTruthy())
      await user.click(screen.getByRole('button', { name: 'Send message' })) // attachment-only message is allowed
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0].body).toBe('')
      expect(sent[0].attachments).toEqual([{ path: 'c/me/Screenshot 5.12\u202fPM.png', name: 'Screenshot 5.12\u202fPM.png', mime: 'image/png', size: 2048 }])
      await waitFor(() => expect(screen.queryByRole('list', { name: /attachments to send/i })).toBeNull())
    })
    it('rejects an unsupported type with a clear reason and uploads nothing', async () => {
      render(<TeamChat />)
      await screen.findByLabelText('Message General')
      await pick([new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })])
      await waitFor(() => expect(toasts.at(-1)?.message).toMatch(/can't be sent here/))
      expect(uploads).toHaveLength(0)
    })
    it('rejects a file over the size limit before wasting an upload', async () => {
      render(<TeamChat />)
      await screen.findByLabelText('Message General')
      const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' })
      Object.defineProperty(big, 'size', { value: 80 * 1024 * 1024 })
      await pick([big])
      await waitFor(() => expect(toasts.at(-1)?.message).toMatch(/limit is 50 MB/))
      expect(uploads).toHaveLength(0)
    })
    it('caps the number of attachments per message', async () => {
      render(<TeamChat />)
      await screen.findByLabelText('Message General')
      await pick(Array.from({ length: 8 }, (_, i) => new File(['x'], `p${i}.png`, { type: 'image/png' })))
      await waitFor(() => expect(toasts.some((t) => /up to 6 files/.test(t.message))).toBe(true))
      expect(uploads).toHaveLength(6)
    })
    it('a pasted screenshot becomes an attachment', async () => {
      render(<TeamChat />)
      const box = await screen.findByLabelText('Message General')
      const file = new File(['x'], 'pasted.png', { type: 'image/png' })
      const { fireEvent } = await import('@testing-library/react')
      fireEvent.paste(box, { clipboardData: { files: [file], getData: () => '' } })
      await waitFor(() => expect(uploads).toEqual(['pasted.png']))
    })
  })
})
