import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { EmptyState, Tabs } from '../components/ui'
import { listNotifications, markNotificationRead } from '../lib/services'
import type { Notification } from '../lib/types'
import './NotificationsPage.css'

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null)
  const [tab, setTab] = useState<'unread' | 'all'>('unread')

  useEffect(() => { void listNotifications().then((r) => setItems(r.data)) }, [])

  const visible = (items ?? []).filter((n) => tab === 'all' || !n.read_at)

  const markRead = async (id: string) => {
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) ?? prev)
    await markNotificationRead(id)
  }

  return (
    <div>
      <Tabs tabs={[{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }]} active={tab} onChange={(id) => setTab(id as 'unread' | 'all')} />
      <div className="ctf-notifications">
        {items === null && null}
        {items !== null && visible.length === 0 && (
          <EmptyState icon={tab === 'unread' ? BellOff : Bell} title={tab === 'unread' ? "You're all caught up" : 'No notifications yet'} description="Updates about your projects, tasks, and requests will appear here." />
        )}
        {visible.map((n) => (
          <button key={n.id} className={`ctf-notification ${n.read_at ? '' : 'is-unread'}`} onClick={() => markRead(n.id)}>
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
