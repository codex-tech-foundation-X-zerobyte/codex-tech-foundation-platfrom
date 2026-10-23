import test from 'node:test'
import assert from 'node:assert/strict'
import { monthGrid, groupByDate, monthRange, eventsFromRecords } from '../src/lib/calendar.ts'
import { isClosed, DEPARTMENTS } from '../src/workspaces/definitions.ts'
const kinds = new Map(DEPARTMENTS.flatMap((d) => d.recordKinds).map((k) => [k.kind, k]))
const lookup = (k) => kinds.get(k)

test('monthGrid is Monday-first, fills whole weeks and marks days outside the month', () => {
  const weeks = monthGrid(2026, 9) // October 2026 starts on a Thursday
  assert.ok(weeks.every((w) => w.length === 7))
  assert.equal(weeks[0][0].date, '2026-09-28')
  assert.equal(weeks[0][0].inMonth, false)
  assert.equal(weeks[0][3].date, '2026-10-01')
  assert.equal(weeks[0][3].inMonth, true)
  const days = weeks.flat().filter((d) => d.inMonth)
  assert.equal(days.length, 31)
  assert.equal(days.at(-1).date, '2026-10-31')
})

test('monthGrid handles a month that starts on Monday and February in a leap year', () => {
  assert.equal(monthGrid(2026, 5)[0][0].date, '2026-06-01') // June 2026 starts on a Monday
  assert.equal(monthGrid(2028, 1).flat().filter((d) => d.inMonth).length, 29)
})

test('groupByDate orders each day by time, with untimed items last', () => {
  const m = groupByDate([
    { id: 'a', date: '2026-10-05', title: 'Untimed', group: 'task' },
    { id: 'b', date: '2026-10-05', time: '14:00', title: 'Afternoon', group: 'meeting' },
    { id: 'c', date: '2026-10-05', time: '09:30', title: 'Morning', group: 'meeting' },
    { id: 'd', date: '2026-10-06', title: 'Next day', group: 'deadline' },
  ])
  assert.deepEqual(m.get('2026-10-05').map((e) => e.title), ['Morning', 'Afternoon', 'Untimed'])
  assert.equal(m.get('2026-10-06').length, 1)
})

test('monthRange spans first to last day', () => {
  assert.deepEqual(monthRange(2026, 1), { from: '2026-02-01', to: '2026-02-28' })
})

test('eventsFromRecords reads each kind\'s own date fields, ignores out-of-range dates and finished items', () => {
  const recs = [
    { id: '1', kind: 'content_item', title: 'Launch script', stage: 'Scheduled', fields: { publish_on: '2026-10-12' }, due_date: null },
    { id: '2', kind: 'content_item', title: 'Old post', stage: 'Published', fields: { publish_on: '2026-10-03' }, due_date: null },
    { id: '3', kind: 'campaign', title: 'Autumn push', stage: 'Live', fields: { start_on: '2026-10-01', end_on: '2026-10-31' }, due_date: null },
    { id: '4', kind: 'domain', title: 'codex.dev', stage: 'Watching', fields: { expires_on: '2026-10-20', ssl_expires_on: '2027-01-01' }, due_date: null },
    { id: '5', kind: 'creative_request', title: 'Banner', stage: 'Designing', fields: {}, due_date: '2026-10-09' },
    { id: '6', kind: 'unknown_kind', title: 'x', stage: 's', fields: { publish_on: '2026-10-10' }, due_date: null },
  ]
  const ev = eventsFromRecords(recs, '2026-10-01', '2026-10-31', lookup, isClosed)
  const key = (e) => `${e.title}|${e.date}|${e.detail}`
  assert.deepEqual(ev.map(key).sort(), [
    'Autumn push|2026-10-01|Campaign · Campaign starts',
    'Autumn push|2026-10-31|Campaign · Campaign ends',
    'Banner|2026-10-09|Creative request · Due',
    'Launch script|2026-10-12|Content · Publishing',
    'codex.dev|2026-10-20|Domain · Domain expires',
  ].sort())
})
