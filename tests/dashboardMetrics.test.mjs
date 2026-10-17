import test from 'node:test'
import assert from 'node:assert/strict'
import { startOfDay, daysBetween, relativeDay, greeting, summariseTasks, dailyCounts, milestoneProgress, tally, overdueProjects } from '../src/lib/dashboardMetrics.ts'

const NOW = new Date(2026, 8, 30, 14, 30).getTime() // 30 Sep 2026, 14:30 local
const day = (offset) => { const d = new Date(2026, 8, 30 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const task = (over) => ({ id: Math.random().toString(36), assignee_id: 'me', status: 'todo', priority: 'normal', due_date: null, completed_at: null, project_id: 'p', title: 't', ...over })

test('a bare date is a LOCAL calendar day (not UTC midnight, which is "yesterday" west of Greenwich)', () => {
  assert.equal(startOfDay('2026-09-30'), new Date(2026, 8, 30).getTime())
  assert.equal(daysBetween(NOW, '2026-09-30'), 0)
})
test('relative days read naturally', () => {
  assert.deepEqual([0, 1, -1, 5, -3].map((o) => relativeDay(day(o), NOW)), ['Today', 'Tomorrow', 'Yesterday', 'in 5 days', '3 days ago'])
})
test('greeting follows the hour and uses the first name', () => {
  const at = (h) => new Date(2026, 8, 30, h).getTime()
  assert.deepEqual([2, 9, 14, 20].map((h) => greeting(at(h), 'Ada Lovelace')), ['Working late, Ada', 'Good morning, Ada', 'Good afternoon, Ada', 'Good evening, Ada'])
  assert.equal(greeting(at(9), '  '), 'Good morning')
})

test('a task due TODAY is not overdue; yesterday is', () => {
  const s = summariseTasks([task({ due_date: day(0) }), task({ due_date: day(-1) })], 'me', NOW)
  assert.equal(s.overdue.length, 1); assert.equal(s.dueSoon.length, 1)
})
test('only MY open tasks count; done and other people\'s tasks do not', () => {
  const s = summariseTasks([task({}), task({ status: 'done' }), task({ assignee_id: 'someone-else' }), task({ assignee_id: null })], 'me', NOW)
  assert.equal(s.mine.length, 1)
})
test('due-soon window is today through 7 days; day 8 is outside', () => {
  const s = summariseTasks([task({ due_date: day(7) }), task({ due_date: day(8) })], 'me', NOW)
  assert.equal(s.dueSoon.length, 1)
})
test('focus list: overdue first (oldest first), then soonest, ties broken by priority', () => {
  const a = task({ title: 'overdue-3', due_date: day(-3) }), b = task({ title: 'overdue-1', due_date: day(-1) })
  const c = task({ title: 'soon-low', due_date: day(2), priority: 'low' }), d = task({ title: 'soon-urgent', due_date: day(2), priority: 'urgent' }), e = task({ title: 'today', due_date: day(0) })
  assert.deepEqual(summariseTasks([c, d, e, b, a], 'me', NOW).focus.map((t) => t.title), ['overdue-3', 'overdue-1', 'today', 'soon-urgent', 'soon-low'])
})
test('blocked tasks are surfaced, and with no signed-in user nothing is "mine"', () => {
  assert.equal(summariseTasks([task({ status: 'blocked' })], 'me', NOW).blocked.length, 1)
  assert.equal(summariseTasks([task({})], undefined, NOW).mine.length, 0)
})

test('completions per day: last bucket is today, old ones fall off, nulls ignored', () => {
  const iso = (offset, h = 10) => new Date(2026, 8, 30 + offset, h).toISOString()
  const c = dailyCounts([iso(0), iso(0, 23), iso(-1), iso(-13), iso(-14), iso(1), null], 14, NOW)
  assert.equal(c.length, 14); assert.equal(c[13], 2); assert.equal(c[12], 1); assert.equal(c[0], 1)
  assert.equal(c.reduce((a, b) => a + b, 0), 4) // -14 days and tomorrow excluded
})

test('milestone progress: complete counts 100, partial counts its percentage, none -> null (no invented progress)', () => {
  assert.equal(milestoneProgress([]), null)
  assert.deepEqual(milestoneProgress([{ project_id: 'p', status: 'complete', percentage: 0 }, { project_id: 'p', status: 'in_progress', percentage: 50 }]), { percent: 75, done: 1, total: 2 })
  assert.equal(milestoneProgress([{ project_id: 'p', status: 'in_progress', percentage: 400 }]).percent, 100) // clamped
  assert.equal(milestoneProgress([{ project_id: 'p', status: 'x', percentage: -20 }]).percent, 0)
})
test('tally', () => assert.deepEqual(tally(['a', 'b', 'a'], (x) => x), { a: 2, b: 1 }))
test('overdue projects exclude finished and archived ones and ones without a due date', () => {
  const p = (status, due_date) => ({ id: status + due_date, status, due_date })
  assert.equal(overdueProjects([p('active', day(-2)), p('completed', day(-2)), p('archived', day(-2)), p('active', null), p('active', day(0)), p('paused', day(-1))], NOW).length, 2)
})
