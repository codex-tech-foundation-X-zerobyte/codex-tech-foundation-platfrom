import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { ArrowRight, Boxes, CheckCircle2, Cpu, FolderKanban, Layers, MessageSquare, Terminal, Workflow } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ButtonLink, SectionHeading } from '../../components/ui'
import { useReveal } from '../../hooks/useReveal'
import { TOOLS } from '../tools/toolsMeta'
import './Landing.css'

const POSITIONING = ['Product Engineering', 'SaaS', 'Business Systems', 'Automation', 'AI', 'Developer Platforms', 'APIs', 'Internal Tools']

const CAPABILITIES = [
  { n: '01', icon: Layers, title: 'Digital Products', body: 'Web platforms, customer-facing products, internal systems, and custom applications built to be maintained for years, not months.' },
  { n: '02', icon: Workflow, title: 'Business Systems', body: 'Operations, workflow, inventory, CRM, and management platforms that replace spreadsheets with something the whole team can trust.' },
  { n: '03', icon: Boxes, title: 'Developer Infrastructure', body: 'APIs, developer portals, internal tooling, automation, and the technical platforms other teams build on top of.' },
  { n: '04', icon: Cpu, title: 'Intelligent Systems', body: 'AI-assisted workflows, automation, agents, and intelligent interfaces layered onto real operational data.' },
]

const PROCESS = [
  ['Discover', 'Understand the real problem'],
  ['Define', 'Agree scope and success'],
  ['Design', 'Shape the system and UX'],
  ['Build', 'Ship in small, real steps'],
  ['Validate', 'Test against reality'],
  ['Launch', 'Go live, safely'],
  ['Improve', 'Measure and evolve'],
]

const PRINCIPLES = [
  ['Engineering-first', 'Every decision is judged by whether it holds up in production, not just in a demo.'],
  ['Clarity over complexity', 'The simplest system that solves the real problem beats the impressive one that doesn’t.'],
  ['Built for real operations', 'We design around how the work actually happens, not an idealised version of it.'],
  ['Security by default', 'Access control and data boundaries are part of the architecture, not a later pass.'],
  ['Designed to evolve', 'Systems are built to be extended by someone other than us, a year from now.'],
]

