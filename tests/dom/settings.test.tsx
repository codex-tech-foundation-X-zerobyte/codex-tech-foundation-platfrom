import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let role = 'worker'
const toasts: { message: string; tone?: string }[] = []
let saveResult: { error: Error | null } = { error: null }
let passwordResult: { error: Error | null } = { error: null }
const calls: string[] = []
const clipboard: string[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'u1', display_name: 'Ada Lovelace', role }, refresh: async () => null }) }))
vi.mock('../../src/lib/services', () => ({
  getSessionInfo: async () => ({ email: 'ada@example.com', lastSignInAt: '2026-09-30T08:00:00Z', createdAt: null, expiresAt: '2026-09-30T09:00:00Z' }),
  updateOwnProfile: async (i: { display_name: string }) => { calls.push(`profile:${i.display_name}`); return saveResult },
  changePassword: async (p: string) => { calls.push(`password:${p.length}`); return passwordResult },
  signOutOtherSessions: async () => { calls.push('signOutOthers'); return { error: null } },
}))
vi.mock('../../src/components/ui', async (orig) => ({
  ...(await orig<typeof import('../../src/components/ui')>()),
  useToast: () => ({ push: (message: string, tone?: string) => toasts.push({ message, tone }) }),
  copyToClipboard: async (t: string) => { clipboard.push(t); return true },
}))
vi.mock('../../src/components/DeviceTester', () => ({ DeviceTester: () => <div>device tester</div> }))
vi.mock('../../src/lib/ringtone', () => ({ playChime: vi.fn(), startRingtone: vi.fn(), stopRingtone: vi.fn() }))

import { MemoryRouter } from 'react-router'
import { AccountSettings } from '../../src/pages/AccountSettings'
import { getPrefs, setPref, DEFAULT_PREFS } from '../../src/lib/prefs'

const mount = () => render(<MemoryRouter><AccountSettings /></MemoryRouter>)

