import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Button } from '../components/ui'
import './PublicLayout.css'

const NAV = [
  ['/what-we-build', 'What We Build'],
  ['/projects', 'Projects'],
  ['/case-studies', 'Case Studies'],
  ['/about', 'About'],
  ['/team', 'Team'],
  ['/blog', 'Blog'],
  ['/careers', 'Careers'],
] as const

export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="ctf-public">
      <header className="ctf-public-nav">
        <div className="container ctf-public-nav__row">
          <Brand />
          <nav className="ctf-public-nav__links" aria-label="Primary">
            {NAV.map(([path, label]) => (
              <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'is-active' : '')}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ctf-public-nav__actions">
            <Link to="/contact" className="text-link">Contact</Link>
            <Button variant="primary" size="sm" icon={<ArrowRight size={14} />} onClick={() => (window.location.href = '/start-project')}>
              Start a project
            </Button>
          </div>
          <button className="ctf-public-nav__toggle" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
        </div>
      </header>

      {open && (
        <div className="ctf-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="ctf-drawer" role="dialog" aria-modal="true" aria-label="Site menu">
            <div className="ctf-drawer__head">
              <Brand tagline={false} />
              <button aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <nav className="ctf-drawer__links">
              {[...NAV, ['/blog', 'Blog'], ['/contact', 'Contact']].map(([path, label]) => (
                <Link key={path + label} to={path} onClick={() => setOpen(false)}>{label}</Link>
              ))}
            </nav>
            <Link to="/start-project" onClick={() => setOpen(false)}>
              <Button variant="primary" size="lg" icon={<ArrowRight size={16} />} className="ctf-drawer__cta">Start a project</Button>
            </Link>
            <Link to="/login" onClick={() => setOpen(false)} className="text-link ctf-drawer__login">Worker / client sign in</Link>
          </div>
        </div>
      )}

      <main>{children}</main>

      <footer className="ctf-footer">
        <div className="container ctf-footer__grid">
          <div className="ctf-footer__brand">
            <Brand tagline={false} />
            <p>We design and build the digital products, business systems, and platforms behind ambitious organisations.</p>
          </div>
          <FooterColumn title="Company" links={[['/about', 'About'], ['/team', 'Team'], ['/careers', 'Careers']]} />
          <FooterColumn title="Work" links={[['/projects', 'Projects'], ['/case-studies', 'Case Studies']]} />
          <FooterColumn title="Insights" links={[['/blog', 'Blog']]} />
          <FooterColumn title="Contact" links={[['/contact', 'Contact'], ['/start-project', 'Start a project']]} />
          <FooterColumn title="Platform" links={[['/login', 'Worker login'], ['/login', 'Client portal']]} />
          <FooterColumn title="Legal" links={[['/privacy', 'Privacy'], ['/terms', 'Terms']]} />
        </div>
        <div className="container ctf-footer__bottom">
          <span>© {new Date().getFullYear()} Codex Tech Foundation. All rights reserved.</span>
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
