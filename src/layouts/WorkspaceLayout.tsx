import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Bell, ChevronRight, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { CommandPalette, type PaletteItem } from '../components/CommandPalette'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Avatar } from '../components/ui'
import { TOOLS } from '../pages/tools/toolsMeta'
import { useAuth } from '../lib/auth'
import { useUnreadCount } from '../hooks/useUnreadCount'
import './WorkspaceLayout.css'

export interface NavItem {
  label: string
  path: string
  icon: ComponentType<{ size?: number }>
  superadminOnly?: boolean
  description?: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

/** Drops superadmin-only items for anyone else — so a manager's sidebar never links to a page RLS will block. */
export function navForRole(groups: NavGroup[], role: string | null | undefined): NavGroup[] {
  if (role === 'superadmin') return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.superadminOnly) }))
    .filter((g) => g.items.length > 0)
}

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

export function WorkspaceLayout({ navGroups, settingsPath, children }: { navGroups: NavGroup[]; settingsPath: string; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Drawer is 'open for a path', so navigating (which changes the path) closes it without an effect.
  const [drawerAt, setDrawerAt] = useState<string | null>(null)
  const drawerOpen = drawerAt === location.pathname
  const setDrawerOpen = useCallback((value: boolean) => setDrawerAt(value ? location.pathname : null), [location.pathname])
  const { count: unread } = useUnreadCount(profile?.id)
  const mainRef = useRef<HTMLElement>(null)

  const visibleNavGroups = useMemo(() => navForRole(navGroups, profile?.role), [navGroups, profile?.role])
  const allItems = useMemo(() => visibleNavGroups.flatMap((g) => g.items), [visibleNavGroups])
  const basePath = allItems.find((i) => i.path.split('/').length === 2)?.path ?? '/'

  // The active nav item is the LONGEST matching prefix, so /admin/content/case-studies doesn't also light up /admin/content.
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  const current = useMemo(
    () => [...allItems].sort((a, b) => b.path.length - a.path.length).find((i) => pathname === i.path || pathname.startsWith(i.path + '/')),
    [allItems, pathname],
  )
  const isIndexOfCurrent = current?.path === pathname

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/')
  }, [signOut, navigate])

  // Global ⌘K / Ctrl+K, and "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return }
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setPaletteOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close the mobile drawer on navigation, and move focus to <main> so screen-reader / keyboard users land on the new page.
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, setDrawerOpen])

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const canTools = basePath === '/worker' || basePath === '/admin'
    const pages: PaletteItem[] = allItems.map((i) => ({ id: `nav-${i.path}`, label: i.label, group: 'Go to', hint: i.description?.split('.')[0], icon: i.icon, keywords: [i.path], run: () => navigate(i.path) }))
    const tools: PaletteItem[] = canTools
      ? TOOLS.map((t) => ({ id: `tool-${t.id}`, label: t.name, group: 'Dev tools', hint: t.category, icon: t.icon, keywords: t.keywords, run: () => navigate(`${basePath}/tools/${t.id}`) }))
      : []
    const actions: PaletteItem[] = [
      { id: 'act-settings', label: 'Account settings', group: 'Actions', icon: Settings, run: () => navigate(settingsPath) },
      { id: 'act-signout', label: 'Sign out', group: 'Actions', icon: LogOut, run: () => void handleSignOut() },
    ]
    return [...pages, ...tools, ...actions]
  }, [allItems, basePath, navigate, settingsPath, handleSignOut])

  const notificationsPath = allItems.find((i) => i.label === 'Notifications')?.path

  return (
    <div className="ctf-workspace">
      <a className="ctf-skip" href="#ctf-main">Skip to content</a>

      <aside className={`ctf-sidebar ${drawerOpen ? 'is-open' : ''}`} aria-label="Sidebar">
        <div className="ctf-sidebar__head">
          <Brand tagline={false} />
          <button className="ctf-sidebar__close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={18} /></button>
        </div>
        <nav className="ctf-sidebar__nav" aria-label="Workspace navigation">
          {visibleNavGroups.map((group, gi) => (
            <div key={gi} className="ctf-sidebar__group">
              {group.label && <span className="ctf-sidebar__label">{group.label}</span>}
              {group.items.map(({ label, path, icon: Icon }) => {
                const active = current?.path === path
                return (
                  <Link key={path} to={path} aria-current={active ? 'page' : undefined} className={`ctf-sidebar__link ${active ? 'is-active' : ''}`}>
                    <Icon size={16} />
                    <span>{label}</span>
                    {label === 'Notifications' && unread > 0 && <span className="ctf-sidebar__count">{unread > 99 ? '99+' : unread}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        {profile && (
          <div className="ctf-sidebar__user">
            <Avatar name={profile.display_name || 'U'} size={32} />
            <div className="ctf-sidebar__who">
              <strong>{profile.display_name || 'Account'}</strong>
              <span>{profile.role === 'superadmin' ? 'Admin' : profile.role}</span>
            </div>
            <Link to={settingsPath} className="ctf-icon-btn" aria-label="Account settings" title="Settings"><Settings size={15} /></Link>
            <button className="ctf-icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void handleSignOut()}><LogOut size={15} /></button>
          </div>
        )}
      </aside>

      {drawerOpen && <div className="ctf-sidebar-overlay" onClick={() => setDrawerOpen(false)} />}

      <div className="ctf-workspace__main">
        <header className="ctf-topbar">
          <button className="ctf-topbar__menu ctf-icon-btn" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Menu size={19} /></button>
          <nav className="ctf-crumbs" aria-label="Breadcrumb">
            <span>{profile?.role === 'superadmin' ? 'Admin' : profile?.role ? profile.role[0].toUpperCase() + profile.role.slice(1) : 'Workspace'}</span>
            <ChevronRight size={13} aria-hidden="true" />
            {isIndexOfCurrent || !current ? <strong>{current?.label ?? 'Overview'}</strong> : (<><Link to={current.path}>{current.label}</Link><ChevronRight size={13} aria-hidden="true" /><strong>Details</strong></>)}
          </nav>
          <button className="ctf-search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search pages, tools and actions">
            <Search size={15} />
            <span>Search or jump to…</span>
            <span className="kbd">{isMac ? '⌘' : 'Ctrl'}</span><span className="kbd">K</span>
          </button>
          <button className="ctf-icon-btn ctf-topbar__search-mobile" aria-label="Search" onClick={() => setPaletteOpen(true)}><Search size={17} /></button>
          {notificationsPath ? (
            <Link to={notificationsPath} className="ctf-icon-btn ctf-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Bell size={17} />
              {unread > 0 && <span className="ctf-bell__dot" aria-hidden="true" />}
            </Link>
          ) : (
            <span className="ctf-icon-btn" aria-hidden="true"><Bell size={17} /></span>
          )}
        </header>

        <main id="ctf-main" ref={mainRef} tabIndex={-1} className="ctf-workspace__content">
          {isIndexOfCurrent && current && (
            <div className="ctf-workspace__title">
              <h1>{current.label}</h1>
              {current.description && <p>{current.description}</p>}
            </div>
          )}
          {/* Keyed by pathname: a crash on one page clears as soon as you navigate away from it. */}
          <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
    </div>
  )
}
