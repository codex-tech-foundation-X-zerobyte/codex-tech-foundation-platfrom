import { supabase } from '../supabase'
import { toError } from './shared'
import { resolveSource, type StatsData } from '../../workspaces/records'
import type { DepartmentDef, IntegrationState, MetricDef, Source } from '../../workspaces/definitions'

/** Everything the dashboard needs for its numbers, in a few reads. Leads are only fetched if a card or metric asks for them. */
export async function loadDepartmentStats(def: DepartmentDef, departmentId: string) {
  const sources: Source[] = [...def.cards, ...def.metrics].flatMap((c) => (c.source ? [c.source] : []))
  const leadWindows = Array.from(new Set(sources.filter((s) => s.type === 'leads').map((s) => (s as Extract<Source, { type: 'leads' }>).days ?? 0)))
  const wantsFunds = sources.some((s) => s.type === 'funds')
  const wantsTickets = sources.some((s) => s.type === 'tickets')
  const [tasks, records, funds, tickets, ...leads] = await Promise.all([
    supabase.from('tasks').select('status, stage').eq('department_id', departmentId).limit(2000),
    supabase.from('department_records').select('kind, stage, fields, created_at').eq('department_id', departmentId).limit(3000),
    wantsFunds ? supabase.from('fund_requests').select('status').limit(3000) : Promise.resolve({ data: undefined, error: null }),
    wantsTickets ? supabase.from('support_tickets').select('status, due_at, assignee_id, first_response_at').limit(3000) : Promise.resolve({ data: undefined, error: null }),
    ...leadWindows.map((days) => {
      const q = supabase.from('leads').select('id', { count: 'exact', head: true })
      return days > 0 ? q.gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString()) : q
    }),
  ])
  const error = tasks.error ?? records.error ?? funds.error ?? tickets.error ?? leads.find((l) => l.error)?.error
  const data: StatsData = {
    tasks: (tasks.data ?? []) as StatsData['tasks'],
    records: (records.data ?? []) as StatsData['records'],
    leads: Object.fromEntries(leadWindows.map((d, i) => [d, leads[i].count ?? 0])),
    funds: funds.data as StatsData['funds'],
    tickets: tickets.data as StatsData['tickets'],
  }
  return { data: error ? null : data, error: error ? toError(error) : null }
}

export const resolveMetric = (def: DepartmentDef, item: { source?: Source } | MetricDef, data: StatsData) => (item.source ? resolveSource(def.recordKinds, item.source, data) : null)

export async function loadIntegrationState() {
  const { data, error } = await supabase.from('integrations').select('provider, status, config')
  if (error) return { data: {} as IntegrationState, error: toError(error) }
  const state: IntegrationState = {}
  for (const r of data ?? []) {
    const p = r.provider as string
    if (p === 'github' || p === 'figma' || p === 'canva') state[p] = { status: r.status, config: (r.config ?? {}) as Record<string, unknown> }
  }
  return { data: state, error: null }
}

export interface DepartmentChannel { id: string; name: string }
export async function listDepartmentChannels(departmentId: string) {
  const { data, error } = await supabase.from('chat_channels').select('id, name').eq('department_id', departmentId).order('name')
  return { data: (data ?? []) as DepartmentChannel[], error: error ? toError(error) : null }
}
