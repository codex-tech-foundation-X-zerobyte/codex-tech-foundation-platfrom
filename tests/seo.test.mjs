import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalUrl, originOf } from '../src/lib/seo.ts'

const O = 'https://codex-tech-foundation-platform.vercel.app'

test('the homepage keeps a single slash; other pages never end in one', () => {
  assert.equal(canonicalUrl(O, '/'), `${O}/`)
  assert.equal(canonicalUrl(O, ''), `${O}/`)
  assert.equal(canonicalUrl(O, '/blog'), `${O}/blog`)
  assert.equal(canonicalUrl(O, '/blog/'), `${O}/blog`)
  assert.equal(canonicalUrl(`${O}/`, '/team'), `${O}/team`)
})

test('detail pages get their own address, so they are not folded into the homepage', () => {
  assert.equal(canonicalUrl(O, '/blog/my-first-post'), `${O}/blog/my-first-post`)
  assert.equal(canonicalUrl(O, '/case-studies/acme-rebuild'), `${O}/case-studies/acme-rebuild`)
  assert.notEqual(canonicalUrl(O, '/careers/engineer'), canonicalUrl(O, '/'))
})

test('stray slashes are tidied, and the path is otherwise left exactly as given', () => {
  assert.equal(canonicalUrl(O, '//blog//post//'), `${O}/blog/post`)
  assert.equal(canonicalUrl(O, 'about'), `${O}/about`)
  assert.equal(canonicalUrl(O, '/Blog/Post'), `${O}/Blog/Post`)
})

test('originOf reads the site address out of the canonical tag and rejects junk', () => {
  assert.equal(originOf(`${O}/anything/else`), O)
  assert.equal(originOf('not a url'), null)
  assert.equal(originOf(''), null)
  assert.equal(originOf(null), null)
})
