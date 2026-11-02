import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let role = 'worker'
let saveError: Error | null = null
const saved: string[] = []
const toasts: string[] = []
let prefs: Record<string, Record<string, boolean>> = {}
const downloads: string[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', display_name: 'Me', role } }) }))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (m: string) => toasts.push(m) }) }))
vi.mock('../../src/lib/services', () => ({
  getEventPrefs: async () => ({ data: prefs, error: null }),
  setEventPref: async (kind: string, channel: string, enabled: boolean) => { saved.push(`${kind}.${channel}=${enabled}`); return { error: saveError } },
  downloadResource: async (r: { title: string }) => { downloads.push(r.title); return { error: null } },
  fetchResourceBlob: async () => ({ blob: null, error: null, tooLarge: false }),
}))

import { NotificationEvents } from '../../src/components/NotificationEvents'
import { ResourcePreview } from '../../src/components/ResourcePreview'
import type { Resource } from '../../src/lib/types'

describe('per-event notification settings', () => {
  beforeEach(() => { role = 'worker'; saveError = null; saved.length = 0; toasts.length = 0; prefs = {} })

  it('everything starts on, and each person only sees the kinds that apply to their role', async () => {
    render(<NotificationEvents />)
    expect(await screen.findByText('Chat messages')).toBeTruthy()
    expect(screen.queryByText('Approvals')).toBeNull() // managers and the Main Admin only
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).checked).toBe(true)
  })

  it('a client only sees project updates', async () => {
    role = 'client'
    render(<NotificationEvents />)
    expect(await screen.findByText('Project updates')).toBeTruthy()
    expect(screen.queryByText('Chat messages')).toBeNull()
    expect(screen.queryByText('Tasks')).toBeNull()
  })

  it('shows saved choices and saves a change straight away', async () => {
    prefs = { tasks: { push: false } }
    render(<NotificationEvents />)
    const tasksPush = (await screen.findByLabelText('Tasks: push notification')) as HTMLInputElement
    expect(tasksPush.checked).toBe(false)
    expect((screen.getByLabelText('Tasks: in-app notification') as HTMLInputElement).checked).toBe(true)
    await userEvent.click(tasksPush)
    expect(tasksPush.checked).toBe(true)
    await waitFor(() => expect(saved).toEqual(['tasks.push=true']))
  })

  it('puts the tick back and says why when a choice could not be saved', async () => {
    saveError = new Error('Unknown notification type.')
    render(<NotificationEvents />)
    const chat = (await screen.findByLabelText('Chat messages: push notification')) as HTMLInputElement
    await userEvent.click(chat)
    await waitFor(() => expect(toasts).toContain('Unknown notification type.'))
    expect(chat.checked).toBe(true) // back to what is actually saved
  })

  it('chat and calls only offer push (they have no in-app notification row)', async () => {
    render(<NotificationEvents />)
    await screen.findByText('Calls')
    expect(screen.queryByLabelText('Chat messages: in-app notification')).toBeNull()
    expect(screen.queryByLabelText('Calls: in-app notification')).toBeNull()
  })
})

describe('the resource viewer', () => {
  const base: Resource = { id: 'r1', title: 'Quarterly numbers', description: '', category: 'general', storage_path: null, url: null, owner_id: null, created_at: '2026-10-01T00:00:00Z' } as Resource

  it('shows a link as an Open link button pointing at the stored address, with the site name', () => {
    render(<ResourcePreview resource={{ ...base, title: 'Repo', url: 'https://github.com/org/repo' }} onClose={() => undefined} />)
    const open = screen.getByRole('link', { name: /open link/i })
    expect(open.getAttribute('href')).toBe('https://github.com/org/repo')
    expect(open.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('github.com')).toBeTruthy()
  })

  it('says plainly that an office file cannot be shown, and offers a download that works', async () => {
    render(<ResourcePreview resource={{ ...base, storage_path: 'abc-numbers.xlsx' }} onClose={() => undefined} />)
    expect(screen.getByText(/can't be shown here/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(downloads).toEqual(['Quarterly numbers']))
  })

  it('tells you when a file cannot be opened instead of leaving a spinner', async () => {
    render(<ResourcePreview resource={{ ...base, storage_path: 'abc-brief.pdf' }} onClose={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be opened/i)
  })
})
