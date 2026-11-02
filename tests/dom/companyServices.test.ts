import { describe, expect, it, vi } from 'vitest'

const cfg: { rows: unknown[]; error: { code?: string; message: string } | null } = { rows: [], error: null }
vi.mock('../../src/lib/supabase', () => {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'in', 'order', 'limit', 'gte']) b[m] = () => b
  b.then = (resolve: (v: unknown) => void) => resolve({ data: cfg.rows, error: cfg.error, status: 200 })
  return { supabase: { from: () => b, functions: { invoke: async () => ({ data: null, error: null }) }, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {} } }
})

import { createMeeting, sanitizeSearch } from '../../src/lib/services/company'
import { classifyGithubUrl } from '../../src/lib/services/people'
import { saveWhiteboard, validateLaunchUrl, webhookUrl } from '../../src/lib/services/integrations'
import { summariseLeads } from '../../src/lib/leadStats'

describe('knowledge search', () => {
  it('strips characters that could change a PostgREST filter, and caps the length', () => {
    expect(sanitizeSearch('a,b(c)*%_\\d')).toBe('a b c d')
    expect(sanitizeSearch('  deploy   guide ')).toBe('deploy guide')
    expect(sanitizeSearch('x'.repeat(200)).length).toBe(80)
    expect(sanitizeSearch('title.eq.1),or(id.neq.0')).not.toMatch(/[(),]/)
  })
})

describe('task GitHub links', () => {
  it('classifies pull requests, issues, branches and commits', () => {
    expect(classifyGithubUrl('https://github.com/codex/web/pull/42')).toEqual({ kind: 'pull_request', label: 'codex/web#42' })
    expect(classifyGithubUrl('https://github.com/codex/web/issues/7')).toEqual({ kind: 'issue', label: 'codex/web#7' })
    expect(classifyGithubUrl('https://github.com/codex/web/tree/feature/auth-ui')).toEqual({ kind: 'branch', label: 'codex/web:feature/auth-ui' })
    expect(classifyGithubUrl('https://github.com/codex/web/commit/abcdef1234567')).toEqual({ kind: 'commit', label: 'codex/web@abcdef1' })
    expect(classifyGithubUrl('https://github.com/codex/web')?.kind).toBe('other')
  })
  it('refuses anything that is not a real github.com https link', () => {
    for (const bad of ['http://github.com/a/b/pull/1', 'https://github.com.evil.example/a/b/pull/1', 'https://evil.example/github.com/a/b', 'javascript:alert(1)', 'https://github.com/', 'https://github.com/onlyowner', 'not a url', '']) expect(classifyGithubUrl(bad), bad).toBeNull()
  })
})

describe('Figma and Canva launch links', () => {
  it('accept only https links on the provider\'s own domain', () => {
    expect(validateLaunchUrl('figma', 'https://www.figma.com/files/team/1/Codex')).toBeNull()
    expect(validateLaunchUrl('figma', 'https://figma.com/files')).toBeNull()
    expect(validateLaunchUrl('canva', 'https://www.canva.com/folder/abc')).toBeNull()
  })
  it('reject lookalikes, other providers, plain http and junk', () => {
    expect(validateLaunchUrl('figma', 'https://figma.com.evil.example/x')).toMatch(/not a Figma/)
    expect(validateLaunchUrl('figma', 'https://notfigma.com/x')).toMatch(/not a Figma/)
    expect(validateLaunchUrl('figma', 'https://www.canva.com/x')).toMatch(/not a Figma/)
    expect(validateLaunchUrl('canva', 'http://www.canva.com/x')).toMatch(/https/)
    expect(validateLaunchUrl('canva', 'javascript:alert(1)')).toBeTruthy()
    expect(validateLaunchUrl('canva', 'canva')).toMatch(/full link/)
  })
})

