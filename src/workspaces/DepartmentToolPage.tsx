import { Link, Navigate } from 'react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button, EmptyState, SkeletonRows } from '../components/ui'
import { loadIntegrationState, type DepartmentRow } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { recordKindOf, toolOf, toolTarget, type DepartmentDef, type NativeTool } from './definitions'
import { RecordsPage } from './RecordViews'
import type { Viewer } from './DepartmentWork'
import { DepartmentFiles } from './tools/DepartmentFiles'
import { GithubActions, GithubPulls, GithubRepos, WebhookTester } from './tools/DeveloperTools'
import { LeadStats } from './tools/MarketingTools'
import { ConfigChecks, DnsInspector, HeaderAnalyzer, LogAnalyzer, TrainingLinks } from './tools/SecurityLabTools'
import { WhiteboardTool } from './tools/Whiteboard'
import { RecordCalendarTool } from './CalendarViews'
import './DepartmentEnvironment.css'

interface NativeCtx { row: DepartmentRow; base: '/worker' | '/admin'; viewer: Viewer }
/**
 * Every native tool, keyed by name. Typed as a full Record, so adding a name to `NativeTool` without implementing it here is a
 * compile error: a tool cannot be listed in a definition and quietly do nothing.
 */
const NATIVE: Record<NativeTool, (c: NativeCtx) => React.ReactNode> = {
  whiteboard: (c) => <WhiteboardTool row={c.row} viewer={c.viewer} />,
  webhooks: (c) => <WebhookTester row={c.row} />,
  headers: () => <HeaderAnalyzer />,
  dns: () => <DnsInspector />,
  logs: () => <LogAnalyzer />,
  'config-checks': (c) => <ConfigChecks row={c.row} />,
  training: () => <TrainingLinks />,
  'lead-stats': () => <LeadStats />,
  'record-calendar': (c) => <RecordCalendarTool row={c.row} />,
  'github-repos': (c) => <GithubRepos base={c.base} viewer={c.viewer} />,
  'github-prs': (c) => <GithubPulls base={c.base} viewer={c.viewer} />,
  'github-actions': (c) => <GithubActions base={c.base} viewer={c.viewer} />,
}

/** One department tool, on its own page. What it shows follows from the tool's definition. */
export function DepartmentToolPage({ def, row, base, toolId, viewer }: { def: DepartmentDef; row: DepartmentRow | null; base: '/worker' | '/admin'; toolId: string | undefined; viewer: Viewer }) {
  const tool = toolOf(def, toolId)
  useDocumentTitle(tool ? `${tool.name} · ${def.shortName}` : def.dashboardTitle)
  const state = useAsyncData('integration-state', loadIntegrationState)
  const home = base === '/worker' ? '/worker/department' : `/admin/departments/${def.slug}`
  const toolsTab = `${home}?section=${def.sections.find((s) => s.kind === 'tools')?.id ?? 'overview'}`

  const back = <Link to={toolsTab} className="ctf-depts__back"><ArrowLeft size={14} aria-hidden="true" /> {def.dashboardTitle}</Link>
  if (!tool) return <div className="ctf-denv__stack">{back}<EmptyState title="That tool doesn't exist" description="Pick one from the department's tools." /></div>
  if (state.loading) return <SkeletonRows rows={3} />
  const target = toolTarget(base, def, tool, state.data ?? {})

  // Tools that live elsewhere in the app: send people there.
  if ((tool.builtin || tool.kb) && target?.to) return <Navigate to={target.to} replace />
  if (!row) return <div className="ctf-denv__stack">{back}<EmptyState title="This department isn't provisioned yet" description="Apply the latest database migration to use its tools." /></div>

  let body: React.ReactNode
  if (tool.records) {
    const kind = recordKindOf(def, tool.records)
    body = kind ? <RecordsPage row={row} kind={kind} preset={tool.preset} viewer={viewer} heading={tool.name} intro={tool.description} /> : <EmptyState title="Not configured" description="This tool points at a record type that does not exist." />
  } else if (tool.files) body = <DepartmentFiles row={row} category={tool.files} heading={tool.name} viewer={viewer} />
  else if (tool.external) {
    body = target?.href
      ? <div className="ctf-denv__stack"><p className="ctf-denv__muted">{tool.description}</p><div><a href={target.href} target="_blank" rel="noopener noreferrer"><Button variant="primary" icon={<ExternalLink size={14} />}>Open {tool.name.replace(/^Open in /, '')}</Button></a></div></div>
      : <EmptyState title={`${tool.name} isn't set up`} description={viewer.isMainAdmin ? 'Add the team link in the Integrations hub.' : 'A Main Admin needs to add the team link.'} action={viewer.isMainAdmin ? <Link to={`${base}/integrations`}><Button variant="secondary" size="sm">Open Integrations</Button></Link> : undefined} />
  } else {
    const render = tool.native ? NATIVE[tool.native] : undefined
    body = render ? render({ row, base, viewer }) : <EmptyState title="Not configured" description="This tool has nothing behind it." />
  }
  return <div className="ctf-denv__stack" style={{ ['--dept-accent' as string]: def.accent }}>{back}{!tool.records && <div><h3 className="ctf-denv__h3">{tool.name}</h3><p className="ctf-denv__muted">{tool.description}</p></div>}{body}</div>
}

