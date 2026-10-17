import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../src/pages/tools/toolsMeta'
import {
  DEPARTMENTS, COMPANY_ONBOARDING, INTEGRATIONS, boardOf, builtinToolPath, departmentBySlug, departmentToolPath, integrationStatus, isClosed, onboardingHref, toolOf, toolStatus, toolTarget,
  type DepartmentDef, type IntegrationState, type ToolDef,
} from '../../src/workspaces/definitions'
import { resolveSource } from '../../src/workspaces/records'

const SPEC_ORDER = ['Frontend Development', 'Backend Development', 'DevOps', 'Cybersecurity', 'UI/UX Design', 'Graphics & Creative', 'Content', 'Marketing']

describe('department definitions', () => {
  it('ship the eight Codex departments, in company order', () => {
    expect(DEPARTMENTS.map((d) => d.name)).toEqual(SPEC_ORDER)
  })

  it('match the departments the migration seeds (same names and slugs), so definitions and database cannot drift', () => {
    const sql = readFileSync('supabase/migrations/20260926000000_preprovisioned_departments.sql', 'utf8')
    const seeded = new Map<string, string>()
    // Only the seed lists: the `values (...) as v(name, slug)` blocks.
    for (const block of sql.matchAll(/\(values([\s\S]*?)\) as v\(name, slug\)/g)) {
      for (const m of block[1].matchAll(/\('([^']+)',\s*'([a-z0-9-]+)'\)/g)) seeded.set(m[2], m[1])
    }
    expect(seeded.size).toBe(8)
    for (const d of DEPARTMENTS) expect(seeded.get(d.slug)).toBe(d.name)
  })

  it('have unique slugs and resolve by slug', () => {
    expect(new Set(DEPARTMENTS.map((d) => d.slug)).size).toBe(DEPARTMENTS.length)
    expect(departmentBySlug('devops')?.dashboardTitle).toBe('DevOps Command Center')
    expect(departmentBySlug('nope')).toBeUndefined()
  })

  it('are distinct environments, not one dashboard with a different name', () => {
    const sig = (fn: (d: (typeof DEPARTMENTS)[number]) => unknown) => new Set(DEPARTMENTS.map((d) => JSON.stringify(fn(d)))).size
    expect(sig((d) => d.dashboardTitle)).toBe(8)
    expect(sig((d) => d.cards.map((c) => c.label))).toBe(8)
    expect(sig((d) => d.sections.map((s) => s.label))).toBe(8)
    expect(sig((d) => d.boards.map((b) => b.stages))).toBe(8)
    expect(sig((d) => d.tools.map((t) => t.id))).toBe(8)
    expect(sig((d) => d.channels.map((c) => c.name))).toBe(8)
  })

  it('give every department a real workflow, tools, channels and metrics', () => {
    for (const d of DEPARTMENTS) {
      expect(d.boards.length, d.name).toBeGreaterThan(0)
      for (const b of d.boards) expect(b.stages.length, `${d.name}/${b.id}`).toBeGreaterThanOrEqual(6)
      expect(d.tools.length, d.name).toBeGreaterThan(0)
      expect(d.channels.some((c) => c.name === '#general'), d.name).toBe(true)
      expect(d.metrics.length, d.name).toBeGreaterThan(0)
      expect(d.roles.length, d.name).toBeGreaterThan(0)
    }
  })

  it('only reference boards, tool groups, built-in tools and integrations that exist', () => {
    const builtinPages = new Set([...TOOLS.map((t) => t.id), 'status', 'leads'])
    for (const d of DEPARTMENTS) {
      for (const s of d.sections) {
        if (s.kind === 'board') expect(boardOf(d, s.boardId), `${d.name} section ${s.id}`).toBeDefined()
        if (s.toolGroup) expect(d.tools.some((t) => t.group === s.toolGroup), `${d.name} group ${s.toolGroup}`).toBe(true)
      }
      for (const t of d.tools) {
        if (t.builtin) expect(builtinPages.has(t.builtin), `${d.name} tool ${t.id} -> ${t.builtin}`).toBe(true)
        if (t.integration) expect(INTEGRATIONS[t.integration], t.id).toBeDefined()
      }
      for (const x of [...d.cards, ...d.metrics]) if (x.integration) expect(INTEGRATIONS[x.integration]).toBeDefined()
    }
  })

  it('follow the workflows in the product spec', () => {
    const stages = (slug: string, board: string) => boardOf(departmentBySlug(slug)!, board)!.stages
    expect(stages('frontend-development', 'sprint')).toEqual(['Backlog', 'Ready', 'In development', 'Code review', 'QA', 'Ready for deployment', 'Deployed'])
    expect(stages('backend-development', 'api')).toEqual(['Backlog', 'Development', 'API testing', 'Code review', 'QA', 'Staging', 'Production'])
    expect(stages('devops', 'ops')).toEqual(['Requested', 'Planned', 'Configuration', 'Testing', 'Staging', 'Deployment', 'Verified'])
    expect(stages('cybersecurity', 'operations')).toEqual(['Identified', 'Triage', 'Investigating', 'Risk assessment', 'Remediation', 'Verification', 'Closed'])
    expect(stages('graphics-creative', 'requests')).toEqual(['Request', 'Assigned', 'Designing', 'Review', 'Changes requested', 'Approved', 'Final asset'])
    expect(stages('content', 'content')).toEqual(['Idea', 'Draft', 'Review', 'Approved', 'Scheduled', 'Published'])
  })

  it('gives Cybersecurity both Security Operations and a Security Lab, with an authorised-use notice', () => {
    const sec = departmentBySlug('cybersecurity')!
    expect(sec.sections.find((s) => s.id === 'operations')?.kind).toBe('board')
    const lab = sec.sections.find((s) => s.id === 'lab')!
    expect(lab.kind).toBe('tools')
    expect(lab.notice).toMatch(/authori[sz]ed/i)
    expect(sec.tools.filter((t) => t.group === 'lab').length).toBeGreaterThanOrEqual(8)
  })

  it('routes built-in tools to the page that exists in each shell', () => {
    expect(builtinToolPath('/worker', 'json')).toBe('/worker/tools/json')
    expect(builtinToolPath('/admin', 'status')).toBe('/admin/status')
    expect(builtinToolPath('/worker', 'leads')).toBe('/worker/leads')
  })
})

/* ---- No placeholders: every tool, card and metric is backed by something real ----------------------------------------------- */

const KB_CATEGORIES = ['Company', 'Development', 'Security', 'Design', 'Content', 'Marketing', 'Operations', 'Onboarding', 'Technical Documentation', 'Policies']
const FILE_CATEGORIES = ['brand', 'media', 'final', 'versions']
const backings = (t: ToolDef) => [t.builtin, t.records, t.kb, t.files, t.native, t.external].filter(Boolean)

describe('no placeholders', () => {
  it('every tool is backed by exactly one real thing', () => {
    for (const d of DEPARTMENTS) for (const t of d.tools) expect(backings(t).length, `${d.name} / ${t.id}`).toBe(1)
  })

  it('tool ids are unique within a department', () => {
    for (const d of DEPARTMENTS) expect(new Set(d.tools.map((t) => t.id)).size, d.name).toBe(d.tools.length)
  })

  it('record tools point at record types the department defines; knowledge and file tools use real categories', () => {
    const sql = readFileSync('supabase/migrations/20260929000000_company_core.sql', 'utf8')
    const dbCategories = [...(/category in \(([^)]*)\)/.exec(sql)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(dbCategories).toEqual(KB_CATEGORIES) // the definitions and the database agree on the fixed list
    for (const d of DEPARTMENTS) for (const t of d.tools) {
      if (t.records) expect(d.recordKinds.some((k) => k.kind === t.records), `${d.name}/${t.id}`).toBe(true)
      if (t.kb) expect(KB_CATEGORIES, `${d.name}/${t.id}`).toContain(t.kb)
      if (t.files) expect(FILE_CATEGORIES, `${d.name}/${t.id}`).toContain(t.files)
      if (t.preset) for (const [k, v] of Object.entries(t.preset)) {
        const f = d.recordKinds.find((x) => x.kind === t.records)?.fields.find((x) => x.key === k)
        expect(f?.options, `${d.name}/${t.id} preset ${k}`).toContain(v)
      }
    }
  })

  it('every dashboard card and metric has a real source, a tool to open, or an integration', () => {
    for (const d of DEPARTMENTS) {
      for (const c of d.cards) {
        expect(!!(c.source || c.integration || c.tool), `${d.name} card ${c.label}`).toBe(true)
        if (c.tool) expect(toolOf(d, c.tool), `${d.name} card ${c.label} -> ${c.tool}`).toBeDefined()
      }
      for (const m of d.metrics) expect(!!(m.source || m.integration), `${d.name} metric ${m.label}`).toBe(true)
    }
  })

  it('card and metric sources point at things that exist', () => {
    for (const d of DEPARTMENTS) for (const x of [...d.cards, ...d.metrics]) {
      const src = x.source
      if (!src || src.type === 'tasks' || src.type === 'leads') continue
      const kind = d.recordKinds.find((k) => k.kind === src.kind)
      expect(kind, `${d.name} ${x.label} -> ${src.kind}`).toBeDefined()
      if (src.type === 'records') {
        if (src.stage) expect(kind!.stages, `${d.name} ${x.label}`).toContain(src.stage)
        for (const [k, v] of Object.entries(src.where ?? {})) expect(kind!.fields.find((f) => f.key === k)?.options, `${d.name} ${x.label} where ${k}`).toContain(v)
      } else expect(kind!.fields.find((f) => f.key === src.field)?.type, `${d.name} ${x.label}`).toBe('number')
    }
  })

  it('task-stage cards name a stage that is on the department board', () => {
    for (const d of DEPARTMENTS) for (const x of [...d.cards, ...d.metrics]) if (x.source?.type === 'tasks' && x.source.filter === 'stage') expect(d.boards[0].stages, `${d.name} ${x.label}`).toContain(x.source.stage)
  })

  it('a board that holds records uses the record kind\'s own stages, so the two can never disagree', () => {
    for (const d of DEPARTMENTS) for (const b of d.boards) if (b.recordKind) expect(d.recordKinds.find((k) => k.kind === b.recordKind)?.stages, `${d.name}/${b.id}`).toEqual(b.stages)
  })

  it('record kinds are valid for the database and for the form', () => {
    for (const d of DEPARTMENTS) for (const k of d.recordKinds) {
      expect(k.kind, k.kind).toMatch(/^[a-z_]{2,40}$/) // department_records.kind check
      expect(k.stages.length, k.kind).toBeGreaterThan(0)
      for (const st of k.stages) expect(st.length).toBeLessThanOrEqual(60)
      expect(new Set(k.fields.map((f) => f.key)).size, `${k.kind} field keys`).toBe(k.fields.length)
      for (const f of k.fields) {
        if (f.type === 'select') expect(f.options?.length, `${k.kind}.${f.key}`).toBeGreaterThan(0)
        if (f.showWhen) { const trig = k.fields.find((x) => x.key === f.showWhen!.key); expect(trig?.type, `${k.kind}.${f.key} trigger`).toBe('select'); for (const v of f.showWhen.in) expect(trig!.options).toContain(v) }
      }
      for (const c of k.calendar ?? []) expect(k.fields.find((f) => f.key === c.field)?.type, `${k.kind}.${c.field}`).toBe('date')
      for (const c of k.closed ?? []) expect(k.stages).toContain(c)
    }
  })

  it('onboarding keys are unique, fit the database, and every link leads somewhere', () => {
    const all = new Set<string>()
    for (const i of COMPANY_ONBOARDING) { expect(all.has(i.key)).toBe(false); all.add(i.key); expect(i.key).toMatch(/^[a-z0-9_.:-]{2,80}$/) }
    for (const d of DEPARTMENTS) {
      expect(d.onboarding.length, d.name).toBeGreaterThanOrEqual(3)
      for (const i of d.onboarding) { expect(all.has(i.key), i.key).toBe(false); all.add(i.key); expect(i.key).toMatch(/^[a-z0-9_.:-]{2,80}$/) }
      for (const i of [...COMPANY_ONBOARDING, ...d.onboarding]) if (i.link) for (const base of ['/worker', '/admin'] as const) expect(onboardingHref(base, d, i.link), `${d.name} ${i.key}`).toMatch(new RegExp(`^${base}/`))
    }
  })

  it('onboarding links resolve to the right pages', () => {
    const fe = departmentBySlug('frontend-development') as DepartmentDef
    expect(onboardingHref('/worker', fe, 'tool:docs')).toBe('/worker/knowledge?department=frontend-development&category=Development')
    expect(onboardingHref('/worker', fe, 'tool:bugs')).toBe('/worker/department/tool/bugs')
    expect(onboardingHref('/admin', fe, 'section:board')).toBe('/admin/departments/frontend-development?section=board')
    expect(onboardingHref('/worker', fe, 'settings')).toBe('/worker/settings')
    expect(onboardingHref('/worker', fe, undefined)).toBeNull()
    expect(onboardingHref('/worker', fe, 'tool:nope')).toBeNull()
  })

  it('integration-backed tools are only available once their integration is connected', () => {
    const fe = departmentBySlug('frontend-development') as DepartmentDef
    const repos = toolOf(fe, 'repos') as ToolDef
    expect(toolStatus(repos)).toBe('not_connected')
    expect(toolTarget('/worker', fe, repos)).toBeNull()
    const connected: IntegrationState = { github: { status: 'connected', config: {} } }
    expect(toolStatus(repos, connected)).toBe('available')
    expect(toolTarget('/worker', fe, repos, connected)).toEqual({ to: '/worker/department/tool/repos' })
    expect(toolStatus(repos, { github: { status: 'needs_authorization', config: {} } })).toBe('not_connected')
    expect(integrationStatus('github_actions', connected)).toBe('connected') // Actions rides on the GitHub connection
  })

  it('"Open in Figma" needs the team link as well as the integration, and only ever opens https', () => {
    const ux = departmentBySlug('ui-ux-design') as DepartmentDef
    const figma = toolOf(ux, 'figma') as ToolDef
    expect(toolStatus(figma, { figma: { status: 'connected', config: {} } })).toBe('not_connected')
    const ok: IntegrationState = { figma: { status: 'connected', config: { url: 'https://www.figma.com/files/team/1' } } }
    expect(toolTarget('/admin', ux, figma, ok)).toEqual({ href: 'https://www.figma.com/files/team/1' })
    expect(toolStatus(figma, { figma: { status: 'connected', config: { url: 'javascript:alert(1)' } } })).toBe('not_connected')
    expect(toolStatus(figma, { figma: { status: 'connected', config: { url: 'http://insecure.example' } } })).toBe('not_connected')
  })

  it('knowledge and external tools route correctly', () => {
    const be = departmentBySlug('backend-development') as DepartmentDef
    expect(toolTarget('/worker', be, toolOf(be, 'schema') as ToolDef)).toEqual({ to: '/worker/knowledge?department=backend-development&category=Technical%20Documentation' })
    expect(toolTarget('/worker', be, toolOf(be, 'logs') as ToolDef)?.href).toMatch(/^https:\/\/supabase\.com\/dashboard/)
    expect(departmentToolPath('/admin', be, 'webhooks')).toBe('/admin/departments/backend-development/tool/webhooks')
  })

  it('the Content script editor has the structured fields the spec asks for, shown only for scripts', () => {
    const c = departmentBySlug('content') as DepartmentDef
    const k = c.recordKinds.find((x) => x.kind === 'content_item')!
    const script = ['hook', 'introduction', 'main_point', 'supporting_points', 'cta', 'caption', 'hashtags']
    for (const key of script) expect(k.fields.find((f) => f.key === key)?.showWhen?.in, key).toContain('Script')
    expect(k.fields.find((f) => f.key === 'body')?.showWhen?.in).toEqual(['Article'])
  })
})

describe('dashboard numbers come from real rows', () => {
  const sec = departmentBySlug('cybersecurity') as DepartmentDef
  const data = {
    tasks: [{ status: 'todo', stage: 'Backlog' }, { status: 'in_progress', stage: 'QA' }, { status: 'done', stage: 'QA' }],
    records: [
      { kind: 'security_issue', stage: 'Triage', fields: { type: 'Vulnerability' } },
      { kind: 'security_issue', stage: 'Closed', fields: { type: 'Vulnerability' } },
      { kind: 'security_issue', stage: 'Remediation', fields: { type: 'Incident' } },
      { kind: 'analytics_entry', stage: 'Entered', fields: { followers: 100 }, created_at: '2026-10-01T00:00:00Z' },
      { kind: 'analytics_entry', stage: 'Entered', fields: { followers: 150, source: 'LinkedIn' }, created_at: '2026-10-08T00:00:00Z' },
    ],
    leads: { 7: 3 },
  }
  const kinds = DEPARTMENTS.flatMap((d) => d.recordKinds)
  const n = (src: Parameters<typeof resolveSource>[1]) => resolveSource(kinds, src, data)

  it('counts open records by default, treating the last stage as finished', () => {
    expect(n({ type: 'records', kind: 'security_issue', where: { type: 'Vulnerability' } }).value).toBe(1) // the Closed one is not open
    expect(n({ type: 'records', kind: 'security_issue', where: { type: 'Vulnerability' }, all: true }).value).toBe(2)
    expect(n({ type: 'records', kind: 'security_issue', stage: 'Remediation' }).value).toBe(1)
    expect(isClosed(sec.recordKinds[0], 'Closed')).toBe(true)
  })
  it('counts open tasks, optionally in one stage', () => {
    expect(n({ type: 'tasks', filter: 'open' }).value).toBe(2)
    expect(n({ type: 'tasks', filter: 'stage', stage: 'QA' }).value).toBe(1)
  })
  it('reports the latest figure someone entered, with where it came from, and nothing when none was entered', () => {
    const r = n({ type: 'record_field', kind: 'analytics_entry', field: 'followers' })
    expect(r.value).toBe(150)
    expect(r.note).toMatch(/LinkedIn/)
    expect(n({ type: 'record_field', kind: 'analytics_entry', field: 'reach' }).value).toBeNull()
  })
  it('lead counts come from the lead query; a window nobody asked for is "no data", never a made-up zero', () => {
    expect(n({ type: 'leads', days: 7 }).value).toBe(3)
    expect(n({ type: 'leads', days: 30 }).value).toBeNull()
  })
})
