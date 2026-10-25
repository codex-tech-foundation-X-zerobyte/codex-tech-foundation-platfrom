import { OPERATIONS_DEPARTMENTS } from './operations.ts'
import {
  Cloud, Code, FileText, Megaphone, PenTool, Server, ShieldCheck, Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react'

/*
  Department definitions: the single, declarative description of every Codex department environment.

  Codex Tech Foundation ALREADY HAS these departments. They ship with the product; nobody creates them by hand. Each
  definition drives its dashboard, in-page navigation, tools, boards/workflows, record types, channels, metrics, onboarding
  and integrations, so adding a department later means adding a definition (or a template for one), not writing new UI.

  Rules baked into the shape of the data:
   - a tool is real or it is not listed: every tool names what powers it (an existing built-in page, a record type, the
     knowledge base, department files, a native tool, an external launcher, or a connected integration). A test fails if one
     points at nothing;
   - dashboard cards and metrics are counts of real records, tasks or leads, a shortcut to a real tool, or an integration
     that says plainly when it is not connected. There is no sample data anywhere in this file.
*/

export type IntegrationId = 'github' | 'github_actions' | 'figma' | 'canva'

export interface IntegrationDef { id: IntegrationId; name: string; purpose: string; /** The integrations-table row that holds its state (GitHub Actions rides on the GitHub connection). */ row: 'github' | 'figma' | 'canva' }

export const INTEGRATIONS: Record<IntegrationId, IntegrationDef> = {
  github: { id: 'github', name: 'GitHub', row: 'github', purpose: 'Repositories, branches, commits, issues, pull requests and reviews.' },
  github_actions: { id: 'github_actions', name: 'GitHub Actions', row: 'github', purpose: 'CI/CD runs, deployment history and environment status.' },
  figma: { id: 'figma', name: 'Figma', row: 'figma', purpose: 'Advanced design files, prototypes and design handoff. Opens your team\u2019s Figma.' },
  canva: { id: 'canva', name: 'Canva', row: 'canva', purpose: 'Brand templates and creative designs. Opens your team\u2019s Canva.' },
}

export type IntegrationStatus = 'not_connected' | 'needs_authorization' | 'connected' | 'error'
/** Live state of each integration row, as loaded from the database. Absent means not connected. */
export type IntegrationState = Partial<Record<'github' | 'figma' | 'canva', { status: IntegrationStatus; config: Record<string, unknown> }>>

export function integrationStatus(id: IntegrationId, state: IntegrationState = {}): IntegrationStatus {
  return state[INTEGRATIONS[id].row]?.status ?? 'not_connected'
}

export type ToolStatus = 'available' | 'not_connected'

/** Tools that run inside the Workspace without any database record of their own. */
export type NativeTool =
  | 'whiteboard' | 'webhooks' | 'headers' | 'dns' | 'logs' | 'config-checks' | 'training'
  | 'lead-stats' | 'record-calendar' | 'github-repos' | 'github-prs' | 'github-actions'
/** Links out to a service the company already uses. Resolved to a URL by `externalUrl()`. */
export type ExternalTarget = 'supabase-logs' | 'supabase-functions' | 'integration-url'

export interface ToolDef {
  id: string
  name: string
  description: string
  /** Id of a tool that already exists under Dev tools (see pages/tools/toolsMeta.ts), or a first-class page. */
  builtin?: string
  /** A record type this tool lists and edits (see `recordKinds`). */
  records?: string
  /** Preset for that record type: filters the list and pre-fills new records (e.g. only scripts). */
  preset?: Record<string, string>
  /** A knowledge-base category this tool opens, scoped to the department. */
  kb?: string
  /** A department files category (brand, media, final, versions). */
  files?: string
  native?: NativeTool
  external?: ExternalTarget
  /** The service this tool needs before it works. */
  integration?: IntegrationId
  /** Groups tools into a section (e.g. the Security Lab). */
  group?: string
}

export function toolStatus(tool: ToolDef, state: IntegrationState = {}): ToolStatus {
  if (tool.integration) {
    if (integrationStatus(tool.integration, state) !== 'connected') return 'not_connected'
    // An "open in" launcher also needs the team URL the Main Admin configures.
    if (tool.external === 'integration-url' && !integrationUrl(tool.integration, state)) return 'not_connected'
    return 'available'
  }
  return 'available'
}

export function integrationUrl(id: IntegrationId, state: IntegrationState): string | null {
  const url = state[INTEGRATIONS[id].row]?.config?.url
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : null
}

/** Supabase project ref from the configured URL, so dashboard shortcuts open the company's own project. */
export function supabaseProjectRef(url: string | undefined = import.meta.env?.VITE_SUPABASE_URL): string | null {
  const m = /^https:\/\/([a-z0-9]{10,})\.supabase\.co/i.exec(url ?? '')
  return m ? m[1] : null
}

export function externalUrl(target: ExternalTarget, tool: ToolDef, state: IntegrationState): string | null {
  const ref = supabaseProjectRef()
  switch (target) {
    case 'supabase-logs': return ref ? `https://supabase.com/dashboard/project/${ref}/logs/explorer` : 'https://supabase.com/dashboard'
    case 'supabase-functions': return ref ? `https://supabase.com/dashboard/project/${ref}/functions` : 'https://supabase.com/dashboard'
    case 'integration-url': return tool.integration ? integrationUrl(tool.integration, state) : null
  }
}

export interface BoardDef {
  id: string
  name: string
  description: string
  stages: string[]
  /** When set, this board's cards are records of that kind (their stages ARE the board's stages) alongside tasks. */
  recordKind?: string
}

/** What a dashboard card or metric counts. All of these read real rows the viewer is allowed to see. */
export type Source =
  | { type: 'tasks'; filter: 'open' | 'stage'; stage?: string }
  | { type: 'records'; kind: string; stage?: string; where?: Record<string, string>; all?: boolean }
  | { type: 'record_field'; kind: string; field: string }
  | { type: 'leads'; days?: number }
  /** Fund requests by where they are in the approval chain (Finance only). */
  | { type: 'funds'; filter: 'awaiting_finance' | 'awaiting_department' | 'awaiting_super_admin' | 'approved_unpaid' | 'needs_reconciliation' }
  /** Support tickets (Customer Service only). */
  | { type: 'tickets'; filter: 'open' | 'unassigned' | 'overdue' | 'escalated' }
export interface CardDef { label: string; description: string; source?: Source; /** Opens this tool. */ tool?: string; integration?: IntegrationId }
export interface MetricDef { label: string; source?: Source; integration?: IntegrationId }
export interface ChannelDef { name: string; description: string }

export type FieldType = 'text' | 'textarea' | 'select' | 'date' | 'url' | 'number'
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: string[]
  required?: boolean
  placeholder?: string
  hint?: string
  /** Only shown (and saved) when another field has one of these values. */
  showWhen?: { key: string; in: string[] }
}
export interface RecordKindDef {
  kind: string
  label: string
  plural: string
  stages: string[]
  fields: FieldDef[]
  /** Stages that count as finished. Defaults to the last stage. */
  closed?: string[]
  /** Date fields that put this record on the company calendar. */
  calendar?: { field: string; label: string }[]
  /** Show the record's due date on the calendar. */
  due?: boolean
  assignable?: boolean
}
export const isClosed = (k: RecordKindDef, stage: string) => (k.closed ?? [k.stages[k.stages.length - 1]]).includes(stage)

