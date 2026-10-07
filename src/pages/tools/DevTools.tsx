import { lazy, Suspense, useMemo, useState, type ComponentType } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { EmptyState, SearchInput, SkeletonRows } from '../../components/ui'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { TOOLS, findTool, type ToolCategory } from './toolsMeta'
import './DevTools.css'

// Each tool is its own chunk: nobody pays for the regex tester until they open it.
const LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  json: () => import('./tools/JsonTool'),
  base64: () => import('./tools/Base64Tool'),
  url: () => import('./tools/UrlTool'),
  jwt: () => import('./tools/JwtTool'),
  hash: () => import('./tools/HashTool'),
  uuid: () => import('./tools/UuidTool'),
  regex: () => import('./tools/RegexTool'),
  time: () => import('./tools/TimeTool'),
  color: () => import('./tools/ColorTool'),
  password: () => import('./tools/PasswordTool'),
  diff: () => import('./tools/DiffTool'),
  cron: () => import('./tools/CronTool'),
  http: () => import('./tools/HttpTool'),
  api: () => import('./tools/ApiTool'),
}
const LAZY = Object.fromEntries(Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)])) as Record<string, ComponentType>

const CATEGORY_ORDER: ToolCategory[] = ['Data', 'Text', 'Encoding', 'Security', 'Time', 'Web']

export function DevTools() {
  const { toolId } = useParams()
  const location = useLocation()
  const base = location.pathname.split('/tools')[0] + '/tools'
  const tool = findTool(toolId)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TOOLS.filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.keywords.some((k) => k.includes(q)))
  }, [query])

  if (toolId && !tool) {
    return <EmptyState title="That tool doesn't exist" description="It may have been renamed. Pick one from the tools list." action={<Link className="ctf-btn ctf-btn--secondary ctf-btn--sm" to={base}><span className="ctf-btn__content">All tools</span></Link>} />
  }

  if (tool) {
    const ToolBody = LAZY[tool.id]
    const Icon = tool.icon
    return (
      <div className="ctf-tool">
        <Link to={base} className="ctf-tool__back"><ArrowLeft size={14} /> All tools</Link>
        <div className="ctf-tool__head">
          <span className="ctf-tool__icon"><Icon size={20} /></span>
          <div>
            <h2>{tool.name}</h2>
            <p>{tool.description}</p>
          </div>
        </div>
        <nav className="ctf-tool__chips" aria-label="Switch tool">
          {TOOLS.map((t) => (
            <Link key={t.id} to={`${base}/${t.id}`} className={t.id === tool.id ? 'is-active' : ''} aria-current={t.id === tool.id ? 'page' : undefined}>{t.name}</Link>
          ))}
        </nav>
        <div className="ctf-tool__privacy">Runs entirely in your browser — nothing you enter here is uploaded or stored.</div>
        <ErrorBoundary resetKey={tool.id}>
          <Suspense fallback={<SkeletonRows rows={3} height="120px" />}><ToolBody key={tool.id} /></Suspense>
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <div className="ctf-tools">
      <SearchInput value={query} onChange={setQuery} placeholder="Filter tools…" style={{ maxWidth: 360 }} />
      {filtered.length === 0 && <p className="ctf-muted">No tools match “{query}”.</p>}
      {CATEGORY_ORDER.map((cat) => {
        const items = filtered.filter((t) => t.category === cat)
        if (items.length === 0) return null
        return (
          <section key={cat} aria-label={cat}>
            <h2 className="ctf-tools__cat">{cat}</h2>
            <div className="ctf-tools__grid">
              {items.map((t) => {
                const Icon = t.icon
                return (
                  <Link key={t.id} to={`${base}/${t.id}`} className="ctf-tools__card">
                    <span className="ctf-tools__icon"><Icon size={18} /></span>
                    <strong>{t.name}</strong>
                    <p>{t.description}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
