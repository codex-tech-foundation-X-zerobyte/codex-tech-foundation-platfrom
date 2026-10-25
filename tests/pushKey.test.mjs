import test from 'node:test'
import assert from 'node:assert/strict'
import { withTimeout, sameApplicationServerKey, explainSubscribeError, urlBase64ToUint8Array } from '../src/lib/pushKey.ts'

test('withTimeout: a step that never finishes ends with a readable error instead of spinning forever', async () => {
  const never = new Promise(() => {})
  await assert.rejects(withTimeout(never, 20, 'The prompt was never answered.'), /never answered/)
})

test('withTimeout: a step that finishes in time passes its value (or its own error) straight through', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'late'), 'ok')
  await assert.rejects(withTimeout(Promise.reject(new Error('real failure')), 1000, 'late'), /real failure/)
})

test('a subscription made with a different key is recognised as stale; the same key is kept', () => {
  const key = urlBase64ToUint8Array('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
  assert.equal(sameApplicationServerKey(key.buffer.slice(0), key), true)
  assert.equal(sameApplicationServerKey(key, key), true) // typed-array view
  const other = new Uint8Array(key); other[10] ^= 1
  assert.equal(sameApplicationServerKey(other.buffer, key), false)
  assert.equal(sameApplicationServerKey(new Uint8Array(10).buffer, key), false)
  assert.equal(sameApplicationServerKey(null, key), false)
})

test('browser subscribe() failures become instructions', () => {
  const named = (name) => Object.assign(new Error('raw'), { name })
  assert.match(explainSubscribeError(named('NotAllowedError')).message, /blocked/i)
  assert.match(explainSubscribeError(named('AbortError')).message, /push service/i)
  assert.match(explainSubscribeError(named('InvalidAccessError')).message, /VITE_VAPID_PUBLIC_KEY/)
  assert.match(explainSubscribeError(named('NotSupportedError')).message, /Home Screen/)
  assert.equal(explainSubscribeError(new Error('something odd')).message, 'something odd')
})
