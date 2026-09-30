import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, CheckCheck } from 'lucide-react'
import { Button, EmptyState, ErrorState, SkeletonRows, Tabs, useToast } from '../components/ui'
import { SendNotificationButton } from '../components/SendNotificationModal'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/services'
import { useAuth } from '../lib/auth'
import type { Notification } from '../lib/types'
import './NotificationsPage.css'

/** Tells the sidebar badge / bell to re-count, without prop drilling. */
const announceChange = () => window.dispatchEvent(new Event('ctf:notifications-changed'))

export function NotificationsPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'unread' | 'all'>('unread')

  const load = useCallback(() => {
    void listNotifications()
      .then((r) => { if (r.error) setFailed(true); else { setFailed(false); setItems(r.data) } })
      .catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  const unreadCount = (items ?? []).filter((n) => !n.read_at).length
  const visible = (items ?? []).filter((n) => tab === 'all' || !n.read_at)

  const markRead = async (n: Notification) => {
    if (n.read_at) return
    const stamp = new Date().toISOString()
    setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: stamp } : x)) ?? prev)
    const { error } = await markNotificationRead(n.id)
    if (error) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: null } : x)) ?? prev)
      push('Could not mark that as read.', 'error')
      return
    }
    announceChange()
  }

  const markAll = async () => {
    const stamp = new Date().toISOString()
    const snapshot = items
    setItems((prev) => prev?.map((x) => (x.read_at ? x : { ...x, read_at: stamp })) ?? prev)
    const { error } = await markAllNotificationsRead()
    if (error) { setItems(snapshot); push('Could not mark everything as read.', 'error'); return }
    announceChange()
  }

  if (failed) return <ErrorState title="Notifications didn't load" description="Check your connection and try again." onRetry={load} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Tabs label="Filter notifications" tabs={[{ id: 'unread', label: 'Unread', count: unreadCount }, { id: 'all', label: 'All', count: items?.length }]} active={tab} onChange={(id) => setTab(id as 'unread' | 'all')} />
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && <Button variant="secondary" size="sm" icon={<CheckCheck size={14} />} onClick={() => void markAll()}>Mark all read</Button>}
          {(profile?.role === 'manager' || profile?.role === 'superadmin') && <SendNotificationButton onSent={load} />}
        </div>
      </div>
      <div className="ctf-notifications">
        {items === null && <SkeletonRows rows={3} height="64px" />}
        {items !== null && visible.length === 0 && (
          <EmptyState icon={tab === 'unread' ? BellOff : Bell} title={tab === 'unread' ? "You're all caught up" : 'No notifications yet'} description="Updates about your projects, tasks, and requests will appear here." />
        )}
        {visible.map((n) => (
          <button key={n.id} className={`ctf-notification ${n.read_at ? '' : 'is-unread'}`} onClick={() => void markRead(n)} aria-label={`${n.read_at ? '' : 'Unread: '}${n.title}`}>
            <Bell size={16} />
            <div>
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <span>{new Date(n.created_at).toLocaleString()}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
