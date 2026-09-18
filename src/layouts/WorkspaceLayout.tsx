import { useState, type ComponentType, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Avatar } from '../components/ui'
import { useAuth } from '../lib/auth'
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
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const allItems = navGroups.flatMap((g) => g.items)
  const currentLabel = [...allItems].sort((a, b) => b.path.length - a.path.length).find((i) => location.pathname.startsWith(i.path))?.label ?? 'Overview'

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <div className="ctf-workspace">
      <aside className={`ctf-sidebar ${open ? 'is-open' : ''}`}>
        <div className="ctf-sidebar__head">
          <Brand tagline={false} />
          <button className="ctf-sidebar__close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {profile && (
          <div className="ctf-sidebar__role">
            <span className="ctf-role-dot" />
            {profile.role === 'superadmin' ? 'Admin' : profile.role}
          </div>
        )}
        <nav className="ctf-sidebar__nav" aria-label="Workspace navigation">
          {navGroups.map((group, gi) => (
            <div key={gi} className="ctf-sidebar__group">
              {group.label && <span>{group.label}</span>}
              {group.items.map(({ label, path, icon: Icon }) => (
                <NavLink key={path} to={path} end onClick={() => setOpen(false)} className={({ isActive }) => `ctf-sidebar__link ${isActive ? 'is-active' : ''}`}>
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="ctf-sidebar__foot">
          <NavLink to={settingsPath} className="ctf-sidebar__link" onClick={() => setOpen(false)}>
            <Settings size={17} /> Settings
          </NavLink>
          <button className="ctf-sidebar__link" onClick={handleSignOut}>
            <LogOut size={17} /> Sign out
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
            <button className="ctf-topbar__icon" aria-label="Notifications"><Bell size={17} /></button>
            {profile && <Avatar name={profile.display_name || 'U'} size={32} />}
          </div>
        </header>
        <div className="ctf-workspace__content">{children}</div>
      </div>
    </div>
  )
}
