<<<<<<< HEAD
import { useState, type ComponentType, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Avatar } from '../components/ui'
import { useAuth } from '../lib/auth'
=======
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Avatar } from '../components/ui'
import { useAuth } from '../lib/auth'
import { getUnreadNotificationCount } from '../lib/services/workspace'
import { subscribeToMyNotifications, unsubscribe } from '../lib/realtime'
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
import './WorkspaceLayout.css'

export interface NavGroup {
  label?: string
  items: { label: string; path: string; icon: ComponentType<{ size?: number }> }[]
}

export function WorkspaceLayout({
  navGroups,
  settingsPath,
  children,
}: {
  navGroups: NavGroup[]
  settingsPath: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
<<<<<<< HEAD
=======
  // Desktop icon-rail collapse — separate from the mobile open/close
  // overlay above (`open`). Persisted so the choice survives a reload.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ctf-sidebar-collapsed') === 'true')
  const [unreadCount, setUnreadCount] = useState(0)
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const allItems = navGroups.flatMap((g) => g.items)
  const currentLabel = [...allItems].sort((a, b) => b.path.length - a.path.length).find((i) => location.pathname.startsWith(i.path))?.label ?? 'Overview'
<<<<<<< HEAD
=======
  // /worker/notifications, /admin/notifications, /client/notifications —
  // derived from the current workspace segment rather than threaded
  // through as another prop on every call site.
  const workspaceSegment = location.pathname.split('/')[1] || 'worker'
  const notificationsPath = `/${workspaceSegment}/notifications`

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('ctf-sidebar-collapsed', String(!c))
      return !c
    })
  }

  useEffect(() => {
    const load = () => void getUnreadNotificationCount().then(({ count }) => setUnreadCount(count))
    load()
    const channel = subscribeToMyNotifications(load)
    return () => unsubscribe(channel)
  }, [])
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
<<<<<<< HEAD
    <div className="ctf-workspace">
=======
    <div className={`ctf-workspace ${collapsed ? 'is-collapsed' : ''}`}>
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
      <aside className={`ctf-sidebar ${open ? 'is-open' : ''}`}>
        <div className="ctf-sidebar__head">
          <Brand tagline={false} />
          <button className="ctf-sidebar__close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {profile && (
          <div className="ctf-sidebar__role">
            <span className="ctf-role-dot" />
<<<<<<< HEAD
            {profile.role === 'superadmin' ? 'Admin' : profile.role}
=======
            <span className="ctf-sidebar__role-label">{profile.role === 'superadmin' ? 'Admin' : profile.role}</span>
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
          </div>
        )}
        <nav className="ctf-sidebar__nav" aria-label="Workspace navigation">
          {navGroups.map((group, gi) => (
            <div key={gi} className="ctf-sidebar__group">
              {group.label && <span>{group.label}</span>}
              {group.items.map(({ label, path, icon: Icon }) => (
<<<<<<< HEAD
                <NavLink key={path} to={path} end onClick={() => setOpen(false)} className={({ isActive }) => `ctf-sidebar__link ${isActive ? 'is-active' : ''}`}>
                  <Icon size={17} />
                  {label}
=======
                <NavLink key={path} to={path} end onClick={() => setOpen(false)} className={({ isActive }) => `ctf-sidebar__link ${isActive ? 'is-active' : ''}`} title={label}>
                  <Icon size={17} />
                  <span className="ctf-sidebar__link-label">{label}</span>
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="ctf-sidebar__foot">
<<<<<<< HEAD
          <NavLink to={settingsPath} className="ctf-sidebar__link" onClick={() => setOpen(false)}>
            <Settings size={17} /> Settings
          </NavLink>
          <button className="ctf-sidebar__link" onClick={handleSignOut}>
            <LogOut size={17} /> Sign out
=======
          <NavLink to={settingsPath} className="ctf-sidebar__link" onClick={() => setOpen(false)} title="Settings">
            <Settings size={17} /> <span className="ctf-sidebar__link-label">Settings</span>
          </NavLink>
          <button className="ctf-sidebar__link" onClick={handleSignOut} title="Sign out">
            <LogOut size={17} /> <span className="ctf-sidebar__link-label">Sign out</span>
          </button>
          <button className="ctf-sidebar__collapse-toggle" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            <span>Collapse</span>
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
          </button>
        </div>
      </aside>

      {open && <div className="ctf-sidebar-overlay" onClick={() => setOpen(false)} />}

      <div className="ctf-workspace__main">
        <header className="ctf-topbar">
          <button className="ctf-topbar__menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="ctf-topbar__title">
            <span className="eyebrow muted">{profile?.display_name || 'Workspace'}</span>
            <h1>{currentLabel}</h1>
          </div>
          <div className="ctf-topbar__actions">
            <button className="ctf-topbar__icon" aria-label="Search"><Search size={17} /></button>
<<<<<<< HEAD
            <button className="ctf-topbar__icon" aria-label="Notifications"><Bell size={17} /></button>
=======
            <button className="ctf-topbar__icon ctf-topbar__bell" aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'} onClick={() => navigate(notificationsPath)}>
              <Bell size={17} />
              {unreadCount > 0 && <span className="ctf-topbar__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
            {profile && <Avatar name={profile.display_name || 'U'} size={32} />}
          </div>
        </header>
        <div className="ctf-workspace__content">{children}</div>
      </div>
    </div>
  )
}
