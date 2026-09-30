import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: string[] = []

vi.mock('../../src/lib/services', () => ({
  listMyChannels: async () => ({ data: [{ id: 'c1', type: 'group', name: 'General', project_id: null, created_at: '2026-01-01' }], error: null }),
  listMessages: async () => ({ data: [], error: null }),
  subscribeToChannel: () => () => {},
  subscribeToPresence: () => () => {},
  getDisplayNames: async () => ({}),
  sendMessage: async (_channelId: string, body: string) => {
    sent.push(body)
    return { data: { id: `m${sent.length}`, channel_id: 'c1', sender_id: 'me', body, created_at: new Date().toISOString() }, error: null }
  },
}))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role: 'worker' } }) }))
vi.mock('../../src/components/CallProvider', () => ({ useCall: () => ({ phase: 'idle', startCallWith: vi.fn() }) }))
vi.mock('../../src/components/GroupCallProvider', () => ({ useGroupCall: () => ({ call: null, joining: false, joinChannelCall: vi.fn() }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: vi.fn() }) }))

import { TeamChat } from '../../src/pages/TeamChat'

describe('chat composer', () => {
  beforeEach(() => { sent.length = 0; Element.prototype.scrollTo = () => {} })

  it('keeps focus after sending, so you can keep typing without clicking back in', async () => {
    const user = userEvent.setup()
    render(<TeamChat />)
    const box = await screen.findByLabelText('Message General')
    await user.click(box)
    await user.keyboard('first message{Enter}')

    await waitFor(() => expect(screen.getByText('first message')).toBeTruthy())
    expect(document.activeElement).toBe(box) // the old input was disabled while sending, which dropped focus

    await user.keyboard('second message')
    expect((box as HTMLTextAreaElement).value).toBe('second message')
    expect(sent).toEqual(['first message'])
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