export interface OnboardingItem { key: string; label: string; description: string; link?: string }

export type SectionKind = 'overview' | 'board' | 'tools' | 'integrations' | 'channels' | 'team'
export interface SectionDef {
  id: string
  label: string
  kind: SectionKind
  boardId?: string
  toolGroup?: string
  /** Shown above the section; used for the Security Lab's authorised-use statement. */
  notice?: string
}

export interface DepartmentDef {
  slug: string
  /** Must equal the seeded `departments.name` so the two can be matched. */
  name: string
  shortName: string
  /** What the dashboard is called inside the department: "Design Studio", "DevOps Command Center"... */
  dashboardTitle: string
  tagline: string
  icon: LucideIcon
  /** Subtle per-department accent; one design system, one company. */
  accent: string
  roles: string[]
  cards: CardDef[]
  sections: SectionDef[]
  boards: BoardDef[]
  recordKinds: RecordKindDef[]
  tools: ToolDef[]
  channels: ChannelDef[]
  metrics: MetricDef[]
  onboarding: OnboardingItem[]
}

/** Steps every new person takes, whatever their department. */
export const COMPANY_ONBOARDING: OnboardingItem[] = [
  { key: 'company.password', label: 'Set your own password', description: 'You were given a temporary one. Choose something only you know.' },
  { key: 'company.profile', label: 'Complete your profile', description: 'Add a photo and a short bio so colleagues know who you are.', link: 'settings' },
  { key: 'company.handbook', label: 'Read the company handbook', description: 'How Codex works, what we expect and how to get help.', link: 'knowledge?category=Company' },
  { key: 'company.channels', label: 'Say hello in your department channel', description: 'Your department\u2019s channels are already set up in Chat.', link: 'chat' },
  { key: 'company.admin', label: 'Meet your Department Admin', description: 'They assign your work and are your first point of contact.' },
]

const overview: SectionDef = { id: 'overview', label: 'Overview', kind: 'overview' }
const team: SectionDef = { id: 'team', label: 'Team', kind: 'team' }
const channels: SectionDef = { id: 'channels', label: 'Channels', kind: 'channels' }
const integrations: SectionDef = { id: 'integrations', label: 'Integrations', kind: 'integrations' }

const SEVERITY = ['Low', 'Medium', 'High', 'Critical']
const BUG: RecordKindDef = {
  kind: 'bug', label: 'Bug', plural: 'Bugs', assignable: true,
  stages: ['Reported', 'Triaged', 'In progress', 'Fixed', 'Verified'],
  fields: [
    { key: 'severity', label: 'Severity', type: 'select', options: SEVERITY, required: true },
    { key: 'area', label: 'Where', type: 'text', placeholder: 'Page, component or endpoint' },
    { key: 'steps', label: 'Steps to reproduce', type: 'textarea' },
    { key: 'expected', label: 'Expected', type: 'textarea' },
    { key: 'actual', label: 'Actual', type: 'textarea' },
  ],
}

