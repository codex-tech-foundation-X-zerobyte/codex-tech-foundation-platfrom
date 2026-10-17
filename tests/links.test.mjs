import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrl, splitLinks, extractLinks, hostOf, titleFromUrl, shortenForDisplay, parseUrlInput } from '../src/lib/links.ts'

const links = (text) => splitLinks(text).filter((s) => s.type === 'link').map((s) => s.href)

test('recognises plain, www and e-mail links', () => {
  assert.deepEqual(links('see https://example.com/docs for more'), ['https://example.com/docs'])
  assert.deepEqual(links('try www.example.com today'), ['https://www.example.com/'])
  assert.deepEqual(links('mail ada@example.com please'), ['mailto:ada@example.com'])
})

test('splitting never loses or changes a character', () => {
  const text = 'a https://x.com/a?b=1&c=2#d, then (https://y.org/p) and www.z.io.\nLast: ok'
  assert.equal(splitLinks(text).map((s) => s.text).join(''), text)
})

test('trailing sentence punctuation is not part of the link', () => {
  assert.deepEqual(links('Go to https://example.com.'), ['https://example.com/'])
  assert.deepEqual(links('Really? https://example.com/a?!'), ['https://example.com/a'])
  assert.deepEqual(links('(see https://example.com/a)'), ['https://example.com/a'])
  assert.deepEqual(links('"https://example.com/a",'), ['https://example.com/a'])
})

test('balanced brackets inside a URL are kept', () => {
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Function_(mathematics)'), ['https://en.wikipedia.org/wiki/Function_(mathematics)'])
  assert.deepEqual(links('(https://en.wikipedia.org/wiki/Function_(mathematics))'), ['https://en.wikipedia.org/wiki/Function_(mathematics)'])
})

test('dangerous or deceptive links are left as plain text', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'vbscript:x', 'https://google.com@evil.example/login', 'https://user:pw@example.com', 'http://intranet']) {
    assert.equal(normalizeUrl(bad), null, bad)
  }
  assert.deepEqual(links('click javascript:alert(1) or https://google.com@evil.example'), [])
})

test('ordinary prose, mentions and bare words are not links', () => {
  assert.deepEqual(links('hey @Ada, the file is v1.2 and done.'), [])
  assert.deepEqual(links('it costs 3.50 each, e.g. fine'), [])
})

test('extractLinks de-duplicates, skips e-mail, and caps', () => {
  const text = 'https://a.com https://a.com ada@x.com https://b.com https://c.com https://d.com'
  assert.deepEqual(extractLinks(text, 3), ['https://a.com/', 'https://b.com/', 'https://c.com/'])
})

test('labels: host, readable title, shortened display', () => {
  assert.equal(hostOf('https://www.github.com/org/repo'), 'github.com')
  assert.equal(titleFromUrl('https://github.com/org/repo/'), 'github.com/org/repo')
  assert.equal(titleFromUrl('https://example.com/'), 'example.com')
  assert.ok(shortenForDisplay('https://example.com/' + 'a'.repeat(100)).length < 60)
  assert.equal(shortenForDisplay('short'), 'short')
})

test('a drop counts as "a link" only when it is nothing but links', () => {
  assert.deepEqual(parseUrlInput('https://a.com/x'), ['https://a.com/x'])
  assert.deepEqual(parseUrlInput('https://a.com\nwww.b.com  https://a.com'), ['https://a.com/', 'https://www.b.com/'])
  assert.equal(parseUrlInput('check this out https://a.com'), null)
  assert.equal(parseUrlInput('ada@example.com'), null)
  assert.equal(parseUrlInput('   '), null)
  assert.equal(parseUrlInput('javascript:alert(1)'), null)
})
