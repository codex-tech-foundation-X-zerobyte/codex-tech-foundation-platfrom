import { Fragment } from 'react'
import { ExternalLink, Globe } from 'lucide-react'
import { extractLinks, hostOf, shortenForDisplay, splitLinks } from '../lib/links'
import './Linkify.css'

/**
 * Renders user-written text with any link in it made clickable. Newlines and spacing are untouched. Safe by construction:
 * lib/links only ever yields http(s) and mailto hrefs, and links open in a new tab with no opener.
 */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) =>
        s.type === 'link' && s.href ? (
          <a
            key={i}
            className="ctf-link"
            href={s.href}
            title={s.href}
            target={s.href.startsWith('mailto:') ? undefined : '_blank'}
            rel="noopener noreferrer nofollow ugc"
            onClick={(e) => e.stopPropagation()}
          >
            {shortenForDisplay(s.text)}
          </a>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}

/** A small card for each link in a message (first few only), so a dropped link is visibly recognised, not just blue text. */
export function LinkCards({ text, max = 2 }: { text: string; max?: number }) {
  const links = extractLinks(text, max)
  if (links.length === 0) return null
  return (
    <div className="ctf-linkcards">
      {links.map((href) => {
        let path = ''
        try { const u = new URL(href); path = `${u.pathname === '/' ? '' : u.pathname}${u.search}` } catch { /* host only */ }
        return (
          <a key={href} className="ctf-linkcard" href={href} target="_blank" rel="noopener noreferrer nofollow ugc" title={href} onClick={(e) => e.stopPropagation()}>
            <Globe size={16} aria-hidden />
            <span className="ctf-linkcard__text">
              <strong>{hostOf(href)}</strong>
              {path && <small>{shortenForDisplay(path, 48)}</small>}
            </span>
            <ExternalLink size={14} aria-hidden />
          </a>
        )
      })}
    </div>
  )
}