export const DEPARTMENTS: DepartmentDef[] = [
  {
    slug: 'frontend-development',
    name: 'Frontend Development',
    shortName: 'Frontend',
    dashboardTitle: 'Frontend Development',
    tagline: 'Interfaces, components and the code that ships them.',
    icon: Code,
    accent: '#4a63ff',
    roles: ['Frontend Developer', 'Senior Frontend Developer', 'QA Engineer'],
    cards: [
      { label: 'Sprint board', description: 'Open tasks across the sprint.', source: { type: 'tasks', filter: 'open' } },
      { label: 'Pull requests', description: 'Open PRs waiting for review.', integration: 'github', tool: 'prs' },
      { label: 'Code reviews', description: 'Tasks sitting in code review.', source: { type: 'tasks', filter: 'stage', stage: 'Code review' } },
      { label: 'Bugs', description: 'Open defects on frontend projects.', source: { type: 'records', kind: 'bug' }, tool: 'bugs' },
      { label: 'QA', description: 'Work waiting on testing.', source: { type: 'tasks', filter: 'stage', stage: 'QA' } },
      { label: 'Deployments', description: 'Latest deployments of frontend projects.', integration: 'github_actions' },
    ],
    sections: [overview, { id: 'board', label: 'Sprint board', kind: 'board', boardId: 'sprint' }, { id: 'tools', label: 'Dev tools', kind: 'tools' }, integrations, channels, team],
    boards: [{ id: 'sprint', name: 'Sprint board', description: 'How frontend work moves to production.', stages: ['Backlog', 'Ready', 'In development', 'Code review', 'QA', 'Ready for deployment', 'Deployed'] }],
    recordKinds: [BUG],
    tools: [
      { id: 'repos', name: 'Repository browser', description: 'Browse linked repositories, branches, commits and issues.', native: 'github-repos', integration: 'github' },
      { id: 'prs', name: 'Pull requests & reviews', description: 'Open pull requests and their review state.', native: 'github-prs', integration: 'github' },
      { id: 'api', name: 'API request tester', description: 'Send a request and inspect status, timing and headers.', builtin: 'api' },
      { id: 'json', name: 'JSON viewer', description: 'Format, validate and explore JSON.', builtin: 'json' },
      { id: 'http', name: 'HTTP inspector', description: 'Reference for every status code you will meet.', builtin: 'http' },
      { id: 'color', name: 'Color & contrast', description: 'Check WCAG contrast and convert colors.', builtin: 'color' },
      { id: 'bugs', name: 'Bug tracker', description: 'Report, triage and verify frontend defects.', records: 'bug' },
      { id: 'docs', name: 'Technical documentation', description: 'Frontend standards and component docs.', kb: 'Development' },
    ],
    channels: [{ name: '#general', description: 'Frontend team conversation.' }, { name: '#development', description: 'Build and implementation questions.' }, { name: '#bugs', description: 'Defects and regressions.' }],
    metrics: [{ label: 'Tasks in review', source: { type: 'tasks', filter: 'stage', stage: 'Code review' } }, { label: 'Open bugs', source: { type: 'records', kind: 'bug' } }, { label: 'Open pull requests', integration: 'github' }],
    onboarding: [
      { key: 'dept.frontend.repo', label: 'Get access to the frontend repository', description: 'Ask your Department Admin to link it, then open Repository browser.', link: 'tool:repos' },
      { key: 'dept.frontend.standards', label: 'Read the frontend standards', description: 'Component, naming and review conventions.', link: 'tool:docs' },
      { key: 'dept.frontend.board', label: 'Find your tasks on the sprint board', description: 'Your assigned work is highlighted.', link: 'section:board' },
    ],
  },
  {
    slug: 'backend-development',
    name: 'Backend Development',
    shortName: 'Backend',
    dashboardTitle: 'Backend Development',
    tagline: 'APIs, data and the services behind every product.',
    icon: Server,
    accent: '#0ea5a4',
    roles: ['Backend Developer', 'Senior Backend Developer', 'Database Engineer'],
    cards: [
      { label: 'API tasks', description: 'Open backend tasks.', source: { type: 'tasks', filter: 'open' } },
      { label: 'Bugs', description: 'Open defects on backend services.', source: { type: 'records', kind: 'bug' }, tool: 'bugs' },
      { label: 'In API testing', description: 'Work being tested against the API contract.', source: { type: 'tasks', filter: 'stage', stage: 'API testing' } },
      { label: 'Code review', description: 'Tasks waiting on review.', source: { type: 'tasks', filter: 'stage', stage: 'Code review' } },
      { label: 'In staging', description: 'Work verified in staging.', source: { type: 'tasks', filter: 'stage', stage: 'Staging' } },
      { label: 'Edge Functions', description: 'Manage and monitor server-side functions.', tool: 'edge-functions' },
    ],
    sections: [overview, { id: 'board', label: 'API board', kind: 'board', boardId: 'api' }, { id: 'tools', label: 'API tools', kind: 'tools' }, integrations, channels, team],
    boards: [{ id: 'api', name: 'API board', description: 'How backend work moves to production.', stages: ['Backlog', 'Development', 'API testing', 'Code review', 'QA', 'Staging', 'Production'] }],
    recordKinds: [BUG],
    tools: [
      { id: 'api', name: 'API request tester', description: 'Send requests and inspect responses.', builtin: 'api' },
      { id: 'json', name: 'JSON formatter', description: 'Format, validate and sort JSON.', builtin: 'json' },
      { id: 'jwt', name: 'JWT decoder', description: 'Inspect token headers and claims.', builtin: 'jwt' },
      { id: 'cron', name: 'Cron explainer', description: 'Read schedules in plain English.', builtin: 'cron' },
      { id: 'uuid', name: 'UUID generator', description: 'Generate identifiers in bulk.', builtin: 'uuid' },
      { id: 'webhooks', name: 'Webhook tester', description: 'Get a URL, point a service at it, and inspect every request it sends.', native: 'webhooks' },
      { id: 'schema', name: 'Database & schema docs', description: 'Tables, policies and migrations, written down.', kb: 'Technical Documentation' },
      { id: 'logs', name: 'Service logs', description: 'Opens the company project\u2019s log explorer.', external: 'supabase-logs' },
      { id: 'edge-functions', name: 'Edge Functions', description: 'Opens the project\u2019s function dashboard to deploy and monitor.', external: 'supabase-functions' },
      { id: 'bugs', name: 'Bug tracker', description: 'Report, triage and verify backend defects.', records: 'bug' },
      { id: 'repos', name: 'Repositories', description: 'Branches, commits and issues for linked repositories.', native: 'github-repos', integration: 'github' },
    ],
    channels: [{ name: '#general', description: 'Backend team conversation.' }, { name: '#api', description: 'API design and contracts.' }, { name: '#database', description: 'Schema and migrations.' }],
    metrics: [{ label: 'Tasks in API testing', source: { type: 'tasks', filter: 'stage', stage: 'API testing' } }, { label: 'Open bugs', source: { type: 'records', kind: 'bug' } }, { label: 'Open pull requests', integration: 'github' }],
    onboarding: [
      { key: 'dept.backend.schema', label: 'Read the database and schema docs', description: 'Know the tables and policies before you change them.', link: 'tool:schema' },
      { key: 'dept.backend.functions', label: 'Open the Edge Functions dashboard', description: 'See what is deployed and how it is monitored.', link: 'tool:edge-functions' },
      { key: 'dept.backend.webhook', label: 'Create a webhook inbox and send it a test', description: 'The fastest way to see how requests really arrive.', link: 'tool:webhooks' },
    ],
  },
  {
    slug: 'devops',
    name: 'DevOps',
    shortName: 'DevOps',
    dashboardTitle: 'DevOps Command Center',
    tagline: 'Deployments, infrastructure and the uptime of everything we ship.',
    icon: Cloud,
    accent: '#f59e0b',
    roles: ['DevOps Engineer', 'Site Reliability Engineer', 'Infrastructure Engineer'],
    cards: [
      { label: 'Open incidents', description: 'Operational incidents not yet resolved.', source: { type: 'records', kind: 'incident' }, tool: 'incidents' },
      { label: 'Deployments', description: 'Recent deployments and their outcome.', integration: 'github_actions', tool: 'actions' },
      { label: 'CI/CD', description: 'Pipeline runs and failures.', integration: 'github_actions', tool: 'actions' },
      { label: 'Domains & SSL', description: 'Domains being watched for expiry.', source: { type: 'records', kind: 'domain' }, tool: 'domains' },
      { label: 'Operations tasks', description: 'Open infrastructure work.', source: { type: 'tasks', filter: 'open' } },
      { label: 'Failed backup checks', description: 'Backup verifications that failed.', source: { type: 'records', kind: 'backup_check', stage: 'Failed' }, tool: 'backups' },
    ],
    sections: [overview, { id: 'board', label: 'Operations board', kind: 'board', boardId: 'ops' }, { id: 'tools', label: 'Infrastructure', kind: 'tools' }, integrations, channels, team],
    boards: [{ id: 'ops', name: 'Operations board', description: 'How infrastructure and release work is delivered.', stages: ['Requested', 'Planned', 'Configuration', 'Testing', 'Staging', 'Deployment', 'Verified'] }],
    recordKinds: [
      {
        kind: 'incident', label: 'Incident', plural: 'Incidents', assignable: true, stages: ['Open', 'Investigating', 'Mitigated', 'Resolved'],
        fields: [
          { key: 'severity', label: 'Severity', type: 'select', options: SEVERITY, required: true },
          { key: 'impact', label: 'Impact', type: 'textarea', placeholder: 'Who or what is affected' },
          { key: 'started_on', label: 'Started', type: 'date' },
          { key: 'root_cause', label: 'Root cause', type: 'textarea' },
          { key: 'resolution', label: 'Resolution', type: 'textarea' },
        ],
        calendar: [{ field: 'started_on', label: 'Incident started' }],
      },
      {
        kind: 'domain', label: 'Domain', plural: 'Domains', stages: ['Watching', 'Renewed', 'Retired'], closed: ['Retired'],
        fields: [
          { key: 'domain', label: 'Domain', type: 'text', required: true, placeholder: 'example.com' },
          { key: 'registrar', label: 'Registrar', type: 'text' },
          { key: 'expires_on', label: 'Domain expires', type: 'date', required: true },
          { key: 'ssl_expires_on', label: 'SSL certificate expires', type: 'date' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        calendar: [{ field: 'expires_on', label: 'Domain expires' }, { field: 'ssl_expires_on', label: 'SSL expires' }],
      },
      {
        kind: 'backup_check', label: 'Backup check', plural: 'Backup checks', stages: ['Verified', 'Failed'], closed: ['Verified'],
        fields: [
          { key: 'scope', label: 'What was checked', type: 'text', required: true, placeholder: 'e.g. Production database' },
          { key: 'method', label: 'How', type: 'select', options: ['Restore test', 'Automated report', 'Manual inspection'], required: true },
          { key: 'checked_on', label: 'Checked on', type: 'date', required: true },
          { key: 'result', label: 'Result', type: 'textarea' },
        ],
      },
    ],
    tools: [
      { id: 'actions', name: 'CI/CD & GitHub Actions', description: 'Pipeline runs, results and deployment history.', native: 'github-actions', integration: 'github_actions' },
      { id: 'repos', name: 'Repositories', description: 'Branches, commits and release activity.', native: 'github-repos', integration: 'github' },
      { id: 'health', name: 'Health checks', description: 'Live status of the database, auth, realtime and storage.', builtin: 'status' },
      { id: 'incidents', name: 'Incident management', description: 'Open, investigate, mitigate and resolve incidents.', records: 'incident' },
      { id: 'domains', name: 'Domain & SSL watch list', description: 'Track expiry dates and be warned before they lapse.', records: 'domain' },
      { id: 'backups', name: 'Backup verification log', description: 'Record each backup check and whether it passed.', records: 'backup_check' },
      { id: 'logs', name: 'Service logs', description: 'Opens the company project\u2019s log explorer.', external: 'supabase-logs' },
      { id: 'cron', name: 'Cron explainer', description: 'Read schedules in plain English.', builtin: 'cron' },
      { id: 'http', name: 'HTTP status reference', description: 'Status codes and what they mean.', builtin: 'http' },
      { id: 'infra-docs', name: 'Infrastructure documentation', description: 'Runbooks and architecture notes.', kb: 'Technical Documentation' },
    ],
    channels: [{ name: '#general', description: 'DevOps team conversation.' }, { name: '#deployments', description: 'Release coordination.' }, { name: '#incidents', description: 'Live incident response.' }],
    metrics: [{ label: 'Open incidents', source: { type: 'records', kind: 'incident' } }, { label: 'Domains being watched', source: { type: 'records', kind: 'domain' } }, { label: 'Failed pipeline runs', integration: 'github_actions' }],
    onboarding: [
      { key: 'dept.devops.runbooks', label: 'Read the infrastructure runbooks', description: 'How we deploy, roll back and respond.', link: 'tool:infra-docs' },
      { key: 'dept.devops.domains', label: 'Review the domain watch list', description: 'Know what expires and when.', link: 'tool:domains' },
      { key: 'dept.devops.health', label: 'Open the live health checks', description: 'See what healthy looks like.', link: 'tool:health' },
    ],
  },
  {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    shortName: 'Security',
    dashboardTitle: 'Security Workspace',
    tagline: 'Protecting company systems, with a controlled lab for authorised testing.',
    icon: ShieldCheck,
    accent: '#10b981',
    roles: ['Security Analyst', 'Security Engineer', 'Incident Responder'],
    cards: [
      { label: 'Vulnerabilities', description: 'Open findings.', source: { type: 'records', kind: 'security_issue', where: { type: 'Vulnerability' } } },
      { label: 'Incidents', description: 'Active security incidents.', source: { type: 'records', kind: 'security_issue', where: { type: 'Incident' } } },
      { label: 'Risk register', description: 'Risks not yet closed.', source: { type: 'records', kind: 'security_issue', where: { type: 'Risk' } } },
      { label: 'Security reviews', description: 'Reviews requested by other departments.', source: { type: 'records', kind: 'security_issue', where: { type: 'Security review' } } },
      { label: 'In remediation', description: 'Fixes in progress.', source: { type: 'records', kind: 'security_issue', stage: 'Remediation' } },
      { label: 'Audit findings', description: 'Audit work not yet closed.', source: { type: 'records', kind: 'security_issue', where: { type: 'Audit finding' } } },
    ],
    sections: [
      overview,
      { id: 'operations', label: 'Security Operations', kind: 'board', boardId: 'operations' },
      { id: 'lab', label: 'Security Lab', kind: 'tools', toolGroup: 'lab', notice: 'For company-owned systems, authorised testing, controlled environments, defensive analysis and training only. Do not point these tools at systems you do not own or have written permission to test.' },
      channels,
      team,
    ],
    boards: [{ id: 'operations', name: 'Security Operations', description: 'Real company security work, from discovery to closure.', stages: ['Identified', 'Triage', 'Investigating', 'Risk assessment', 'Remediation', 'Verification', 'Closed'], recordKind: 'security_issue' }],
    recordKinds: [
      {
        kind: 'security_issue', label: 'Security item', plural: 'Security items', assignable: true,
        stages: ['Identified', 'Triage', 'Investigating', 'Risk assessment', 'Remediation', 'Verification', 'Closed'],
        fields: [
          { key: 'type', label: 'Type', type: 'select', options: ['Vulnerability', 'Incident', 'Risk', 'Security review', 'Audit finding'], required: true },
          { key: 'severity', label: 'Severity', type: 'select', options: SEVERITY, required: true },
          { key: 'affected', label: 'Affected system', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'remediation', label: 'Remediation', type: 'textarea' },
        ],
      },
      {
        kind: 'config_audit', label: 'Configuration audit', plural: 'Configuration audits', stages: ['Saved'],
        fields: [
          { key: 'scope', label: 'Scope', type: 'text', required: true },
          { key: 'score', label: 'Score (%)', type: 'number' },
          { key: 'results', label: 'Results', type: 'textarea' },
        ],
      },
    ],
    tools: [
      { id: 'hash', name: 'Hash & HMAC', description: 'Calculate and verify digests.', builtin: 'hash', group: 'lab' },
      { id: 'jwt', name: 'JWT inspector', description: 'Inspect token headers and claims. Never verifies or uploads.', builtin: 'jwt', group: 'lab' },
      { id: 'base64', name: 'Encoding & decoding', description: 'Base64 encode and decode.', builtin: 'base64', group: 'lab' },
      { id: 'url', name: 'URL parser', description: 'Break a URL into parts and parameters.', builtin: 'url', group: 'lab' },
      { id: 'password', name: 'Secret generator', description: 'Random secrets with an entropy estimate.', builtin: 'password', group: 'lab' },
      { id: 'headers', name: 'HTTP header analysis', description: 'Paste response headers and get a security-header review.', native: 'headers', group: 'lab' },
      { id: 'dns', name: 'DNS inspection', description: 'Look up records for a domain you own.', native: 'dns', group: 'lab' },
      { id: 'logs', name: 'Log analysis', description: 'Paste a log and see levels, sources, status codes and top errors.', native: 'logs', group: 'lab' },
      { id: 'config', name: 'Configuration checks', description: 'Work through a security checklist and save the audit.', native: 'config-checks', group: 'lab' },
      { id: 'training', name: 'Training environments', description: 'Isolated external platforms for practising safely.', native: 'training', group: 'lab' },
    ],
    channels: [{ name: '#general', description: 'Security team conversation.' }, { name: '#security-ops', description: 'Day-to-day operations.' }, { name: '#security-lab', description: 'Lab work and findings.' }, { name: '#incidents', description: 'Live incident response.' }],
    metrics: [{ label: 'Open security items', source: { type: 'records', kind: 'security_issue' } }, { label: 'In remediation', source: { type: 'records', kind: 'security_issue', stage: 'Remediation' } }, { label: 'Awaiting verification', source: { type: 'records', kind: 'security_issue', stage: 'Verification' } }],
    onboarding: [
      { key: 'dept.security.scope', label: 'Read the authorised-use statement', description: 'What the Security Lab is and is not for.', link: 'section:lab' },
      { key: 'dept.security.runbook', label: 'Read the incident runbook', description: 'Who does what when something is wrong.', link: 'kb:Security' },
      { key: 'dept.security.board', label: 'Review the Security Operations board', description: 'See how an issue moves from Identified to Closed.', link: 'section:operations' },
    ],
  },
  {
    slug: 'ui-ux-design',
    name: 'UI/UX Design',
    shortName: 'UI/UX',
    dashboardTitle: 'Design Studio',
    tagline: 'Research, flows and interfaces, from first sketch to review.',
    icon: PenTool,
    accent: '#a855f7',
    roles: ['UI Designer', 'UX Designer', 'Product Designer'],
    cards: [
      { label: 'Design tasks', description: 'Open design work.', source: { type: 'tasks', filter: 'open' } },
      { label: 'Design reviews', description: 'Designs waiting for feedback.', source: { type: 'records', kind: 'design_review' }, tool: 'reviews' },
      { label: 'Components', description: 'Components in the shared library.', source: { type: 'records', kind: 'component', all: true }, tool: 'components' },
      { label: 'Prototypes', description: 'Open your team\u2019s Figma.', integration: 'figma', tool: 'figma' },
      { label: 'Brand library', description: 'Approved logos, colors and type.', tool: 'brand' },
      { label: 'Changes requested', description: 'Reviews that need another pass.', source: { type: 'records', kind: 'design_review', stage: 'Changes requested' }, tool: 'reviews' },
    ],
    sections: [overview, { id: 'board', label: 'Design board', kind: 'board', boardId: 'design' }, { id: 'tools', label: 'Design tools', kind: 'tools' }, integrations, channels, team],
    boards: [{ id: 'design', name: 'Design board', description: 'How design work reaches approval.', stages: ['Research', 'Wireframes', 'UI design', 'Prototype', 'Design review', 'Changes requested', 'Approved'] }],
    recordKinds: [
      {
        kind: 'design_review', label: 'Design review', plural: 'Design reviews', assignable: true, stages: ['Requested', 'In review', 'Changes requested', 'Approved'], due: true,
        fields: [
          { key: 'figma_url', label: 'Design link', type: 'url', placeholder: 'https://…' },
          { key: 'summary', label: 'What to look at', type: 'textarea' },
          { key: 'feedback', label: 'Feedback', type: 'textarea' },
        ],
      },
      {
        kind: 'component', label: 'Component', plural: 'Components', stages: ['Draft', 'In review', 'Approved', 'Deprecated'], closed: ['Approved', 'Deprecated'],
        fields: [
          { key: 'description', label: 'What it is', type: 'textarea' },
          { key: 'usage', label: 'When to use it', type: 'textarea' },
          { key: 'link', label: 'Link', type: 'url', placeholder: 'https://…' },
        ],
      },
    ],
    tools: [
      { id: 'whiteboard', name: 'Whiteboard', description: 'Sketch flows, wireframes and architecture together.', native: 'whiteboard' },
      { id: 'figma', name: 'Open in Figma', description: 'Advanced design, prototypes and handoff.', external: 'integration-url', integration: 'figma' },
      { id: 'color', name: 'Color & contrast', description: 'Convert colors and check WCAG contrast.', builtin: 'color' },
      { id: 'components', name: 'Component library', description: 'Shared components and when to use them.', records: 'component' },
      { id: 'brand', name: 'Brand library', description: 'Approved logos, colors and typography.', files: 'brand' },
      { id: 'reviews', name: 'Design reviews & feedback', description: 'Request a review, collect feedback, approve.', records: 'design_review' },
    ],
    channels: [{ name: '#general', description: 'Design team conversation.' }, { name: '#design-review', description: 'Share work for feedback.' }, { name: '#research', description: 'User research and findings.' }],
    metrics: [{ label: 'Designs in review', source: { type: 'records', kind: 'design_review', stage: 'In review' } }, { label: 'Changes requested', source: { type: 'records', kind: 'design_review', stage: 'Changes requested' } }, { label: 'Approved reviews', source: { type: 'records', kind: 'design_review', stage: 'Approved', all: true } }],
    onboarding: [
      { key: 'dept.design.brand', label: 'Browse the brand library', description: 'Logos, colors and type you must use.', link: 'tool:brand' },
      { key: 'dept.design.whiteboard', label: 'Open the whiteboard', description: 'Where flows and wireframes start.', link: 'tool:whiteboard' },
      { key: 'dept.design.reviews', label: 'See how design reviews work', description: 'Request, review, change, approve.', link: 'tool:reviews' },
    ],
  },
  {
    slug: 'graphics-creative',
    name: 'Graphics & Creative',
    shortName: 'Creative',
    dashboardTitle: 'Creative Studio',
    tagline: 'Posters, social graphics and brand assets, requested, made and approved here.',
    icon: ImageIcon,
    accent: '#ec4899',
    roles: ['Graphic Designer', 'Brand Designer', 'Motion Designer'],
    cards: [
      { label: 'Design requests', description: 'Requests waiting to be picked up.', source: { type: 'records', kind: 'creative_request', stage: 'Request' }, tool: 'briefs' },
      { label: 'Active designs', description: 'Designs being made right now.', source: { type: 'records', kind: 'creative_request', stage: 'Designing' }, tool: 'briefs' },
      { label: 'Canva projects', description: 'Open your team\u2019s Canva.', integration: 'canva', tool: 'canva' },
      { label: 'Brand assets', description: 'Approved logos, templates and images.', tool: 'assets' },
      { label: 'Creative reviews', description: 'Work waiting for approval.', source: { type: 'records', kind: 'creative_request', stage: 'Review' }, tool: 'briefs' },
      { label: 'Final assets', description: 'Approved files ready to use.', tool: 'final' },
    ],
    sections: [overview, { id: 'board', label: 'Request board', kind: 'board', boardId: 'requests' }, { id: 'tools', label: 'Creative tools', kind: 'tools' }, integrations, channels, team],
    boards: [{ id: 'requests', name: 'Request board', description: 'From a creative request to a final asset.', stages: ['Request', 'Assigned', 'Designing', 'Review', 'Changes requested', 'Approved', 'Final asset'], recordKind: 'creative_request' }],
    recordKinds: [
      {
        kind: 'creative_request', label: 'Creative request', plural: 'Creative requests', assignable: true, due: true,
        stages: ['Request', 'Assigned', 'Designing', 'Review', 'Changes requested', 'Approved', 'Final asset'],
        fields: [
          { key: 'asset_type', label: 'Asset type', type: 'select', options: ['Social graphic', 'Poster', 'Flyer', 'Banner', 'Thumbnail', 'Presentation', 'Other'], required: true },
          { key: 'dimensions', label: 'Dimensions', type: 'text', placeholder: 'e.g. 1080 × 1350' },
          { key: 'brief', label: 'Brief', type: 'textarea', hint: 'What to make, for whom, and the message.' },
          { key: 'references', label: 'References', type: 'textarea' },
          { key: 'canva_url', label: 'Canva link', type: 'url', placeholder: 'https://…' },
          { key: 'final_url', label: 'Final asset link', type: 'url', placeholder: 'https://…' },
        ],
      },
    ],
    tools: [
      { id: 'canva', name: 'Open in Canva', description: 'Design in Canva and link the result to a request.', external: 'integration-url', integration: 'canva' },
      { id: 'briefs', name: 'Creative briefs & requests', description: 'Every request, from brief to final asset.', records: 'creative_request' },
      { id: 'assets', name: 'Brand assets', description: 'Approved logos, templates and images.', files: 'brand' },
      { id: 'versions', name: 'Design versions', description: 'Keep every revision of a design.', files: 'versions' },
      { id: 'final', name: 'Final asset storage', description: 'Approved files, ready to use.', files: 'final' },
      { id: 'color', name: 'Color & contrast', description: 'Convert colors and check contrast.', builtin: 'color' },
    ],
    channels: [{ name: '#general', description: 'Creative team conversation.' }, { name: '#requests', description: 'New design requests.' }, { name: '#creative-review', description: 'Share work for approval.' }],
    metrics: [{ label: 'Open requests', source: { type: 'records', kind: 'creative_request', stage: 'Request' } }, { label: 'Designs in review', source: { type: 'records', kind: 'creative_request', stage: 'Review' } }, { label: 'Approved this far', source: { type: 'records', kind: 'creative_request', stage: 'Approved', all: true } }],
    onboarding: [
      { key: 'dept.creative.brand', label: 'Review the brand assets', description: 'Approved logos, colors and templates.', link: 'tool:assets' },
      { key: 'dept.creative.board', label: 'Look at the request board', description: 'See how a request becomes a final asset.', link: 'section:board' },
      { key: 'dept.creative.canva', label: 'Open the team Canva', description: 'Where most designs are made.', link: 'tool:canva' },
    ],
  },
  {
    slug: 'content',
    name: 'Content',
    shortName: 'Content',
    dashboardTitle: 'Content Studio',
    tagline: 'Ideas, scripts and articles, from first draft to published.',
    icon: FileText,
    accent: '#f97316',
    roles: ['Content Writer', 'Scriptwriter', 'Content Strategist'],
    cards: [
      { label: 'Content calendar', description: 'What publishes, and when.', tool: 'calendar' },
      { label: 'Ideas', description: 'Pitches waiting for a decision.', source: { type: 'records', kind: 'content_item', stage: 'Idea' } },
      { label: 'Scripts', description: 'Scripts not yet published.', source: { type: 'records', kind: 'content_item', where: { content_type: 'Script' } }, tool: 'script' },
      { label: 'Captions', description: 'Captions not yet published.', source: { type: 'records', kind: 'content_item', where: { content_type: 'Caption' } }, tool: 'captions' },
      { label: 'Review queue', description: 'Drafts waiting for review.', source: { type: 'records', kind: 'content_item', stage: 'Review' } },
      { label: 'Scheduled', description: 'Approved and scheduled content.', source: { type: 'records', kind: 'content_item', stage: 'Scheduled' } },
    ],
    sections: [overview, { id: 'board', label: 'Content board', kind: 'board', boardId: 'content' }, { id: 'tools', label: 'Writing tools', kind: 'tools' }, channels, team],
    boards: [{ id: 'content', name: 'Content board', description: 'How content reaches publication.', stages: ['Idea', 'Draft', 'Review', 'Approved', 'Scheduled', 'Published'], recordKind: 'content_item' }],
    recordKinds: [
      {
        kind: 'content_item', label: 'Content', plural: 'Content', assignable: true, stages: ['Idea', 'Draft', 'Review', 'Approved', 'Scheduled', 'Published'],
        calendar: [{ field: 'publish_on', label: 'Publishing' }],
        fields: [
          { key: 'content_type', label: 'Type', type: 'select', options: ['Script', 'Caption', 'Article', 'Social post'], required: true },
          { key: 'channel', label: 'Channel', type: 'text', placeholder: 'e.g. YouTube, LinkedIn, Blog' },
          { key: 'hook', label: 'Hook', type: 'textarea', showWhen: { key: 'content_type', in: ['Script'] }, hint: 'The first line that earns the next ten seconds.' },
          { key: 'introduction', label: 'Introduction', type: 'textarea', showWhen: { key: 'content_type', in: ['Script'] } },
          { key: 'main_point', label: 'Main point', type: 'textarea', showWhen: { key: 'content_type', in: ['Script'] } },
          { key: 'supporting_points', label: 'Supporting points', type: 'textarea', showWhen: { key: 'content_type', in: ['Script'] } },
          { key: 'cta', label: 'Call to action', type: 'textarea', showWhen: { key: 'content_type', in: ['Script'] } },
          { key: 'body', label: 'Body', type: 'textarea', showWhen: { key: 'content_type', in: ['Article'] } },
          { key: 'caption', label: 'Caption', type: 'textarea', showWhen: { key: 'content_type', in: ['Script', 'Caption', 'Social post'] } },
          { key: 'hashtags', label: 'Hashtags', type: 'text', showWhen: { key: 'content_type', in: ['Script', 'Caption', 'Social post'] }, placeholder: '#codex #engineering' },
          { key: 'publish_on', label: 'Publish on', type: 'date' },
        ],
      },
    ],
    tools: [
      { id: 'script', name: 'Script editor', description: 'Title, hook, introduction, main point, supporting points, CTA, caption and hashtags.', records: 'content_item', preset: { content_type: 'Script' } },
      { id: 'captions', name: 'Caption editor', description: 'Write and review captions.', records: 'content_item', preset: { content_type: 'Caption' } },
      { id: 'articles', name: 'Article editor', description: 'Long-form writing and documentation.', records: 'content_item', preset: { content_type: 'Article' } },
      { id: 'calendar', name: 'Content calendar', description: 'Everything scheduled to publish, by date.', native: 'record-calendar' },
      { id: 'media', name: 'Media library', description: 'Images and clips attached to content.', files: 'media' },
      { id: 'diff', name: 'Text diff', description: 'Compare two versions of a draft.', builtin: 'diff' },
      { id: 'canva', name: 'Canva', description: 'Design visuals for a post.', external: 'integration-url', integration: 'canva' },
    ],
    channels: [{ name: '#general', description: 'Content team conversation.' }, { name: '#scripts', description: 'Scripts and hooks.' }, { name: '#content-review', description: 'Drafts ready for review.' }],
    metrics: [{ label: 'Drafts in review', source: { type: 'records', kind: 'content_item', stage: 'Review' } }, { label: 'Scheduled', source: { type: 'records', kind: 'content_item', stage: 'Scheduled' } }, { label: 'Published', source: { type: 'records', kind: 'content_item', stage: 'Published', all: true } }],
    onboarding: [
      { key: 'dept.content.voice', label: 'Read the voice and style guide', description: 'How Codex sounds.', link: 'kb:Content' },
      { key: 'dept.content.script', label: 'Open the script editor', description: 'Hook, points, CTA, caption and hashtags in one place.', link: 'tool:script' },
      { key: 'dept.content.board', label: 'See the content board', description: 'Idea to published.', link: 'section:board' },
    ],
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    shortName: 'Marketing',
    dashboardTitle: 'Marketing Hub',
    tagline: 'Campaigns, leads and audience, with numbers only from real sources.',
    icon: Megaphone,
    accent: '#ef4444',
    roles: ['Marketing Specialist', 'Growth Marketer', 'Social Media Manager'],
    cards: [
      { label: 'Campaigns', description: 'Campaigns planned and running.', source: { type: 'records', kind: 'campaign' }, tool: 'planner' },
      { label: 'New leads (7 days)', description: 'Enquiries from the public site.', source: { type: 'leads', days: 7 }, tool: 'leads' },
      { label: 'Followers', description: 'Latest figure your team entered.', source: { type: 'record_field', kind: 'analytics_entry', field: 'followers' }, tool: 'analytics' },
      { label: 'Conversions', description: 'Latest figure your team entered.', source: { type: 'record_field', kind: 'analytics_entry', field: 'conversions' }, tool: 'analytics' },
      { label: 'Reports', description: 'Campaign reports written so far.', source: { type: 'records', kind: 'marketing_report', all: true }, tool: 'reports' },
      { label: 'Growth tasks', description: 'Open marketing work.', source: { type: 'tasks', filter: 'open' } },
    ],
    sections: [overview, { id: 'board', label: 'Campaign board', kind: 'board', boardId: 'campaigns' }, { id: 'tools', label: 'Marketing tools', kind: 'tools' }, channels, team],
    boards: [{ id: 'campaigns', name: 'Campaign board', description: 'From campaign idea to measured results.', stages: ['Idea', 'Planning', 'Assets in progress', 'Review', 'Scheduled', 'Live', 'Reported'], recordKind: 'campaign' }],
    recordKinds: [
      {
        kind: 'campaign', label: 'Campaign', plural: 'Campaigns', assignable: true, stages: ['Idea', 'Planning', 'Assets in progress', 'Review', 'Scheduled', 'Live', 'Reported'],
        calendar: [{ field: 'start_on', label: 'Campaign starts' }, { field: 'end_on', label: 'Campaign ends' }],
        fields: [
          { key: 'goal', label: 'Goal', type: 'textarea', required: true },
          { key: 'audience', label: 'Audience', type: 'textarea' },
          { key: 'channels', label: 'Channels', type: 'text', placeholder: 'e.g. LinkedIn, email, YouTube' },
          { key: 'start_on', label: 'Starts', type: 'date' },
          { key: 'end_on', label: 'Ends', type: 'date' },
          { key: 'kpis', label: 'How success is measured', type: 'textarea' },
        ],
      },
      {
        kind: 'marketing_report', label: 'Report', plural: 'Reports', stages: ['Draft', 'Reviewed', 'Shared'],
        fields: [
          { key: 'period', label: 'Period', type: 'text', required: true, placeholder: 'e.g. October 2026' },
          { key: 'summary', label: 'Summary', type: 'textarea' },
          { key: 'results', label: 'Results', type: 'textarea' },
        ],
      },
      {
        kind: 'analytics_entry', label: 'Analytics entry', plural: 'Analytics entries', stages: ['Entered'],
        fields: [
          { key: 'period', label: 'Period', type: 'text', required: true, placeholder: 'e.g. Week of 5 Oct' },
          { key: 'source', label: 'Where the numbers come from', type: 'text', required: true, placeholder: 'e.g. LinkedIn analytics, Google Analytics' },
          { key: 'reach', label: 'Reach', type: 'number' },
          { key: 'followers', label: 'Followers', type: 'number' },
          { key: 'engagement', label: 'Engagements', type: 'number' },
          { key: 'conversions', label: 'Conversions', type: 'number' },
        ],
      },
    ],
    tools: [
      { id: 'leads', name: 'Lead tracking', description: 'Enquiries that came in through the public site.', builtin: 'leads' },
      { id: 'planner', name: 'Campaign planner', description: 'Plan goals, audience, channels and dates.', records: 'campaign' },
      { id: 'calendar', name: 'Campaign calendar', description: 'Every launch and end date, by day.', native: 'record-calendar' },
      { id: 'lead-stats', name: 'Lead analytics', description: 'Leads over time and by status, straight from the public-site form.', native: 'lead-stats' },
      { id: 'analytics', name: 'Analytics log', description: 'Record reach, followers, engagement and conversions with their source.', records: 'analytics_entry' },
      { id: 'reports', name: 'Reports', description: 'Write and share campaign reports.', records: 'marketing_report' },
      { id: 'url', name: 'URL parser', description: 'Inspect campaign links and parameters.', builtin: 'url' },
    ],
    channels: [{ name: '#general', description: 'Marketing team conversation.' }, { name: '#campaigns', description: 'Campaign coordination.' }, { name: '#growth', description: 'Experiments and results.' }],
    metrics: [{ label: 'Live campaigns', source: { type: 'records', kind: 'campaign', stage: 'Live' } }, { label: 'New leads (7 days)', source: { type: 'leads', days: 7 } }, { label: 'Latest reach', source: { type: 'record_field', kind: 'analytics_entry', field: 'reach' } }, { label: 'Latest engagements', source: { type: 'record_field', kind: 'analytics_entry', field: 'engagement' } }],
    onboarding: [
      { key: 'dept.marketing.planner', label: 'Open the campaign planner', description: 'See how a campaign is planned and tracked.', link: 'tool:planner' },
      { key: 'dept.marketing.leads', label: 'Look at the lead tracker', description: 'Where public-site enquiries land.', link: 'tool:leads' },
      { key: 'dept.marketing.analytics', label: 'Learn the analytics log', description: 'Numbers are entered with their source, never invented.', link: 'tool:analytics' },
    ],
  },
]

/** The eight craft departments plus Finance and Customer Service. Project assignment and record kinds use DEPARTMENTS; environments use this. */
export const ALL_DEPARTMENTS: DepartmentDef[] = [...DEPARTMENTS, ...OPERATIONS_DEPARTMENTS]
export const departmentBySlug = (slug: string | null | undefined) => ALL_DEPARTMENTS.find((d) => d.slug === slug)

export function boardOf(def: DepartmentDef, id: string | undefined) {
  return def.boards.find((b) => b.id === id)
}

export const recordKindOf = (def: DepartmentDef, kind: string | undefined) => def.recordKinds.find((k) => k.kind === kind)
export const toolOf = (def: DepartmentDef, id: string | undefined) => def.tools.find((t) => t.id === id)

/** Where a built-in tool lives. Tools under Dev tools open there; a few are first-class pages. */
export function builtinToolPath(base: '/worker' | '/admin', builtin: string): string {
  if (builtin === 'status') return `${base}/status`
  if (builtin === 'leads') return `${base}/leads`
  // Finance and Customer Service are first-class pages ('funds', 'support'), optionally with a tab: 'funds?tab=spending'.
  if (builtin === 'funds' || builtin.startsWith('funds?')) return `${base}/${builtin}`
  if (builtin === 'support' || builtin.startsWith('support?')) return `${base}/${builtin}`
  return `${base}/tools/${builtin}`
}

/** The in-app address of a department's tool page. Both workers and the Main Admin address a department by slug, since a worker can belong to several. */
export function departmentToolPath(base: '/worker' | '/admin', def: DepartmentDef, toolId: string): string {
  return base === '/worker' ? `/worker/department/${def.slug}/tool/${toolId}` : `/admin/departments/${def.slug}/tool/${toolId}`
}

/** Where activating a tool goes: an in-app route, or (for launchers) an external URL. Null when it cannot be opened yet. */
export function toolTarget(base: '/worker' | '/admin', def: DepartmentDef, tool: ToolDef, state: IntegrationState = {}): { to?: string; href?: string } | null {
  if (toolStatus(tool, state) !== 'available') return null
  if (tool.builtin) return { to: builtinToolPath(base, tool.builtin) }
  if (tool.kb) return { to: `${base}/knowledge?department=${def.slug}&category=${encodeURIComponent(tool.kb)}` }
  if (tool.external) { const href = externalUrl(tool.external, tool, state); return href ? { href } : null }
  return { to: departmentToolPath(base, def, tool.id) }
}

/**
 * Where an onboarding step points. Links are written relative to the shell so the same definition works for workers and the
 * Main Admin: `tool:id`, `section:id`, `kb:Category` or a plain page such as `chat`, `settings`, `knowledge?category=…`.
 */
export function onboardingHref(base: '/worker' | '/admin', def: DepartmentDef, link: string | undefined): string | null {
  if (!link) return null
  const home = base === '/worker' ? `/worker/department/${def.slug}` : `/admin/departments/${def.slug}`
  if (link.startsWith('tool:')) { const t = toolOf(def, link.slice(5)); return t ? (toolTarget(base, def, t)?.to ?? home) : null }
  if (link.startsWith('section:')) return `${home}?section=${link.slice(8)}`
  if (link.startsWith('kb:')) return `${base}/knowledge?department=${def.slug}&category=${encodeURIComponent(link.slice(3))}`
  return `${base}/${link}`
}
