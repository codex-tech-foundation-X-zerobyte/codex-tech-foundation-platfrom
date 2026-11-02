import { describe, expect, it } from 'vitest'
import { actionsFor, reviewStageFor, stageOf, money, type Viewer, type RequestLike } from '../../src/lib/fundWorkflow'
import { agentStats, dueLabel, isOverdue, newProjectKey, sha256Hex } from '../../src/lib/supportRules'

const req = (o: Partial<RequestLike> = {}): RequestLike => ({ requester_id: 'maya', department_id: 'fe', status: 'finance_review', ...o })
const viewer = (o: Partial<Viewer> = {}): Viewer => ({ id: 'me', isMainAdmin: false, isFinanceManager: false, adminOf: [], ...o })

describe('fund workflow: who is offered which review', () => {
  it('maps statuses to stages', () => {
    expect(stageOf('finance_review')).toBe('finance'); expect(stageOf('department_review')).toBe('department'); expect(stageOf('awaiting_super_admin')).toBe('super_admin'); expect(stageOf('approved')).toBeNull()
  })
  it('offers the Finance review only to a Finance Manager, never to a plain Finance member or the requester', () => {
    expect(reviewStageFor(req(), viewer({ isFinanceManager: true }))).toBe('finance')
    expect(reviewStageFor(req(), viewer())).toBeNull()
    expect(reviewStageFor(req({ requester_id: 'me' }), viewer({ isFinanceManager: true }))).toBeNull()
  })
  it("offers the department review to that department's admin only, and not before Finance has reviewed", () => {
    expect(reviewStageFor(req({ status: 'department_review' }), viewer({ adminOf: ['fe'] }))).toBe('department')
    expect(reviewStageFor(req({ status: 'department_review' }), viewer({ adminOf: ['be'] }))).toBeNull()
    expect(reviewStageFor(req({ status: 'finance_review' }), viewer({ adminOf: ['fe'] }))).toBeNull()
  })
  it('offers the final decision to the Main Admin only, and only once both reviews are done', () => {
    expect(reviewStageFor(req({ status: 'awaiting_super_admin' }), viewer({ isMainAdmin: true }))).toBe('super_admin')
    expect(reviewStageFor(req({ status: 'awaiting_super_admin' }), viewer({ isFinanceManager: true, adminOf: ['fe'] }))).toBeNull()
    expect(reviewStageFor(req({ status: 'finance_review' }), viewer({ isMainAdmin: true }))).toBeNull()
  })
})

describe('fund workflow: actions', () => {
  it('lets the requester edit and submit only while it is a draft or returned', () => {
    expect(actionsFor(req({ requester_id: 'me', status: 'draft' }), viewer()).edit).toBe(true)
    expect(actionsFor(req({ requester_id: 'me', status: 'returned' }), viewer()).submit).toBe(true)
    expect(actionsFor(req({ requester_id: 'me', status: 'finance_review' }), viewer()).edit).toBe(false)
    expect(actionsFor(req({ requester_id: 'me', status: 'approved' }), viewer()).edit).toBe(false)
  })
  it('never offers payment actions to the requester, even a Finance Manager paying their own request', () => {
    const a = actionsFor(req({ requester_id: 'me', status: 'approved' }), viewer({ isFinanceManager: true }))
    expect(a.beginPayment).toBe(false)
    expect(actionsFor(req({ status: 'approved' }), viewer({ isFinanceManager: true })).beginPayment).toBe(true)
    expect(actionsFor(req({ status: 'approved' }), viewer()).beginPayment).toBe(false)
  })
  it('does not offer to record a payment before one is started: approval alone is not payment', () => {
    expect(actionsFor(req({ status: 'approved' }), viewer({ isMainAdmin: true })).recordPayment).toBe(false)
    expect(actionsFor(req({ status: 'payment_processing' }), viewer({ isMainAdmin: true })).recordPayment).toBe(true)
  })
  it('offers reconciliation to someone other than whoever recorded the payment; reversal to the Main Admin only', () => {
    expect(actionsFor(req({ status: 'paid', payment_recorded_by: 'me' }), viewer({ isFinanceManager: true })).reconcile).toBe(false)
    expect(actionsFor(req({ status: 'paid', payment_recorded_by: 'other' }), viewer({ isFinanceManager: true })).reconcile).toBe(true)
    expect(actionsFor(req({ status: 'paid' }), viewer({ isFinanceManager: true })).reverse).toBe(false)
    expect(actionsFor(req({ status: 'paid' }), viewer({ isMainAdmin: true })).reverse).toBe(true)
  })
  it('formats money with its currency', () => {
    expect(money(100000, 'NGN')).toMatch(/100,000/); expect(money('45000.5', 'NGN')).toMatch(/45,000\.50/); expect(money(5, 'ZZZ9')).toContain('5')
  })
})

