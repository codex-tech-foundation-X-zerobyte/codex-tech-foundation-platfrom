import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReport, findSensitive, sha256Hex, KEY_SHAPE, LIMITS } from '../supabase/functions/_shared/supportIntake.ts'

const ok = (o) => { const r = parseReport(o); assert.ok(r.ok, JSON.stringify(r)); return r.report }

test('accepts a normal report and trims it', () => {
  const r = ok({ external_ref: ' ORD-77 ', subject: '  Cannot log in ', description: 'It fails.', customer_ref: 'u9', customer_name: 'Ada', category: 'Account', priority: 'HIGH' })
  assert.deepEqual(r, { external_ref: 'ORD-77', customer_ref: 'u9', customer_name: 'Ada', subject: 'Cannot log in', description: 'It fails.', category: 'account', priority: 'high' })
})
test('requires an external_ref (without one a retry would create a duplicate) and a real subject', () => {
  assert.match(parseReport({ subject: 'Something broke' }).error, /external_ref/)
  assert.match(parseReport({ external_ref: 'x', subject: 'no' }).error, /subject/)
})
test('rejects non-objects and arrays', () => {
  for (const bad of [null, 'text', 5, [], undefined]) assert.equal(parseReport(bad).ok, false)
})
test('unknown categories and priorities fall back to defaults instead of failing', () => {
  const r = ok({ external_ref: 'x', subject: 'Some subject', category: 'weird', priority: 'whenever' })
  assert.equal(r.category, 'other'); assert.equal(r.priority, 'normal')
})
test('enforces field lengths', () => {
  assert.equal(parseReport({ external_ref: 'x'.repeat(LIMITS.externalRef + 1), subject: 'Subject' }).ok, false)
  assert.equal(parseReport({ external_ref: 'x', subject: 'x'.repeat(LIMITS.subject + 1) }).ok, false)
  assert.equal(parseReport({ external_ref: 'x', subject: 'Subject', description: 'x'.repeat(LIMITS.description + 1) }).ok, false)
})
test('non-string fields are ignored, not crashed on', () => {
  const r = ok({ external_ref: 'x', subject: 'Subject', description: { a: 1 }, customer_name: 42 })
  assert.equal(r.description, ''); assert.equal(r.customer_name, '')
})
test('refuses to store card numbers, secret keys, tokens and passwords', () => {
  assert.match(findSensitive({ subject: 'Card declined', description: 'My card 4111 1111 1111 1111 failed' }), /card number/)
  assert.match(findSensitive({ subject: 'x', description: 'key is ' + 'sk_live_' + 'abcdefghijklmnopqrstuvwx' }), /secret key/)
  assert.match(findSensitive({ subject: 'x', description: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop' }), /token/)
  assert.match(findSensitive({ subject: 'x', description: 'password: hunter2' }), /password/)
})
test('does not cry wolf on ordinary text', () => {
  assert.equal(findSensitive({ subject: 'Order 12345 is late', description: 'Placed on 2026-10-22, reference 2026102200123, phone 0803 123 4567' }), null)
  assert.equal(findSensitive({ subject: 'Forgot my password', description: 'How do I reset it?' }), null)
})
test('hashes keys the standard way (matches the browser that registered it)', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
test('only keys of the issued shape are looked up', () => {
  assert.ok(KEY_SHAPE.test('ctfs_' + 'a'.repeat(48)))
  for (const bad of ['', 'ctfs_short', 'ctfs_' + 'g'.repeat(48), 'x' + 'ctfs_' + 'a'.repeat(48), 'ctfs_' + 'A'.repeat(48)]) assert.ok(!KEY_SHAPE.test(bad))
})
