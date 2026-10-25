import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const POSTURE = {
  generated_at: '2026-09-30T00:00:00Z', table_count: 40, policy_count: 120, tables_without_rls: [] as string[], tables_rls_without_policies: [] as string[],
  public_buckets: ['public-content'], private_buckets: ['chat-media'], definer_functions_without_search_path: [] as string[],
  accounts: { total: 9, superadmins: 2, workers: 4, clients: 3, suspended_workers: 0, suspended_clients: 0, must_change_password: 0 },
  activity: { failed_logins_24h: 0, failed_logins_7d: 0, warnings_24h: 0, errors_24h: 0, events_7d: 10 },
}
let posture: { data: unknown; error: Error | null } = { data: POSTURE, error: null }
let scan: { data: unknown; error: Error | null } = { data: { generated_at: '', providers: [] }, error: null }
const GITHUB_SETUP = 'supabase secrets set GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner>/<repo>'

vi.mock('../../src/lib/services', () => ({
  getSecurityPosture: async () => posture,
  getIntegrationScan: async () => scan,
  listAuditLogs: async () => ({ data: [], error: null }),
}))

import { AdminSecurity } from '../../src/pages/admin/AdminSecurity'

const section = (name: string) => screen.getByRole('region', { name })

describe('Security monitor page', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcd.supabase.co')
    posture = { data: POSTURE, error: null }
    scan = { data: { generated_at: '', providers: [
      { provider: 'github', label: 'GitHub', configured: false, findings: [], setup: GITHUB_SETUP },
      { provider: 'vercel', label: 'Vercel', configured: false, findings: [], setup: 'supabase secrets set VERCEL_TOKEN=<token>' },
      { provider: 'headers', label: 'Website headers', configured: true, findings: [{ id: 'hdr-csp', title: 'No Content-Security-Policy', status: 'warn', detail: 'Nothing limits what XSS could load.', fix: 'Add it in vercel.json under "headers".' }] },
    ] }, error: null }
  })

  it('shows a clean bill of health when every connected check passes', async () => {
    scan = { data: { generated_at: '', providers: [] }, error: null }
    render(<AdminSecurity />)
    expect(await screen.findByText('Nothing needs attention')).toBeTruthy()
    expect(screen.getByRole('img', { name: /score 100 out of 100, grade A/ })).toBeTruthy()
  })

  it('surfaces a missing-RLS table as action needed, with the exact SQL, and drops the score', async () => {
    posture = { data: { ...POSTURE, tables_without_rls: ['invoices'] }, error: null }
    render(<AdminSecurity />)
    expect(await screen.findByText('1 thing needs action now')).toBeTruthy()
    const attention = screen.getByRole('heading', { name: /needs attention/i }).closest('section')!
    expect(within(attention).getByText(/1 table without Row Level Security/)).toBeTruthy()
    expect(within(attention).getByText(/alter table public\.invoices enable row level security;/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /score 80 out of 100/ })).toBeTruthy()
  })

  it('unconnected providers say so and give the exact setup commands, with a copy button', async () => {
    render(<AdminSecurity />)
    const github = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(github).getByText('Not connected')).toBeTruthy()
    expect(within(github).getByText(GITHUB_SETUP)).toBeTruthy()
    expect(within(github).getByRole('button', { name: /copy commands/i })).toBeTruthy()
  })

  it('one failing source does not blank the others (the integration scan being undeployed leaves the database report intact)', async () => {
    scan = { data: null, error: new Error('The security-monitor function is not deployed yet. Run: supabase functions deploy security-monitor') }
    render(<AdminSecurity />)
    expect(await within(await screen.findByRole('region', { name: 'Database & storage' })).findByText('Row Level Security is on for every table')).toBeTruthy()
    expect(within(section('GitHub')).getByText(/not deployed yet/i)).toBeTruthy() // an honest, specific message per source
  })

  it('findings with a fix show it; non-counted "unavailable" checks do not lower the score', async () => {
    scan = { data: { generated_at: '', providers: [{ provider: 'github', label: 'GitHub', configured: true, findings: [{ id: 'gh-code', title: 'Code scanning', status: 'unavailable', detail: 'GitHub answered 403.', fix: 'Grant "Code scanning alerts: read".' }] }] }, error: null }
    render(<AdminSecurity />)
    expect(await screen.findByText(/Grant "Code scanning alerts: read"/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /score 100/ })).toBeTruthy()
  })
})