describe('Settings', () => {
  beforeEach(() => {
    role = 'worker'; toasts.length = 0; calls.length = 0; clipboard.length = 0; saveResult = { error: null }; passwordResult = { error: null }
    localStorage.clear(); for (const [k, v] of Object.entries(DEFAULT_PREFS)) setPref(k as keyof typeof DEFAULT_PREFS, v as never)
  })

  it('shows the account facts: email, role, device and sign-in details', async () => {
    mount()
    expect(await screen.findByDisplayValue('ada@example.com')).toBeTruthy()
    expect((screen.getByLabelText('Role') as HTMLInputElement).value).toBe('Worker')
    expect(screen.getByText(/on Linux|on Windows|on macOS|on an unknown system/)).toBeTruthy()
  })

  describe('profile', () => {
    it('saving is disabled until the name actually changes', async () => {
      const user = userEvent.setup(); mount()
      const save = screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement
      expect(save.disabled).toBe(true)
      await user.type(screen.getByLabelText(/display name/i), ' Byron')
      expect(save.disabled).toBe(false)
    })
    it('a failed save shows the REAL reason, not a generic line', async () => {
      const user = userEvent.setup(); saveResult = { error: new Error("You don't have permission to do that.") }; mount()
      await user.type(screen.getByLabelText(/display name/i), 'x')
      await user.click(screen.getByRole('button', { name: 'Save profile' }))
      await waitFor(() => expect(toasts.at(-1)).toEqual({ message: "You don't have permission to do that.", tone: 'error' }))
    })
  })

  describe('password', () => {
    const type = async (a: string, b = a) => {
      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/^new password/i), a)
      await user.type(screen.getByLabelText(/^confirm password/i), b)
      return user
    }
    it('cannot be submitted while too short, and says how many more characters', async () => {
      mount(); await type('short1')
      expect((screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByText(/4 more/)).toBeTruthy()
    })
    it('rates a guessable password as weak and explains why', async () => {
      mount(); await type('Password12345!')
      expect(screen.getByText('Weak')).toBeTruthy()
      expect(screen.getByText(/common or personal words/)).toBeTruthy()
    })
    it('flags personal details: a password containing your name is called out', async () => {
      mount(); await type('Lovelace-2026-ok!')
      expect(screen.getByText(/personal words \(like "lovelace"\)/)).toBeTruthy()
    })
    it('a mismatch blocks submission', async () => {
      mount(); await type('correct-Horse-battery-7', 'correct-Horse-battery-8')
      expect((screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByText(/don't match yet/i)).toBeTruthy()
    })
    it('a good password changes and the form clears', async () => {
      mount(); const user = await type('correct-Horse-battery-7-staple')
      expect(screen.getByText('Strong')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Change password' }))
      await waitFor(() => expect(calls).toContain('password:30'))
      await waitFor(() => expect((screen.getByLabelText(/^new password/i) as HTMLInputElement).value).toBe(''))
    })
    it('a server refusal is shown inline', async () => {
      passwordResult = { error: new Error('New password should be different from the old password.') }
      mount(); const user = await type('correct-Horse-battery-7-staple')
      await user.click(screen.getByRole('button', { name: 'Change password' }))
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'New password should be different from the old password.')
    })
    it('the show/hide toggle reveals what you typed', async () => {
      const user = userEvent.setup(); mount()
      const field = screen.getByLabelText(/^new password/i) as HTMLInputElement
      expect(field.type).toBe('password')
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(field.type).toBe('text')
    })
  })

  describe('sessions', () => {
    it('signing out other devices needs confirmation, then calls the service', async () => {
      const user = userEvent.setup(); mount()
      await user.click(screen.getByRole('button', { name: 'Sign out other devices' }))
      expect(calls).not.toContain('signOutOthers') // not yet
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Sign out others' }))
      await waitFor(() => expect(calls).toContain('signOutOthers'))
      expect(toasts.at(-1)?.message).toMatch(/Signed out of all other devices/)
    })
    it('cancelling does nothing', async () => {
      const user = userEvent.setup(); mount()
      await user.click(screen.getByRole('button', { name: 'Sign out other devices' }))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(calls).not.toContain('signOutOthers')
    })
  })

  describe('preferences', () => {
    it('toggles persist to this device and take effect', async () => {
      const user = userEvent.setup(); mount()
      expect(getPrefs().callSounds).toBe(true)
      await user.click(screen.getByRole('switch', { name: 'Call ringtone' }))
      expect(getPrefs().callSounds).toBe(false)
      expect(screen.getByRole('switch', { name: 'Call ringtone' }).getAttribute('aria-checked')).toBe('false')
      await user.click(screen.getByRole('switch', { name: 'Compact layout' }))
      expect(getPrefs().compact).toBe(true)
    })
    it('desktop alerts: a blocked permission leaves it off and explains how to fix it', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission: async () => 'denied' }))
      mount()
      await user.click(screen.getByRole('switch', { name: 'Desktop alerts' }))
      await waitFor(() => expect(toasts.at(-1)?.message).toMatch(/blocked for this site/))
      expect(getPrefs().desktopAlerts).toBe(false)
      vi.unstubAllGlobals()
    })
    it('desktop alerts: granting permission turns it on', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission: async () => 'granted' }))
      mount()
      await user.click(screen.getByRole('switch', { name: 'Desktop alerts' }))
      await waitFor(() => expect(getPrefs().desktopAlerts).toBe(true))
      vi.unstubAllGlobals()
    })
  })

  describe('support', () => {
    it('copied diagnostics contain environment facts and NO personal data or secrets', async () => {
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }) // jsdom doesn't implement it
      const user = userEvent.setup(); mount()
      await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
      await waitFor(() => expect(clipboard).toHaveLength(1))
      expect(clipboard[0]).toMatch(/Secure context \(HTTPS\): yes/)
      expect(clipboard[0]).toMatch(/Role: worker/)
      for (const secret of ['ada@example.com', 'Ada', 'Lovelace', 'u1', 'token', 'Bearer']) expect(clipboard[0]).not.toContain(secret)
    })
    it('verbose logging is opt-in and reversible', async () => {
      const user = userEvent.setup(); mount()
      await user.click(screen.getByRole('switch', { name: 'Verbose error logging' }))
      expect(localStorage.getItem('ctf:debug')).toBe('1')
      await user.click(screen.getByRole('switch', { name: 'Verbose error logging' }))
      expect(localStorage.getItem('ctf:debug')).toBeNull()
    })
  })

  describe('role-aware', () => {
    it('team members get notifications, call devices and shortcuts', () => {
      mount()
      for (const name of ['Notifications', 'Calls & devices', 'Keyboard shortcuts']) expect(screen.getByRole('heading', { name })).toBeTruthy()
    })
    it('clients are not shown call, chat or shortcut settings that do not apply to them', () => {
      role = 'client'; mount()
      for (const name of ['Notifications', 'Calls & devices', 'Keyboard shortcuts']) expect(screen.queryByRole('heading', { name })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Security' })).toBeTruthy()
    })
  })
})