describe('support rules', () => {
  const now = Date.parse('2026-10-22T12:00:00Z')
  const t = (o: Record<string, unknown> = {}) => ({ status: 'open' as const, due_at: '2026-10-22T10:00:00Z', first_response_at: null, ...o })
  it('flags tickets past their first-response target, but not answered or closed ones', () => {
    expect(isOverdue(t(), now)).toBe(true)
    expect(isOverdue(t({ first_response_at: '2026-10-22T09:00:00Z' }), now)).toBe(false)
    expect(isOverdue(t({ status: 'resolved' }), now)).toBe(false)
    expect(isOverdue(t({ due_at: '2026-10-22T13:00:00Z' }), now)).toBe(false)
  })
  it('says how overdue or how long is left', () => {
    expect(dueLabel(t(), now)).toEqual({ text: 'Overdue by 2h 0m', tone: 'danger' })
    expect(dueLabel(t({ due_at: '2026-10-22T14:30:00Z' }), now)).toEqual({ text: 'Reply within 2h 30m', tone: 'warning' })
    expect(dueLabel(t({ due_at: '2026-10-25T12:00:00Z' }), now).text).toBe('Reply within 3 days')
    expect(dueLabel(t({ status: 'closed' }), now).text).toBe('Closed')
  })
  it('measures agents on response time, resolution time and customer rating, not just how many tickets they closed', () => {
    const base = { status: 'resolved' as const, due_at: '', assignee_id: 'a1', created_at: '2026-10-20T00:00:00Z' }
    const stats = agentStats([
      { ...base, first_response_at: '2026-10-20T02:00:00Z', resolved_at: '2026-10-20T10:00:00Z', rating: 5 },
      { ...base, first_response_at: '2026-10-20T04:00:00Z', resolved_at: '2026-10-21T00:00:00Z', rating: 3 },
      { ...base, assignee_id: 'a2', first_response_at: '2026-10-20T01:00:00Z', resolved_at: '2026-10-20T02:00:00Z', rating: null },
      { ...base, assignee_id: null, first_response_at: null, resolved_at: null, rating: null },
    ], new Map([['a1', 'Ada'], ['a2', 'Bo']]))
    expect(stats[0]).toMatchObject({ agent: 'Ada', handled: 2, resolved: 2, avgFirstResponseH: 3, avgResolutionH: 17, avgRating: 4, rated: 2 })
    expect(stats[1]).toMatchObject({ agent: 'Bo', avgRating: null, rated: 0 })
    expect(stats).toHaveLength(2)   // an unassigned ticket belongs to no agent
  })
  it('makes unguessable project keys and hashes them the way the edge function does', async () => {
    const a = newProjectKey(), b = newProjectKey()
    expect(a.key).toMatch(/^ctfs_[0-9a-f]{48}$/); expect(a.key).not.toBe(b.key); expect(a.key.startsWith(a.prefix)).toBe(true)
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')   // the standard SHA-256 test vector
  })
})
