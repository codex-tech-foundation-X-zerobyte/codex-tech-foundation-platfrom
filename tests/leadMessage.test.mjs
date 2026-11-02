import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLeadMessage, telHref } from '../src/lib/leadMessage.ts'

test('a start-a-project submission becomes labelled fields', () => {
  const msg = 'Project type: Web app\nProblem: Orders get lost\nBudget: 5k\nPhone: +1 (555) 010-2030'
  const p = parseLeadMessage(msg)
  assert.deepEqual(p.fields.map((f) => f.label), ['Project type', 'Problem', 'Budget', 'Phone'])
  assert.equal(p.fields[1].value, 'Orders get lost')
  assert.equal(p.phone, '+1 (555) 010-2030')
  assert.equal(p.rest, '')
})

test('a value that spans lines stays together', () => {
  const p = parseLeadMessage('Problem: First line\nsecond line\nthird\nBudget: tight')
  assert.equal(p.fields[0].value, 'First line\nsecond line\nthird')
  assert.equal(p.fields[1].value, 'tight')
})

test('an ordinary contact message is left alone, even if it mentions a label once', () => {
  const plain = 'Hi, I need help.\nBudget: flexible\nThanks!'
  const p = parseLeadMessage(plain)
  assert.deepEqual(p.fields, []); assert.equal(p.rest, plain)
  assert.deepEqual(parseLeadMessage('Just saying hello').fields, [])
})

test('text before the first label is kept, and empty values are dropped', () => {
  const p = parseLeadMessage('Intro text\nProject type: App\nProblem: \nBudget: 1k')
  assert.equal(p.rest, 'Intro text')
  assert.deepEqual(p.fields.map((f) => f.label), ['Project type', 'Budget'])
})

test('labels match case-insensitively but display canonically', () => {
  assert.equal(parseLeadMessage('project TYPE: x\nbudget: y').fields[0].label, 'Project type')
})

test('telHref only accepts something that looks like a phone number', () => {
  assert.equal(telHref('+1 (555) 010-2030'), 'tel:+15550102030')
  assert.equal(telHref('call me maybe'), null)
  assert.equal(telHref('javascript:1'), null)
  assert.equal(telHref(null), null)
})
