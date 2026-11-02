import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  insertHandlers: [] as ((n: { id: string; title: string; body: string; kind: string | null }) => void)[],
  unread: 0,
  list: [] as { id: string; title: string; body: string; read_at: string | null; created_at: string }[],
  listCalls: 0,
}))
vi.mock('../../src/lib/services', () => ({
  countUnreadNotifications: async () => ({ count: h.unread, error: null }),
  subscribeToNotifications: (_u: string, cb: (n: { id: string; title: string; body: string; kind: string | null }) => void) => { h.insertHandlers.push(cb); return () => { h.insertHandlers = h.insertHandlers.filter((x) => x !== cb) } },
  listNotifications: async () => { h.listCalls++; return { data: h.list, error: null } },
  markNotificationRead: async () => ({ error: null }), markAllNotificationsRead: async () => ({ error: null }),
}))
vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'me', role: 'worker' } }) }))
vi.mock('../../src/components/SendNotificationModal', () => ({ SendNotificationButton: () => null }))
import { NOTIFICATION_ARRIVED, useUnreadCount } from '../../src/hooks/useUnreadCount'
import { NotificationsPage } from '../../src/pages/NotificationsPage'
import { ToastProvider } from '../../src/components/ui'
const page = () => <ToastProvider><NotificationsPage /></ToastProvider>

const row = (o = {}) => ({ id: 'n1', title: 'Task assigned', body: 'Fix the login page', kind: 'tasks', ...o })
beforeEach(() => { h.insertHandlers = []; h.unread = 0; h.list = []; h.listCalls = 0 })

describe('live notifications while the app is open', () => {
  it('tells the shell what arrived, so it can announce it', async () => {
    const onNew = vi.fn()
    renderHook(() => useUnreadCount('me', onNew))
    await waitFor(() => expect(h.insertHandlers).toHaveLength(1))
    h.unread = 1
    act(() => h.insertHandlers[0](row()))
    expect(onNew).toHaveBeenCalledWith(row())
  })
  it('refreshes the unread count when one arrives', async () => {
    const { result } = renderHook(() => useUnreadCount('me'))
    await waitFor(() => expect(h.insertHandlers).toHaveLength(1))
    expect(result.current.count).toBe(0)
    h.unread = 3
    act(() => h.insertHandlers[0](row()))
    await waitFor(() => expect(result.current.count).toBe(3))
  })
  it('uses the latest callback without re-subscribing (so nothing is announced twice or missed)', async () => {
    const first = vi.fn(), second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useUnreadCount('me', cb), { initialProps: { cb: first } })
    await waitFor(() => expect(h.insertHandlers).toHaveLength(1))
    rerender({ cb: second })
    expect(h.insertHandlers).toHaveLength(1)
    act(() => h.insertHandlers[0](row()))
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1)
  })
  it('a caller that does not ask to announce stays silent, so two listeners never announce one notification twice', async () => {
    const heard = vi.fn()
    window.addEventListener(NOTIFICATION_ARRIVED, heard)
    renderHook(() => useUnreadCount('me'))
    await waitFor(() => expect(h.insertHandlers).toHaveLength(1))
    act(() => h.insertHandlers[0](row()))
    expect(heard).toHaveBeenCalledTimes(1)   // the page-refresh signal still goes out
    window.removeEventListener(NOTIFICATION_ARRIVED, heard)
  })
  it('the open Notifications page reloads itself when one arrives, and shows it', async () => {
    h.list = [{ id: 'old', title: 'Older one', body: '', read_at: null, created_at: new Date().toISOString() }]
    render(page())
    expect(await screen.findByText('Older one')).toBeTruthy()
    const before = h.listCalls
    h.list = [{ id: 'new', title: 'Brand new', body: 'just now', read_at: null, created_at: new Date().toISOString() }, ...h.list]
    act(() => { window.dispatchEvent(new CustomEvent(NOTIFICATION_ARRIVED)) })
    expect(await screen.findByText('Brand new')).toBeTruthy()
    expect(h.listCalls).toBeGreaterThan(before)
  })
  it('stops listening when the page closes', async () => {
    const { unmount } = render(page())
    await screen.findByText(/caught up/i)
    unmount()
    const before = h.listCalls
    window.dispatchEvent(new CustomEvent(NOTIFICATION_ARRIVED))
    await new Promise((r) => setTimeout(r, 20))
    expect(h.listCalls).toBe(before)
  })
})
