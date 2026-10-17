import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { ButtonLink } from '../components/ui'
import './PublicLayout.css'

const NAV = [
  ['/what-we-build', 'What we build'],
  ['/projects', 'Projects'],
  ['/case-studies', 'Case studies'],
  ['/about', 'About'],
  ['/team', 'Team'],
  ['/blog', 'Blog'],
  ['/careers', 'Careers'],
] as const

export function PublicLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  // The menu is 'open for a path': navigating anywhere changes the path, which closes it — no effect needed.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === location.pathname
  const setOpen = (value: boolean) => setOpenAt(value ? location.pathname : null)
  const [scrolled, setScrolled] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Elevate the bar once the page moves under it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // New page => start at the top. (Without this, following a link from the bottom of one page landed you at the bottom of the next.)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  // Drawer: Escape closes, page can't scroll behind it, focus moves in and returns to the button that opened it.
  useEffect(() => {
    if (!open) return
    const toggle = toggleRef.current
    document.body.style.overflow = 'hidden'
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenAt(null)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
      toggle?.focus()
    }
  }, [open])

  return (
    <div className="ctf-public">
      <a className="ctf-skip" href="#ctf-public-main">Skip to content</a>
      <header className={`ctf-public-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="container ctf-public-nav__row">
          <Brand />
          <nav className="ctf-public-nav__links" aria-label="Primary">
            {NAV.map(([path, label]) => (
              <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'is-active' : '')}>{label}</NavLink>
            ))}
          </nav>
          <div className="ctf-public-nav__actions">
            <Link to="/login" className="ctf-public-nav__login">Sign in</Link>
            <ButtonLink to="/start-project" variant="primary" size="sm" icon={<ArrowRight size={14} />}>Start a project</ButtonLink>
          </div>
          <button ref={toggleRef} className="ctf-public-nav__toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
        </div>
      </header>

      {open && (
        <div className="ctf-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="ctf-drawer" role="dialog" aria-modal="true" aria-label="Site menu" ref={drawerRef}>
            <div className="ctf-drawer__head">
              <Brand tagline={false} />
              <button aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <nav className="ctf-drawer__links" aria-label="Mobile">
              {[...NAV, ['/contact', 'Contact'] as const].map(([path, label]) => (
                <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'is-active' : '')}>{label}</NavLink>
              ))}
            </nav>
            <ButtonLink to="/start-project" variant="primary" size="lg" icon={<ArrowRight size={16} />} className="ctf-drawer__cta">Start a project</ButtonLink>
            <Link to="/login" className="text-link ctf-drawer__login">Worker / client sign in</Link>
          </div>
        </div>
      )}

      <main id="ctf-public-main" tabIndex={-1}>{children}</main>

      <footer className="ctf-footer">
        <div className="container ctf-footer__grid">
          <div className="ctf-footer__brand">
            <Brand tagline={false} />
            <p>We design and build the digital products, business systems, and platforms behind ambitious organisations.</p>
          </div>
          <FooterColumn title="Company" links={[['/about', 'About'], ['/team', 'Team'], ['/careers', 'Careers']]} />
          <FooterColumn title="Work" links={[['/projects', 'Projects'], ['/case-studies', 'Case studies']]} />
          <FooterColumn title="Insights" links={[['/blog', 'Blog']]} />
          <FooterColumn title="Contact" links={[['/contact', 'Contact'], ['/start-project', 'Start a project']]} />
          <FooterColumn title="Platform" links={[['/login', 'Worker sign in'], ['/login', 'Client portal']]} />
          <FooterColumn title="Legal" links={[['/privacy', 'Privacy'], ['/terms', 'Terms']]} />
        </div>
        <div className="container ctf-footer__bottom">
          <span>© {new Date().getFullYear()} Codex Tech Foundation. All rights reserved.</span>
          <span className="ctf-footer__status"><i aria-hidden="true" /> Engineering, applied.</span>
        </div>
      </footer>
    </div>
  )
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="ctf-footer__col">
      <span>{title}</span>
      <ul>
        {links.map(([path, label], i) => (
          <li key={path + i}><Link to={path}>{label}</Link></li>
        ))}
      </ul>
    </div>
  )
}
