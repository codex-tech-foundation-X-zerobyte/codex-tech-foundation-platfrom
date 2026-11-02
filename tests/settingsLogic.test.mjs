import test from 'node:test'
import assert from 'node:assert/strict'
import { assessPassword, MIN_PASSWORD_LENGTH } from '../src/lib/passwordStrength.ts'

test('the minimum matches the server rule (10) and is the only hard requirement', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10)
  const short = assessPassword('Abc123!x')
  assert.equal(short.meetsMinimum, false); assert.equal(short.label, 'Too short'); assert.match(short.advice[0], /2 more/)
  assert.equal(assessPassword('x'.repeat(10)).meetsMinimum, true)
})
test('common words and personal details are called out, even when the password is long', () => {
  const r = assessPassword('Password12345!', [])
  assert.ok(r.advice.some((a) => /common or personal words \(like "password"\)/.test(a)))
  assert.ok(r.level <= 2)
  assert.ok(assessPassword('Zebra-Lamp-Orbit-92', ['Zebra']).advice.some((a) => /personal words/.test(a))) // the user's own name/email part
})
test('sequences and repetition are penalised', () => {
  assert.ok(assessPassword('aaaaaaaaaaaa').advice.some((a) => /repeating/.test(a)))
  assert.ok(assessPassword('Xq1234567890Zw').advice.some((a) => /sequences/.test(a)))
})
test('a long random-looking passphrase scores Strong with no nagging', () => {
  const r = assessPassword('correct-Horse-battery-7-staple')
  assert.equal(r.label, 'Strong'); assert.deepEqual(r.advice, [])
})
test('a repetitive string is flagged for variety, a natural passphrase is not', () => {
  assert.ok(assessPassword('abababababab').advice.some((a) => /varied/.test(a)))
  assert.ok(!assessPassword('correct-Horse-battery-7-staple').advice.some((a) => /varied/.test(a)))
})
test('longer beats shorter-but-complicated', () => {
  assert.ok(assessPassword('walk-the-quiet-river-home').level >= assessPassword('P@ssw0rd!x').level)
})

// ---- prefs: values of the wrong type are ignored, defaults fill the gaps ----
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
globalThis.dispatchEvent = () => true
const { getPrefs, setPref, DEFAULT_PREFS } = await import('../src/lib/prefs.ts')

test('defaults when nothing is stored', () => assert.deepEqual(getPrefs(), DEFAULT_PREFS))
test('a saved preference round-trips and is read back with a STABLE identity (needed by useSyncExternalStore)', () => {
  setPref('callSounds', false); setPref('micId', 'mic-123')
  const a = getPrefs(); const b = getPrefs()
  assert.equal(a.callSounds, false); assert.equal(a.micId, 'mic-123'); assert.equal(a, b)
})
test('corrupt or wrongly-typed storage cannot poison the app', () => {
  store.set('ctf:prefs', JSON.stringify({ callSounds: 'yes', micId: 42, compact: true, bogus: 1 }))
  const p = getPrefs()
  assert.equal(p.callSounds, DEFAULT_PREFS.callSounds) // string where boolean expected -> ignored
  assert.equal(p.micId, '')                              // number where string expected -> ignored
  assert.equal(p.compact, true)                          // valid value kept
  assert.equal('bogus' in p, false)
  store.set('ctf:prefs', '{not json')
  assert.deepEqual(getPrefs(), DEFAULT_PREFS)
})