export function Landing() {
  return (
    <PublicLayout>
      <Hero />
      <Marquee />

      <section className="container ctf-section">
        <Reveal><SectionHeading eyebrow="What we build" title="Software for work that matters." /></Reveal>
        <div className="ctf-capability-grid">
          {CAPABILITIES.map((c, i) => <Capability key={c.n} {...c} delay={i * 90} />)}
        </div>
      </section>

      <section className="container ctf-section">
        <Reveal><SectionHeading eyebrow="Process" title="A disciplined path from problem to production." /></Reveal>
        <Process />
      </section>

      <Platform />

      <section className="container ctf-section">
        <Reveal><SectionHeading eyebrow="Why Codex" title="What we optimise for." /></Reveal>
        <div className="ctf-principles">
          {PRINCIPLES.map(([title, body], i) => (
            <Reveal key={title} delay={i * 70} className="ctf-principle">
              <h3>{title}</h3>
              <p>{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="container ctf-final-cta">
        <Reveal className="ctf-cta-card">
          <span className="eyebrow">Get in touch</span>
          <h2>Have a hard problem?<br />Let’s build the system behind it.</h2>
          <div className="ctf-hero__cta">
            <ButtonLink to="/start-project" variant="primary" size="lg" icon={<ArrowRight size={16} />}>Start a project</ButtonLink>
            <ButtonLink to="/contact" variant="secondary" size="lg">Talk to Codex</ButtonLink>
          </div>
        </Reveal>
      </section>
    </PublicLayout>
  )
}

/** Fades and lifts its children in the first time they scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`ctf-reveal ${visible ? 'is-visible' : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}

function Hero() {
  return (
    <section className="ctf-hero">
      <div className="ctf-hero__bg" aria-hidden="true">
        <span className="ctf-hero__gridlines" />
        <span className="ctf-hero__orb ctf-hero__orb--a" />
        <span className="ctf-hero__orb ctf-hero__orb--b" />
      </div>
      <div className="container ctf-hero__grid">
        <div className="ctf-hero__copy">
          <span className="ctf-hero__badge"><i aria-hidden="true" /> Engineering, applied</span>
          <h1>
            We build the systems <em>behind ambitious ideas.</em>
          </h1>
          <p className="lead">
            Codex Tech Foundation designs and builds digital products, business systems, developer tools, and intelligent
            platforms that turn complex operations into reliable software.
          </p>
          <div className="ctf-hero__cta">
            <ButtonLink to="/start-project" variant="primary" size="lg" icon={<ArrowRight size={16} />}>Start a project</ButtonLink>
            <ButtonLink to="/projects" variant="secondary" size="lg">Explore our work</ButtonLink>
          </div>
        </div>
        <HeroTerminal />
      </div>
    </section>
  )
}

type Line = { kind: 'cmd' | 'dim' | 'ok' | 'link'; text: string; meta?: string }

const SCRIPT: Line[] = [
  { kind: 'cmd', text: 'codex new client-portal --stack react,postgres' },
  { kind: 'dim', text: 'Scaffolding project structure…' },
  { kind: 'ok', text: 'Database schema migrated', meta: '14 tables' },
  { kind: 'ok', text: 'Row-level security verified', meta: 'every table' },
  { kind: 'ok', text: 'Type check', meta: '0 errors' },
  { kind: 'ok', text: 'Tests', meta: '148 / 148 passed' },
  { kind: 'cmd', text: 'codex deploy --prod' },
  { kind: 'ok', text: 'Built and shipped', meta: '1.4s' },
  { kind: 'link', text: 'https://client-portal.example.com' },
]

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * An illustrative build pipeline that types itself out on a loop. It is labelled as an illustration, and with
 * prefers-reduced-motion it renders fully formed and never animates.
 */
function HeroTerminal() {
  const [reduced] = useState(prefersReducedMotion)
  const [step, setStep] = useState(reduced ? SCRIPT.length : 0)
  const [chars, setChars] = useState(0)

  useEffect(() => {
    if (reduced) return
    let timer: ReturnType<typeof setTimeout>
    if (step >= SCRIPT.length) {
      timer = setTimeout(() => { setStep(0); setChars(0) }, 4800) // hold the finished result, then replay
    } else {
      const line = SCRIPT[step]
      if (line.kind === 'cmd' && chars < line.text.length) timer = setTimeout(() => setChars((c) => c + 1), 26)
      else timer = setTimeout(() => { setStep((s) => s + 1); setChars(0) }, line.kind === 'cmd' ? 380 : 430)
    }
    return () => clearTimeout(timer)
  }, [step, chars, reduced])

  const shown = SCRIPT.slice(0, step)
  const typing = step < SCRIPT.length && SCRIPT[step].kind === 'cmd' ? SCRIPT[step].text.slice(0, chars) : null

  return (
    <div className="ctf-term" role="img" aria-label="Illustration of a project being scaffolded, verified and deployed from the command line">
      <div className="ctf-term__bar">
        <span className="ctf-term__dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="ctf-term__title mono">codex — illustrative pipeline</span>
      </div>
      <div className="ctf-term__body mono" aria-hidden="true">
        {shown.map((l, i) => <TermLine key={i} line={l} />)}
        {typing !== null && <div className="ctf-term__row"><span className="ctf-term__prompt">$</span><span>{typing}</span><span className="ctf-term__caret" /></div>}
        {typing === null && step >= SCRIPT.length && <div className="ctf-term__row"><span className="ctf-term__prompt">$</span><span className="ctf-term__caret" /></div>}
      </div>
    </div>
  )
}

function TermLine({ line }: { line: Line }) {
  if (line.kind === 'cmd') return <div className="ctf-term__row"><span className="ctf-term__prompt">$</span><span>{line.text}</span></div>
  if (line.kind === 'ok') return <div className="ctf-term__row ctf-term__row--in"><span className="ctf-term__ok">✓</span><span>{line.text}</span>{line.meta && <span className="ctf-term__meta">{line.meta}</span>}</div>
  if (line.kind === 'link') return <div className="ctf-term__row ctf-term__row--in"><span className="ctf-term__arrow">→</span><span className="ctf-term__link">{line.text}</span></div>
  return <div className="ctf-term__row ctf-term__row--in ctf-term__dim"><span /> <span>{line.text}</span></div>
}

function Marquee() {
  // The list is doubled so the track can translate by exactly 50% and loop seamlessly. The copy is hidden from screen readers.
  return (
    <section className="ctf-marquee" aria-label="Areas of focus">
      <div className="ctf-marquee__track">
        {[...POSITIONING, ...POSITIONING].map((item, i) => (
          <span key={i} aria-hidden={i >= POSITIONING.length}>{item}</span>
        ))}
      </div>
    </section>
  )
}

function Capability({ n, icon: Icon, title, body, delay }: (typeof CAPABILITIES)[number] & { delay: number }) {
  // Cursor-following spotlight: pure CSS variables, no per-frame React renders.
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <Reveal delay={delay}>
      <div className="ctf-capability" onMouseMove={onMove}>
        <div className="ctf-capability__head">
          <span className="ctf-capability__n mono">{n}</span>
          <Icon size={20} />
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </Reveal>
  )
}

function Process() {
  const { ref, visible } = useReveal<HTMLOListElement>(0.3)
  return (
    <ol ref={ref} className={`ctf-process ${visible ? 'is-visible' : ''}`}>
      <span className="ctf-process__line" aria-hidden="true" />
      {PROCESS.map(([step, note], i) => (
        <li key={step} style={{ '--i': i } as CSSProperties}>
          <span className="ctf-process__dot" aria-hidden="true" />
          <span className="ctf-process__n mono">{String(i + 1).padStart(2, '0')}</span>
          <strong>{step}</strong>
          <small>{note}</small>
        </li>
      ))}
    </ol>
  )
}

function Platform() {
  return (
    <section className="ctf-platform">
      <div className="container">
        <Reveal><SectionHeading eyebrow="The platform" title="Delivery you can actually see." description="Clients and our team work in the same secure workspace: real progress, real files, real conversations — no status-update emails." /></Reveal>
        <div className="ctf-platform__grid">
          <Reveal delay={0}>
            <article className="ctf-tile">
              <header><FolderKanban size={16} /> <strong>Client portal</strong></header>
              <p>Follow milestones, read updates, download deliverables, and raise requests or report issues — all in one place.</p>
              <div className="ctf-tile__viz" aria-hidden="true">
                {[['Discovery', 100], ['Build', 68], ['Launch', 12]].map(([l, v]) => (
                  <div key={l} className="ctf-bar"><span>{l}</span><i><b style={{ '--w': `${v}%` } as CSSProperties} /></i><em className="mono">{v}%</em></div>
                ))}
              </div>
            </article>
          </Reveal>
          <Reveal delay={90}>
            <article className="ctf-tile">
              <header><MessageSquare size={16} /> <strong>Team workspace</strong></header>
              <p>Task boards, project channels, and voice and video calls for the people doing the work.</p>
              <div className="ctf-tile__viz ctf-chatviz" aria-hidden="true">
                <span className="ctf-chatviz__in">Migration is green on staging.</span>
                <span className="ctf-chatviz__out">Great — shipping after standup.</span>
                <span className="ctf-chatviz__in">On a call in 2 min?</span>
              </div>
            </article>
          </Reveal>
          <Reveal delay={180}>
            <article className="ctf-tile">
              <header><Terminal size={16} /> <strong>Built-in dev tools</strong></header>
              <p>{TOOLS.length} everyday tools that run entirely in your browser — nothing you paste is ever uploaded.</p>
              <div className="ctf-tile__viz ctf-chips" aria-hidden="true">
                {TOOLS.slice(0, 8).map((t) => <span key={t.id} className="mono">{t.name.split(' ')[0]}</span>)}
                <span className="mono">+{TOOLS.length - 8} more</span>
              </div>
            </article>
          </Reveal>
        </div>
        <Reveal delay={120} className="ctf-platform__foot">
          <span><CheckCircle2 size={14} /> Role-based access on every record</span>
          <span><CheckCircle2 size={14} /> Sign-ins and sensitive actions are logged</span>
          <ButtonLink to="/login" variant="ghost" size="sm" icon={<ArrowRight size={14} />}>Client and team sign in</ButtonLink>
        </Reveal>
      </div>
    </section>
  )
}
