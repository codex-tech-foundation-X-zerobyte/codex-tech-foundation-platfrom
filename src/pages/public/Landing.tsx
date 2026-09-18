import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Cpu, Layers, Workflow } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Button, SectionHeading, Surface } from '../../components/ui'
import './Landing.css'

const POSITIONING = ['Product Engineering', 'SaaS', 'Business Systems', 'Automation', 'AI', 'Developer Platforms']

const CAPABILITIES = [
  {
    n: '01',
    icon: Layers,
    title: 'Digital Products',
    body: 'Web platforms, customer-facing products, internal systems, and custom applications built to be maintained for years, not months.',
  },
  {
    n: '02',
    icon: Workflow,
    title: 'Business Systems',
    body: 'Operations, workflow, inventory, CRM, and management platforms that replace spreadsheets with something the whole team can trust.',
  },
  {
    n: '03',
    icon: Boxes,
    title: 'Developer Infrastructure',
    body: 'APIs, developer portals, internal tooling, automation, and the technical platforms other teams build on top of.',
  },
  {
    n: '04',
    icon: Cpu,
    title: 'Intelligent Systems',
    body: 'AI-assisted workflows, automation, agents, and intelligent interfaces layered onto real operational data.',
  },
]

const PROCESS = ['Discover', 'Define', 'Design', 'Build', 'Validate', 'Launch', 'Improve']

const PRINCIPLES = [
  ['Engineering-first', 'Every decision is judged by whether it holds up in production, not just in a demo.'],
  ['Clarity over complexity', 'The simplest system that solves the real problem beats the impressive one that doesn\u2019t.'],
  ['Built for real operations', 'We design around how the work actually happens, not an idealised version of it.'],
  ['Security by default', 'Access control and data boundaries are part of the architecture, not a later pass.'],
  ['Designed to evolve', 'Systems are built to be extended by someone other than us, a year from now.'],
]

export function Landing() {
  return (
    <PublicLayout>
      <section className="ctf-hero">
        <div className="container ctf-hero__grid">
          <div className="ctf-hero__copy">
            <span className="eyebrow">Codex Tech Foundation</span>
            <h1>
              We build the systems <em>behind ambitious ideas.</em>
            </h1>
            <p className="lead">
              Codex Tech Foundation designs and builds digital products, business systems, developer tools, and
              intelligent platforms that turn complex operations into reliable software.
            </p>
            <div className="ctf-hero__cta">
              <Link to="/start-project">
                <Button variant="primary" size="lg" icon={<ArrowRight size={16} />}>Start a project</Button>
              </Link>
              <Link to="/projects">
                <Button variant="secondary" size="lg">Explore our work</Button>
              </Link>
            </div>
          </div>
          <SystemVisual />
        </div>
      </section>

      <section className="ctf-strip">
        <div className="container ctf-strip__row">
          {POSITIONING.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="container ctf-section">
        <SectionHeading eyebrow="What we build" title="Software for work that matters." />
        <div className="ctf-capability-grid">
          {CAPABILITIES.map(({ n, icon: Icon, title, body }) => (
            <div className="ctf-capability" key={n}>
              <div className="ctf-capability__head">
                <span className="ctf-capability__n">{n}</span>
                <Icon size={20} />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container ctf-section">
        <SectionHeading eyebrow="Process" title="A disciplined path from problem to production." />
        <ol className="ctf-process">
          {PROCESS.map((step, i) => (
            <li key={step}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="container ctf-section">
        <SectionHeading eyebrow="Why Codex" title="What we optimise for." />
        <div className="ctf-principles">
          {PRINCIPLES.map(([title, body]) => (
            <div className="ctf-principle" key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container ctf-final-cta">
        <Surface variant="featured" padding="lg">
          <span className="eyebrow">Get in touch</span>
          <h2>Have a hard problem? <br />Let&rsquo;s build the system behind it.</h2>
          <div className="ctf-hero__cta">
            <Link to="/start-project">
              <Button variant="primary" size="lg" icon={<ArrowRight size={16} />}>Start a project</Button>
            </Link>
            <Link to="/contact">
              <Button variant="secondary" size="lg">Talk to Codex</Button>
            </Link>
          </div>
        </Surface>
      </section>
    </PublicLayout>
  )
}

/** Abstract layered systems diagram: Idea → Product → Infrastructure → Users → Operations. */
function SystemVisual() {
  const layers = ['Idea', 'Product', 'Infrastructure', 'Users', 'Operations']
  return (
    <svg className="ctf-hero__visual" viewBox="0 0 460 420" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ctf-hero-line" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7b5cff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#4a63ff" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {layers.map((label, i) => {
        const y = 30 + i * 82
        return (
          <g key={label} className="ctf-hero__node" style={{ animationDelay: `${i * 120}ms` }}>
            <rect x="90" y={y} width="280" height="46" rx="10" fill="#0f141d" stroke="rgba(148,163,184,0.22)" />
            <circle cx="112" cy={y + 23} r="4" fill={i === 2 ? '#7b5cff' : '#4a63ff'} />
            <text x="130" y={y + 28} fill="#d7dee8" fontSize="13" fontFamily="Inter, sans-serif">{label}</text>
            {i < layers.length - 1 && <line x1="230" y1={y + 46} x2="230" y2={y + 82} stroke="url(#ctf-hero-line)" strokeWidth="2" />}
          </g>
        )
      })}
    </svg>
  )
}
