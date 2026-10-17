import { Link } from 'react-router'
import { ArrowRight, CalendarDays, FileText, FolderKanban, LockKeyhole, MessageSquare, MapPin, Bell, Briefcase } from 'lucide-react'
import { Avatar, ButtonLink, SectionHeading } from '../../components/ui'
import { Reveal } from '../../components/Reveal'
import { getTeamPhotoUrl } from '../../lib/services'
import type { BlogPost, Career, CaseStudy, TeamProfile } from '../../lib/types'

/**
 * Everything here is either real content the team published (and the section disappears while there is none — an empty
 * "Latest posts" heading over nothing would be worse than no section) or plain description of what the platform does.
 * No invented numbers, logos or testimonials.
 */

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

const WORKING_WITH_US = [
  { icon: FolderKanban, title: 'A portal for your project', body: 'Every client gets their own sign-in to see milestones, progress and what is coming next — no chasing for status.' },
  { icon: FileText, title: 'Updates you can read', body: 'Written progress updates are published to the portal as work lands, so the record builds up as we go.' },
  { icon: MessageSquare, title: 'Raise things any time', body: 'Send a request, report an issue or ask a question from inside the project, and it reaches the people doing the work.' },
  { icon: Bell, title: 'Told when it matters', body: 'Turn on notifications and you hear about new updates even when the app is closed.' },
  { icon: LockKeyhole, title: 'Access you can trust', body: 'You only ever see your own project. Permissions are enforced on every record, and sign-ins are logged.' },
  { icon: CalendarDays, title: 'Clear milestones', body: 'Work is broken into milestones with dates, so “where are we?” always has a straight answer.' },
]

export function WorkingWithUs() {
  return (
    <section className="container ctf-section">
      <Reveal><SectionHeading eyebrow="Working with us" title="What the engagement actually looks like." description="You do not have to take our word for progress. This is what you get to see." /></Reveal>
      <div className="ctf-wwu">
        {WORKING_WITH_US.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 60} className="ctf-wwu__item">
            <Icon size={20} aria-hidden />
            <h3>{title}</h3>
            <p>{body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

export function FeaturedWork({ items }: { items: CaseStudy[] }) {
  if (items.length === 0) return null
  return (
    <section className="container ctf-section">
      <Reveal><SectionHeading eyebrow="Selected work" title="Problems we have taken on." /></Reveal>
      <div className="ctf-cards">
        {items.slice(0, 3).map((c, i) => (
          <Reveal key={c.id} delay={i * 80} className="ctf-card-wrap">
            <Link to={`/case-studies/${c.slug}`} className="ctf-card">
              <h3>{c.title}</h3>
              <p>{clip(c.summary, 160)}</p>
              {c.technologies.length > 0 && <div className="ctf-card__tags">{c.technologies.slice(0, 4).map((t) => <span key={t}>{t}</span>)}</div>}
              <span className="ctf-card__more">Read the case study <ArrowRight size={14} aria-hidden /></span>
            </Link>
          </Reveal>
        ))}
      </div>
      {items.length > 3 && <div className="ctf-section__more"><ButtonLink to="/case-studies" variant="ghost" icon={<ArrowRight size={14} />}>All case studies</ButtonLink></div>}
    </section>
  )
}

export function LatestPosts({ items }: { items: BlogPost[] }) {
  if (items.length === 0) return null
  return (
    <section className="container ctf-section">
      <Reveal><SectionHeading eyebrow="From the blog" title="Notes from the work." /></Reveal>
      <div className="ctf-cards">
        {items.slice(0, 3).map((p, i) => (
          <Reveal key={p.id} delay={i * 80} className="ctf-card-wrap">
            <Link to={`/blog/${p.slug}`} className="ctf-card">
              <time dateTime={p.published_at ?? undefined}>{day(p.published_at)}</time>
              <h3>{p.title}</h3>
              <p>{clip(p.excerpt, 150)}</p>
              <span className="ctf-card__more">Read the post <ArrowRight size={14} aria-hidden /></span>
            </Link>
          </Reveal>
        ))}
      </div>
      <div className="ctf-section__more"><ButtonLink to="/blog" variant="ghost" icon={<ArrowRight size={14} />}>All posts</ButtonLink></div>
    </section>
  )
}

export function MeetTheTeam({ team }: { team: TeamProfile[] }) {
  if (team.length === 0) return null
  return (
    <section className="container ctf-section">
      <Reveal><SectionHeading eyebrow="The team" title="The people behind the work." /></Reveal>
      <div className="ctf-people">
        {team.slice(0, 4).map((m, i) => {
          const photo = getTeamPhotoUrl(m.photo_path)
          return (
            <Reveal key={m.id} delay={i * 70} className="ctf-person">
              {photo ? <img src={photo} alt="" className="ctf-person__photo" loading="lazy" /> : <Avatar name={m.display_name} size={56} />}
              <h3>{m.display_name}</h3>
              <span>{m.public_title}</span>
              {m.bio && <p>{m.bio}</p>}
            </Reveal>
          )
        })}
      </div>
      <div className="ctf-section__more"><ButtonLink to="/team" variant="ghost" icon={<ArrowRight size={14} />}>{team.length > 4 ? 'Meet the whole team' : 'More about the team'}</ButtonLink></div>
    </section>
  )
}

export function OpenRoles({ roles }: { roles: Career[] }) {
  if (roles.length === 0) return null
  return (
    <section className="container ctf-section">
      <Reveal><SectionHeading eyebrow="Careers" title="Come build with us." description="We are hiring for the roles below." /></Reveal>
      <ul className="ctf-roles">
        {roles.slice(0, 4).map((r) => (
          <li key={r.id}>
            <Link to={`/careers/${r.slug}`}>
              <div>
                <strong>{r.title}</strong>
                <span>
                  <Briefcase size={12} aria-hidden /> {[r.team, r.employment_type].filter(Boolean).join(' · ')}
                  {r.location && <><MapPin size={12} aria-hidden /> {r.location}</>}
                </span>
              </div>
              <ArrowRight size={16} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {roles.length > 4 && <div className="ctf-section__more"><ButtonLink to="/careers" variant="ghost" icon={<ArrowRight size={14} />}>All open roles</ButtonLink></div>}
    </section>
  )
}

const FAQ: Array<[string, string]> = [
  ['How does a project start?', 'With a conversation. Tell us what you are trying to do through the start-a-project form, and we will come back to talk through the problem before anything is scoped or priced.'],
  ['How long will it take, and what will it cost?', 'It depends entirely on the problem, so we do not quote from a menu. Scope, timeline and cost are agreed together in the Define step, before build work begins.'],
  ['How will I know how the work is going?', 'You get a sign-in to the client portal, where milestones, written updates and files are kept. You can raise requests or report issues there too.'],
  ['Who owns what gets built?', 'Ownership, licensing and handover terms are agreed in writing before work begins, so there are no surprises at the end.'],
  ['Is my data safe on the portal?', 'Each client can only see their own project. Access is enforced at the database level on every record, and sign-ins and sensitive actions are logged.'],
  ['Do you work with early-stage ideas, or only established teams?', 'Either. What matters is that there is a real problem to solve. If it is not clear yet, the Discover step exists to make it clear.'],
]

export function Faq() {
  return (
    <section className="container ctf-section ctf-faq">
      <Reveal><SectionHeading eyebrow="Questions" title="Things people usually ask." /></Reveal>
      <Reveal className="ctf-faq__list">
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </Reveal>
      <p className="ctf-faq__foot">Something else? <Link to="/contact">Send us a message</Link>.</p>
    </section>
  )
}
