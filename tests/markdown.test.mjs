import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown, parseInline, safeHref } from '../src/lib/markdown.ts'

test('safeHref allows web, mailto and same-site links only', () => {
  assert.equal(safeHref('https://codex.dev/x'), 'https://codex.dev/x')
  assert.equal(safeHref('mailto:hi@codex.dev'), 'mailto:hi@codex.dev')
  assert.equal(safeHref('/blog/post'), '/blog/post')
  assert.equal(safeHref('#section'), '#section')
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', '//evil.com', 'vbscript:x', 'file:///etc/passwd', ' javascript:alert(1)']) {
    assert.equal(safeHref(bad), null, bad)
  }
})

test('a javascript: link keeps its text but loses the link', () => {
  const nodes = parseInline('[click me](javascript:alert(1))')
  assert.deepEqual(nodes, [{ t: 'text', v: 'click me' }])
})

test('URLs containing parentheses stay intact', () => {
  const [link] = parseInline('[wiki](https://en.wikipedia.org/wiki/Function_(mathematics))')
  assert.equal(link.href, 'https://en.wikipedia.org/wiki/Function_(mathematics)')
})

test('inline formatting from the editor toolbar', () => {
  assert.deepEqual(parseInline('a **b** c'), [{ t: 'text', v: 'a ' }, { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }])
  assert.deepEqual(parseInline('use `npm i`'), [{ t: 'text', v: 'use ' }, { t: 'code', v: 'npm i' }])
  assert.equal(parseInline('[docs](https://x.dev)')[0].t, 'link')
})

test('snake_case words are not turned into italics', () => {
  assert.deepEqual(parseInline('call my_function_name now'), [{ t: 'text', v: 'call my_function_name now' }])
  assert.equal(parseInline('an _emphasised_ word')[1].t, 'em')
})

test('blocks: headings, lists, quotes, rules, code fences', () => {
  const md = ['# Title', '', '## Sub', '', '- one', '- two', '', '1. first', '2. second', '', '> quoted', '', '---', '', '```', 'const x = 1', '```', '', 'plain **text**'].join('\n')
  const types = parseMarkdown(md).map((b) => b.t)
  assert.deepEqual(types, ['h', 'h', 'ul', 'ol', 'quote', 'hr', 'code', 'p'])
})

test('# and ## both become h2 because the page owns the h1', () => {
  const [a, b, c] = parseMarkdown('# a\n\n## b\n\n### c')
  assert.equal(a.level, 2); assert.equal(b.level, 2); assert.equal(c.level, 3)
})

test('lists collect every consecutive item and terminate (no infinite loop)', () => {
  const [ul] = parseMarkdown('- a\n- b\n- c')
  assert.equal(ul.items.length, 3)
})

test('raw HTML is inert text, never parsed as markup', () => {
  const [p] = parseMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>')
  assert.equal(p.t, 'p')
  assert.ok(p.c.every((n) => n.t === 'text'))
})

test('unclosed code fence and empty input do not throw', () => {
  assert.doesNotThrow(() => parseMarkdown('```\nnever closed'))
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('\n\n  \n'), [])
})

test('CRLF input from Windows browsers parses the same', () => {
  assert.equal(parseMarkdown('- a\r\n- b\r\n').length, 1)
})
