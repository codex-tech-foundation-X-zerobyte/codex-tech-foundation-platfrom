/**
 * Link recognition for user-written text (chat, comments, updates, announcements) and for things dropped or pasted into the
 * Resources area. Pure functions — no React, no DOM — so the rules are unit-tested (tests/links.test.mjs).
 *
 * Security rules, because this turns arbitrary text into clickable things:
 *  • only http(s) links and plain e-mail addresses become links — never javascript:, data:, file:, vbscript: …
 *  • a URL carrying credentials ("https://google.com@evil.example") is NOT linked: that shape is the classic phishing trick
 *  • links open in a new tab with noopener/noreferrer (the components add that)
 */

export interface TextSegment { type: 'text' | 'link'; text: string; href?: string }

const MAX_URL_LENGTH = 2048
// A candidate runs until whitespace or a character that can't sit inside a URL. Trailing punctuation is trimmed afterwards.
const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi
const TRAILING = /[.,;:!?'"”’»]+$/

/** Strips punctuation that belongs to the sentence, not the link: "see https://x.com/a)." → "https://x.com/a". */
function trimTrailing(raw: string): string {
  let s = raw
  for (;;) {
    const before = s
    s = s.replace(TRAILING, '')
    // A closing bracket only belongs to the link if it has a matching opener inside it (Wikipedia-style URLs).
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      while (s.endsWith(close) && s.split(close).length > s.split(open).length) s = s.slice(0, -1)
    }
    if (s === before) return s
  }
}

/** Returns a safe, absolute href for a link-looking string, or null if it isn't one we are willing to link. */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > MAX_URL_LENGTH) return null

  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text)) return `mailto:${text}`

  const candidate = /^www\./i.test(text) ? `https://${text}` : text
  if (!/^https?:\/\//i.test(candidate)) return null
  let url: URL
  try { url = new URL(candidate) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null // "http://foo" is a typo, not a link
  return url.href
}

/** Splits text into plain and link segments, preserving every character (joining the segments gives back the input). */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let last = 0
  const push = (type: TextSegment['type'], value: string, href?: string) => {
    if (!value) return
    const prev = out[out.length - 1]
    if (type === 'text' && prev?.type === 'text') prev.text += value
    else out.push(href ? { type, text: value, href } : { type, text: value })
  }
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index ?? 0
    const trimmed = trimTrailing(match[0])
    const href = normalizeUrl(trimmed)
    if (!href) continue
    push('text', text.slice(last, start))
    push('link', trimmed, href)
    last = start + trimmed.length
  }
  push('text', text.slice(last))
  return out
}

/** The distinct links in a piece of text, in order, capped. */
export function extractLinks(text: string, max = 3): string[] {
  const seen = new Set<string>()
  for (const s of splitLinks(text)) if (s.type === 'link' && s.href && !s.href.startsWith('mailto:')) seen.add(s.href)
  return [...seen].slice(0, max)
}

/** "https://www.github.com/org/repo" → "github.com" */
export function hostOf(href: string): string {
  try { return new URL(href).hostname.replace(/^www\./, '') } catch { return href }
}

/** A readable title for a link with no better name: "github.com/org/repo". */
export function titleFromUrl(href: string): string {
  try {
    const u = new URL(href)
    const path = u.pathname === '/' ? '' : decodeURIComponent(u.pathname).replace(/\/$/, '')
    const label = `${hostOf(href)}${path}`
    return label.length > 80 ? `${label.slice(0, 77)}…` : label
  } catch { return href }
}

/** Shortens a very long URL for display only (the full address stays in the href and the tooltip). */
export function shortenForDisplay(text: string, max = 56): string {
  return text.length <= max ? text : `${text.slice(0, max - 15)}…${text.slice(-12)}`
}

/**
 * For things dropped or pasted into a "drop here" area: if the text is nothing but link(s) — one per line or space —
 * returns them; if it contains anything else (a sentence that happens to mention a link) returns null, so ordinary
 * text is never mistaken for "someone dropped a link".
 */
export function parseUrlInput(text: string): string[] | null {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 20) return null
  const urls: string[] = []
  for (const token of tokens) {
    const href = normalizeUrl(trimTrailing(token))
    if (!href || href.startsWith('mailto:')) return null
    if (!urls.includes(href)) urls.push(href)
  }
  return urls
}
