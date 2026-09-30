/**
 * A deliberately small, dependency-free Markdown parser for blog posts. It produces a plain data tree that
 * <Markdown> turns into React elements — there is no HTML string anywhere, so post content can never inject
 * markup or script. Supported: headings, paragraphs, **bold**, *italic*, `code`, fenced code, [links](url),
 * bullet + numbered lists, > quotes and --- rules. That is exactly what the blog editor toolbar produces.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 2 | 3 | 4; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'hr' }

/** Only http(s), mailto, and same-site links survive. `javascript:`, `data:` etc. are dropped. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (href.startsWith('#')) return href
  return null
}

const INLINE_RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w)/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src
  while (rest) {
    const m = INLINE_RE.exec(rest)
    if (!m) { out.push({ t: 'text', v: rest }); break }
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) })
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'strong', c: parseInline(m[2]) })
    else if (m[3] !== undefined) {
      const href = safeHref(m[4])
      if (href) out.push({ t: 'link', href, c: parseInline(m[3]) })
      else out.push(...parseInline(m[3])) // unsafe target: keep the words, drop the link
    } else out.push({ t: 'em', c: parseInline(m[5] ?? m[6]) })
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

const isBlank = (l: string) => l.trim() === ''
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,4})\s+(.*)$/
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }

    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i++])
      i++ // closing fence (or end of input)
      blocks.push({ t: 'code', v: code.join('\n') })
      continue
    }
    if (HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue }

    const h = HEADING.exec(line)
    if (h) {
      // The page already has an <h1> (the post title), so # and ## both become h2.
      const level = (h[1].length <= 2 ? 2 : h[1].length === 3 ? 3 : 4) as 2 | 3 | 4
      blocks.push({ t: 'h', level, c: parseInline(h[2].trim()) })
      i++
      continue
    }

    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line)
      const re = ordered ? OL : UL
      const items: Inline[][] = []
      while (i < lines.length && re.test(lines[i])) { items.push(parseInline(re.exec(lines[i])![1])); i++ }
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) quote.push(lines[i++].trimStart().replace(/^>\s?/, ''))
      blocks.push({ t: 'quote', c: parseInline(quote.join('\n')) })
      continue
    }

    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && !HEADING.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i]) && !lines[i].trimStart().startsWith('>') && !lines[i].trimStart().startsWith('```') && !HR.test(lines[i])) {
      para.push(lines[i++])
    }
    blocks.push({ t: 'p', c: parseInline(para.join('\n')) })
  }
  return blocks
}
