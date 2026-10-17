import test from 'node:test'
import assert from 'node:assert/strict'

import { generateTempPassword } from '../supabase/functions/_shared/auth.ts'
const load = async () => generateTempPassword

test('temp passwords are 16 chars, from the safe alphabet, and never repeat', async () => {
  const gen = await load()
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const p = gen()
    assert.equal(p.length, 16)
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9!@#$%]+$/) // no look-alikes: 0 O 1 l I
    seen.add(p)
  }
  assert.equal(seen.size, 500)
})

test('character distribution is uniform (no modulo bias)', async () => {
  const gen = await load()
  const counts = new Map()
  const N = 60_000
  for (let i = 0; i < N; i++) for (const ch of gen(16)) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const total = N * 16
  const expected = total / 60
  // With rejection sampling every symbol should land within ~2% of expected; the old `% 60` skewed the first 16 symbols ~25% high.
  for (const [, c] of counts) assert.ok(Math.abs(c - expected) / expected < 0.03, `count ${c} vs expected ${expected.toFixed(0)}`)
  assert.equal(counts.size, 60)
})
