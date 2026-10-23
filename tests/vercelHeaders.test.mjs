import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const headers = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]))

test('the SPA rewrite is still in place', () => assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]))

test('baseline security headers are set on every route', () => {
  assert.match(headers['Strict-Transport-Security'], /max-age=\d{8,}/)
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
  assert.ok(headers['Referrer-Policy'])
})

test('HSTS does not extend to subdomains (other subdomains may not be HTTPS-only)', () => assert.doesNotMatch(headers['Strict-Transport-Security'], /includeSubDomains|preload/i))

test('calls still work: the browser is allowed to use the camera and microphone on this origin', () => {
  assert.match(headers['Permissions-Policy'], /camera=\(self\)/)
  assert.match(headers['Permissions-Policy'], /microphone=\(self\)/)
  assert.match(headers['Permissions-Policy'], /geolocation=\(\)/)
})

test('screen sharing in calls works: display-capture is allowed on this origin (and only this origin)', () => {
  assert.match(headers['Permissions-Policy'], /display-capture=\(self\)/)
  assert.match(headers['Permissions-Policy'], /fullscreen=\(self\)/)
})

test('the CSP is REPORT-ONLY (an untested enforced CSP could break production), and is not also enforced', () => {
  assert.ok(headers['Content-Security-Policy-Report-Only'])
  assert.equal(headers['Content-Security-Policy'], undefined)
})

test('the CSP allows exactly what the app needs and nothing risky', () => {
  const csp = Object.fromEntries(headers['Content-Security-Policy-Report-Only'].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
  // Scripts: our own bundle, Google Tag Manager (the owner's Analytics tag in index.html), and that tag's inline bootstrap by
  // its exact SHA-256 — never 'unsafe-inline', never a wildcard, never any other remote host. (That the hash matches
  // index.html is checked in seoFiles.test.mjs.)
  const [self, ...rest] = csp['script-src']
  assert.equal(self, "'self'")
  assert.ok(rest.includes('https://www.googletagmanager.com'))
  assert.equal(rest.filter((s) => s.startsWith("'sha256-")).length, 1)
  assert.deepEqual(rest.filter((s) => !s.startsWith("'sha256-") && s !== 'https://www.googletagmanager.com'), [])
  assert.ok(!csp['script-src'].some((s) => s.includes('unsafe-inline') || s.includes('*') || s === 'https:' || s === 'http:'))
  assert.ok(!JSON.stringify(csp).includes('unsafe-eval'))
  assert.ok(csp['style-src'].includes('https://fonts.googleapis.com'))  // Google Fonts CSS
  assert.ok(csp['font-src'].includes('https://fonts.gstatic.com'))      // Google Fonts files
  assert.ok(csp['connect-src'].includes('wss:'))                        // Supabase Realtime (chat, presence, calls)
  assert.ok(csp['connect-src'].includes('https:'))                      // Supabase API + the API tester
  assert.ok(csp['media-src'].includes('blob:'))                         // call audio/video streams
  assert.ok(csp['img-src'].includes('blob:'))                           // attachment previews
  assert.ok(csp['frame-src'].includes('https:'))                        // the Presentation board's in-app browser and video embeds (iframes are sandboxed)
  assert.ok(!csp['frame-src'].includes('http:'))
  assert.deepEqual(csp['frame-ancestors'], ["'none'"])                 // but nobody may frame US
  assert.deepEqual(csp['object-src'], ["'none'"])
})
