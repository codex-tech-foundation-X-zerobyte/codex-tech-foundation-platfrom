import test from 'node:test'
import assert from 'node:assert/strict'
import { timeAgo, tenure, humanizeAction, isLongText } from '../src/lib/format.ts'

const now = new Date('2026-10-15T12:00:00Z')

test('timeAgo reads naturally at each scale', () => {
  assert.equal(timeAgo(null, now), 'never')
  assert.equal(timeAgo('2026-10-15T11:59:50Z', now), 'just now')
  assert.equal(timeAgo('2026-10-15T11:55:00Z', now), '5 minutes ago')
  assert.equal(timeAgo('2026-10-15T11:00:00Z', now), '1 hour ago')
  assert.equal(timeAgo('2026-10-12T12:00:00Z', now), '3 days ago')
  assert.match(timeAgo('2026-01-02T12:00:00Z', now), /2026/)
  assert.equal(timeAgo('not a date', now), '—')
})

test('tenure counts days, weeks, months and years', () => {
  assert.equal(tenure(null, now), null)
  assert.equal(tenure('2027-01-01', now), null)
  assert.equal(tenure('2026-10-15', now), 'Joined today')
  assert.equal(tenure('2026-10-10', now), '5 days')
  assert.equal(tenure('2026-09-24', now), '3 weeks')
  assert.equal(tenure('2026-02-15', now), '8 months')
  assert.equal(tenure('2024-06-01', now), '2 years 4 months')
  assert.equal(tenure('2025-10-15', now), '1 year')
})

test('humanizeAction and isLongText', () => {
  assert.equal(humanizeAction('task.status_changed'), 'Task status changed')
  assert.equal(humanizeAction(''), 'Activity')
  assert.ok(!isLongText('short bio')); assert.ok(isLongText('x'.repeat(300))); assert.ok(!isLongText(null))
})
