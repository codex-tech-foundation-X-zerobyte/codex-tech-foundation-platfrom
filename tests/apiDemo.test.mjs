import test from 'node:test'
import assert from 'node:assert/strict'
import { demoUrlFor, isDemoUrl, urlAfterMethodChange, demoMismatch } from '../src/pages/tools/tools/apiDemo.ts'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

test('every method gets a demo endpoint that actually serves that method', () => {
  assert.equal(demoUrlFor('GET'), 'https://httpbin.org/get')
  assert.equal(demoUrlFor('POST'), 'https://httpbin.org/post')
  assert.equal(demoUrlFor('PUT'), 'https://httpbin.org/put')
  assert.equal(demoUrlFor('PATCH'), 'https://httpbin.org/patch')
  assert.equal(demoUrlFor('DELETE'), 'https://httpbin.org/delete')
  assert.equal(demoUrlFor('HEAD'), 'https://httpbin.org/get')
  for (const m of METHODS) assert.equal(demoMismatch(demoUrlFor(m), m), null, `${m} demo URL must not be flagged`)
})

test('the exact bug: PATCH against the default GET demo URL is detected, and the fix yields /patch', () => {
  const stale = 'https://httpbin.org/get'
  assert.match(demoMismatch(stale, 'PATCH').message, /only accepts GET \/ HEAD.*405.*Use \/patch for PATCH/)
  assert.equal(urlAfterMethodChange(stale, 'PATCH'), 'https://httpbin.org/patch')
})

test('switching methods walks the demo URL through every endpoint and back', () => {
  let url = demoUrlFor('GET')
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'GET']) url = urlAfterMethodChange(url, m)
  assert.equal(url, 'https://httpbin.org/get')
})

test('a URL the user typed is NEVER rewritten, whatever method they pick', () => {
  for (const custom of ['https://api.example.com/v1/things', 'https://httpbin.org/anything', 'https://httpbin.org/status/500', 'http://localhost:3000/x', '']) {
    for (const m of METHODS) assert.equal(urlAfterMethodChange(custom, m), custom, `${custom} + ${m}`)
  }
})

test('only the exact demo endpoints count as demo URLs (trailing slash tolerated)', () => {
  assert.equal(isDemoUrl('https://httpbin.org/patch'), true)
  assert.equal(isDemoUrl('https://httpbin.org/patch/'), true)
  assert.equal(isDemoUrl('https://httpbin.org/patch?x=1'), false) // query string => user-edited
  assert.equal(isDemoUrl('https://evil.example/patch'), false)
  assert.equal(isDemoUrl('https://httpbin.org.evil.example/get'), false)
})

test('mismatch advice never fires for non-httpbin URLs, so a real API is never second-guessed', () => {
  assert.equal(demoMismatch('https://api.example.com/get', 'PATCH'), null)
  assert.equal(demoMismatch('https://httpbin.org/anything', 'PATCH'), null)
})
