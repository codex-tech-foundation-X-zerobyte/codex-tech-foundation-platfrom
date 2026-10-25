import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const html = read('index.html')
const robots = read('public/robots.txt')
const sitemap = read('public/sitemap.xml')
const app = read('src/App.tsx')
const vercel = JSON.parse(read('vercel.json'))
const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key.startsWith('Content-Security-Policy')).value

const origin = new URL(/<link\s+rel="canonical"\s+href="([^"]+)"/.exec(html)[1]).origin
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

test('index.html carries the owner\'s canonical, structured data and analytics', () => {
  assert.match(html, /<link\s+rel="canonical"/)
  assert.match(html, /"@type":\s*"WebSite"/)
  assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]+/)
  assert.match(html, /<div id="root"><\/div>/)
  assert.match(html, /src="\/src\/main\.tsx"/)
})

test('every inline script in index.html is allowed by the security policy by its exact hash', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/ld\+json/.test(m[1]))
  assert.ok(inline.length >= 1)
  for (const m of inline) {
    const hash = `'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`
    assert.ok(csp.includes(hash), `index.html was edited: the inline script now hashes to ${hash}. Add it to script-src in vercel.json.`)
  }
  assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/)
})

test('robots.txt blocks the private areas and points at an absolute sitemap on the site domain', () => {
  for (const path of ['/worker', '/admin', '/client', '/login']) assert.match(robots, new RegExp(`^Disallow: ${path}$`, 'm'), path)
  const line = /^Sitemap:\s*(\S+)/m.exec(robots)?.[1]
  assert.equal(line, `${origin}/sitemap.xml`)
})

test('the sitemap has no placeholders, stays on the site domain, and lists only pages that exist', () => {
  assert.ok(!/REPLACE-WITH/i.test(sitemap))
  assert.ok(sitemapLocs.length >= 1)
  for (const loc of sitemapLocs) {
    assert.ok(loc.startsWith(`${origin}/`) || loc === origin, `${loc} is not on ${origin}`)
    const path = new URL(loc).pathname
    if (path !== '/') assert.ok(app.includes(`path="${path}"`), `${path} is in the sitemap but is not a route in App.tsx`)
  }
  assert.equal(new Set(sitemapLocs).size, sitemapLocs.length, 'duplicate sitemap entries')
})

test('none of the private areas is in the sitemap', () => {
  for (const loc of sitemapLocs) assert.ok(!/\/(admin|worker|client|login)(\/|$)/.test(new URL(loc).pathname), loc)
})
