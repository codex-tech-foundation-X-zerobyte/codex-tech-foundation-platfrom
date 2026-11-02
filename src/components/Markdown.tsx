import { Fragment, useMemo } from 'react'
import { parseMarkdown, type Inline } from '../lib/markdown'

function renderInline(nodes: Inline[]) {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        // Preserve single line breaks inside a paragraph.
        return <Fragment key={i}>{n.v.split('\n').map((line, j) => <Fragment key={j}>{j > 0 && <br />}{line}</Fragment>)}</Fragment>
      case 'strong': return <strong key={i}>{renderInline(n.c)}</strong>
      case 'em': return <em key={i}>{renderInline(n.c)}</em>
      case 'code': return <code key={i}>{n.v}</code>
      case 'link': {
        const external = /^https?:/i.test(n.href)
        return <a key={i} href={n.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{renderInline(n.c)}</a>
      }
    }
  })
}

/** Renders post content as React elements (never as an HTML string), so authored text cannot inject markup. */
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className={`ctf-md ${className}`}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p': return <p key={i}>{renderInline(b.c)}</p>
          case 'h': { const H = `h${b.level}` as 'h2' | 'h3' | 'h4'; return <H key={i}>{renderInline(b.c)}</H> }
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
          case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>
          case 'quote': return <blockquote key={i}>{renderInline(b.c)}</blockquote>
          case 'code': return <pre key={i}><code>{b.v}</code></pre>
          case 'hr': return <hr key={i} />
        }
      })}
    </div>
  )
}