describe('webhook url', () => {
  it('points at the inbox function with the token, tolerating a trailing slash', () => {
    expect(webhookUrl('tok', 'https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1/webhook-inbox/tok')
    expect(webhookUrl('tok', 'https://abc.supabase.co')).toBe('https://abc.supabase.co/functions/v1/webhook-inbox/tok')
  })
})

describe('whiteboard saving', () => {
  it('reports a conflict when someone else saved first (no row matched), and does not report an error', async () => {
    cfg.rows = []; cfg.error = null
    expect(await saveWhiteboard('b', 3, { shapes: [] })).toMatchObject({ conflict: true, error: null, version: null })
  })
  it('treats the database\'s version-conflict error the same way', async () => {
    cfg.rows = []; cfg.error = { code: '40001', message: 'changed while you were editing' }
    expect(await saveWhiteboard('b', 3, { shapes: [] })).toMatchObject({ conflict: true, error: null })
  })
  it('returns the new version on success and a real error otherwise', async () => {
    cfg.rows = [{ version: 4 }]; cfg.error = null
    expect(await saveWhiteboard('b', 3, { shapes: [] })).toMatchObject({ conflict: false, version: 4 })
    cfg.rows = []; cfg.error = { code: '42501', message: 'denied' }
    const r = await saveWhiteboard('b', 3, { shapes: [] })
    expect(r.conflict).toBe(false)
    expect(r.error?.message).toMatch(/permission/)
  })
})

describe('lead statistics', () => {
  const now = new Date('2026-10-14T12:00:00Z') // a Wednesday
  it('buckets leads into Monday-based weeks, newest week last, and counts by status', () => {
    const s = summariseLeads([
      { status: 'new', created_at: '2026-10-13T09:00:00Z' }, { status: 'new', created_at: '2026-10-14T09:00:00Z' },
      { status: 'won', created_at: '2026-10-06T09:00:00Z' }, { status: 'new', created_at: '2026-01-01T00:00:00Z' },
    ], now)
    expect(s.buckets).toHaveLength(13)
    expect(s.buckets.at(-1)!.count).toBe(2)
    expect(s.buckets.at(-2)!.count).toBe(1)
    expect(s.byStatus).toEqual({ new: 3, won: 1 })
    expect(s.total).toBe(4)
  })
  it('is all zeros for no leads', () => {
    const s = summariseLeads([], now)
    expect(s.buckets.every((b) => b.count === 0)).toBe(true)
    expect(s.total).toBe(0)
  })
})

describe('meetings', () => {
  const base = { title: 'Planning', starts_at: '2026-10-20T10:00:00.000Z', ends_at: '2026-10-20T11:00:00.000Z', location: '', agenda: '', department_id: null, project_id: null, participants: [] }
  it('refuses a meeting that ends before it starts, and one with no title, before touching the database', async () => {
    cfg.rows = []; cfg.error = null
    expect((await createMeeting({ ...base, ends_at: '2026-10-20T09:00:00.000Z' })).error?.message).toMatch(/end after it starts/)
    expect((await createMeeting({ ...base, ends_at: base.starts_at })).error?.message).toMatch(/end after it starts/)
    expect((await createMeeting({ ...base, title: '   ' })).error?.message).toMatch(/title/)
  })
})

import { BLOCKED_STATUSES, isBlockedStatus, takeAccountNotice } from '../../src/lib/accountStatus'

describe('ending access for blocked accounts', () => {
  it('treats exactly the statuses the database denies as blocked, and everything else as in good standing', () => {
    for (const st of ['suspended', 'banned', 'inactive', 'review', 'offboarded']) expect(isBlockedStatus(st), st).toBe(true)
    for (const st of ['active', 'invited', 'suspension_pending', '', null, undefined]) expect(isBlockedStatus(st as string), String(st)).toBe(false)
    expect(BLOCKED_STATUSES).toHaveLength(5)
  })
  it('shows the sign-in notice once, then forgets it', () => {
    sessionStorage.setItem('ctf-account-notice', 'Your account is not active. Please contact your administrator.')
    expect(takeAccountNotice()).toMatch(/not active/)
    expect(takeAccountNotice()).toBe('')
  })
})

import { workerStatusInfo } from '../../src/lib/workerStatus'
describe('worker status display', () => {
  it('leaves the middle of the lifecycle to the case, and offers the right direct action elsewhere', () => {
    expect(workerStatusInfo('active')).toMatchObject({ label: 'Active', action: 'suspend', managedByCase: false })
    expect(workerStatusInfo('invited')).toMatchObject({ label: 'Invited', action: 'suspend' })
    expect(workerStatusInfo('suspended')).toMatchObject({ action: 'reactivate', tone: 'danger' })
    for (const st of ['suspension_pending', 'review']) expect(workerStatusInfo(st)).toMatchObject({ action: null, managedByCase: true })
    expect(workerStatusInfo('offboarded')).toMatchObject({ label: 'Offboarded', action: null, managedByCase: false })
    expect(workerStatusInfo('something_new')).toMatchObject({ label: 'something new', action: null })
  })
})
